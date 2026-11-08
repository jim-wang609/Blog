package com.kimon.blog.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 数据库增量迁移（零依赖，不引入 Flyway / Liquibase）。
 *
 * 分工：
 * - 新建空库的建表由 spring.sql.init（schema-mysql.sql，全部 CREATE TABLE IF NOT EXISTS）负责；
 * - 已有库的增量结构（新增列 / 索引）由本类负责，启动时自动补齐，可重复执行（先查 information_schema 再改）。
 *
 * 版本记录在 settings 表的 k = "schema_version" 一行，缺省视为 1。
 * 以后要加 V3：就在 migrate() 里追加一个 if (from < 3) { ... } 的 step，
 * 不要再引入外部迁移工具，也不要改已发布的历史 step。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SchemaMigrator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SchemaMigrator.class);

    /** 当前代码要求的数据库结构版本 */
    private static final int CURRENT_VERSION = 3;

    /** 版本标记存在 settings 表，k = schema_version */
    private static final String VERSION_KEY = "schema_version";

    private final JdbcTemplate jdbc;
    private final SettingsService settings;

    public SchemaMigrator(JdbcTemplate jdbc, SettingsService settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    @Override
    public void run(ApplicationArguments args) {
        int from = currentVersion();
        if (from >= CURRENT_VERSION) {
            log.debug("数据库结构已是最新版本 v{}，跳过迁移", from);
            return;
        }
        try {
            migrate(from);
            settings.saveRaw(VERSION_KEY, String.valueOf(CURRENT_VERSION));
            log.info("数据库结构迁移完成：v{} -> v{}", from, CURRENT_VERSION);
        } catch (Exception e) {
            log.error("数据库结构迁移失败（v{} -> v{}）：{}", from, CURRENT_VERSION, e.getMessage(), e);
            /* 迁移失败就让启动失败：带病运行比启动失败更难排查 */
            throw new IllegalStateException("数据库结构迁移失败", e);
        }
    }

    private void migrate(int from) {
        if (from < 2) migrateV2();
        if (from < 3) migrateV3();
    }

    /**
     * V2：
     * 1) users 增加 pass_changed_at（改密码后旧 JWT 立即失效用）
     * 2) comments / visits 增加查询索引（评论按 ip+时间限流、后台分页、访问统计）
     * 每一步都先查 information_schema，保证重复启动、半途失败后可以重入。
     */
    private void migrateV2() {
        addColumnIfMissing("users", "pass_changed_at", "VARCHAR(32) NULL");
        createIndexIfMissing("comments", "idx_comments_ip_time", "CREATE INDEX idx_comments_ip_time ON comments (ip, created_at)");
        createIndexIfMissing("comments", "idx_comments_time", "CREATE INDEX idx_comments_time ON comments (created_at)");
        createIndexIfMissing("visits", "idx_visits_path", "CREATE INDEX idx_visits_path ON visits (path)");
    }

    /**
     * V3：
     * 1) comments 增加 parent_id（评论楼中回复；0 = 顶层，旧数据默认 0，等同于全部顶层）
     * 2) comments 增加 parent_id 索引（按父评论取回复、删顶层时级联删回复）
     * 老库升级必须走这一步：schema-mysql.sql 只在空库建表时生效，改不到已有库。
     */
    private void migrateV3() {
        addColumnIfMissing("comments", "parent_id", "BIGINT NOT NULL DEFAULT 0");
        createIndexIfMissing("comments", "idx_comments_parent", "CREATE INDEX idx_comments_parent ON comments (parent_id)");
    }

    /* ---------- 幂等 DDL 小工具（只面向 MySQL） ---------- */

    private void addColumnIfMissing(String table, String column, String definition) {
        Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.COLUMNS " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                Integer.class, table, column);
        if (n != null && n > 0) return;
        jdbc.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
        log.info("迁移：已给表 {} 增加列 {}", table, column);
    }

    private void createIndexIfMissing(String table, String indexName, String ddl) {
        Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
                Integer.class, table, indexName);
        if (n != null && n > 0) return;
        jdbc.execute(ddl);
        log.info("迁移：已给表 {} 创建索引 {}", table, indexName);
    }

    private int currentVersion() {
        try {
            String v = settings.raw(VERSION_KEY);
            if (v == null || v.isBlank()) return 1;
            return Integer.parseInt(v.trim());
        } catch (RuntimeException e) {
            /* 读不到/不是数字都按最老版本处理，后续 step 自身是幂等的 */
            log.warn("读取数据库结构版本失败，按 v1 处理：{}", e.getMessage());
            return 1;
        }
    }
}
