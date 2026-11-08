package com.kimon.blog.service;

import com.kimon.blog.mapper.PostMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * 首次启动把 seed.json 导入数据库，仅此一次。
 *
 * 用 settings 表里的 seeded 标记判断，而不是「posts 表是否为空」：
 * 否则站长把文章全部删光后重启，seed.json 里的旧内容会反向覆盖数据库，
 * 看起来就像「后台删了又自己回来了」。导入成功后数据库就是唯一数据源，
 * seed.json 再也不会参与任何读写。
 *
 * 导入细节在 SeedService（一个事务里完成）；这里只负责判断时机与写标记。
 */
@Component
public class SeedRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SeedRunner.class);

    private final PostMapper posts;
    private final SeedService seedService;
    private final SettingsService settings;
    private final AuthService auth;

    @Value("${app.init-admin-password:}")
    private String initAdminPassword;

    public SeedRunner(PostMapper posts, SeedService seedService,
                      SettingsService settings, AuthService auth) {
        this.posts = posts;
        this.seedService = seedService;
        this.settings = settings;
        this.auth = auth;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            /* 只在数据库从未初始化时导入；导入失败不写标记，下次启动会重试 */
            if (!"1".equals(settings.raw("seeded"))) {
                if (posts.selectCount(null) == 0) {
                    /* 导入失败会抛异常并整体回滚，seeded 标记不写，下次启动重试 */
                    seedService.importSeed();
                } else {
                    /* 迁移来的旧库已经有文章：不再灌种子，直接标记为已初始化 */
                    log.info("检测到已有文章，跳过种子导入（迁移库）");
                }
                settings.saveRaw("seeded", "1");
                log.info("数据库已初始化，后续内容一律以数据库为准");
            }
        } catch (Exception e) {
            log.warn("种子数据导入失败：{}", e.getMessage());
        }

        try {
            if (!auth.hasAdmin() && initAdminPassword != null && !initAdminPassword.isBlank()) {
                auth.createAdmin("admin", initAdminPassword);
                log.info("已根据 INIT_ADMIN_PASSWORD 创建管理员账号 admin");
            }
        } catch (Exception e) {
            log.warn("初始化管理员失败：{}", e.getMessage());
        }
    }
}
