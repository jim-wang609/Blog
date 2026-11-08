package com.kimon.blog.auth;

import com.kimon.blog.service.SettingsService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;

/**
 * 后台接口的权限闸门：必须登录且角色是 admin。
 * 另外负责在后台任何一次成功的内容改动之后，自动记录站点「更新时间」。
 */
@Component
public class AdminInterceptor implements HandlerInterceptor {

    private final SettingsService settings;

    public AdminInterceptor(SettingsService settings) {
        this.settings = settings;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) throws Exception {
        String path = req.getRequestURI();
        /* 初始化与登录接口放行 */
        if (path.equals("/api/admin/state") || path.equals("/api/admin/setup") || path.equals("/api/admin/login")) {
            return true;
        }

        String role = (String) req.getAttribute(AuthFilter.ATTR_ROLE);
        String name = (String) req.getAttribute(AuthFilter.ATTR_NAME);

        if (name == null) {
            return reject(res, 401, "请先登录");
        }
        if (!"admin".equals(role)) {
            return reject(res, 403, "这个账号只能留言，没有后台权限");
        }
        return true;
    }

    /**
     * 只认「后台里成功的写操作」：新增 / 编辑 / 删除文章、随笔、日记、笔记、
     * 资源、相册、分类标签、站点设置、留言删除、图片上传、账号管理都算网站更新。
     * 登录、退出、首次初始化、只读查询、访问埋点、访客留言不计入。
     */
    @Override
    public void afterCompletion(HttpServletRequest req, HttpServletResponse res,
                                Object handler, Exception ex) {
        if (ex != null) return;
        String method = req.getMethod();
        if (!("POST".equals(method) || "PUT".equals(method) ||
              "PATCH".equals(method) || "DELETE".equals(method))) return;
        int status = res.getStatus();
        if (status < 200 || status >= 300) return;

        String path = req.getRequestURI();
        if (path.endsWith("/login") || path.endsWith("/logout") ||
            path.endsWith("/setup") || path.endsWith("/state") ||
            path.endsWith("/github/refresh")) return;

        try {
            settings.touchUpdated();
        } catch (Exception ignore) {
            /* 更新时间只是展示信息，写失败不能影响已经完成的业务请求 */
        }
    }

    private boolean reject(HttpServletResponse res, int code, String msg) throws Exception {
        res.setStatus(code);
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.setCharacterEncoding(StandardCharsets.UTF_8.name());
        res.getWriter().write("{\"error\":\"" + msg + "\"}");
        return false;
    }
}
