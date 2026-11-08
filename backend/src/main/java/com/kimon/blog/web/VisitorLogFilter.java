package com.kimon.blog.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 访客访问日志：每个页面与 API 请求在结束时都留一行，记录访问了什么、
 * 谁访问的、结果和耗时。具体动作（读文章 / 下载 / 留言 / 登录）由各控制器
 * 另外打带业务字段的详细行，这里就不重复记那些接口了。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class VisitorLogFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String path = req.getRequestURI();
        boolean record = shouldLog(path);
        long start = System.nanoTime();
        try {
            chain.doFilter(req, res);
        } finally {
            if (record) {
                long ms = (System.nanoTime() - start) / 1_000_000L;
                VisitorLog.access(req, res.getStatus(), ms, actionOf(req, path));
            }
        }
    }

    private static boolean shouldLog(String p) {
        if (p == null) return false;
        /* 静态资源、图片、favicon 只算噪音 */
        if (p.startsWith("/assets/") || p.startsWith("/uploads/") ||
            p.endsWith(".css") || p.endsWith(".js") || p.endsWith(".png") ||
            p.endsWith(".jpg") || p.endsWith(".svg") || p.endsWith(".ico") ||
            p.endsWith(".webp") || p.endsWith(".woff2")) return false;
        /* 高频轮询 */
        if (p.equals("/api/admin/state")) return false;
        /* 前端 60 秒轮询的轻量版本号，记了只会刷屏 */
        if (p.equals("/api/rev")) return false;
        /* 下面这些由控制器打带业务字段的详细日志，避免刷两行 */
        if (p.equals("/api/track") || p.equals("/api/comments") ||
            p.equals("/api/login") || p.equals("/api/logout") ||
            p.equals("/api/admin/login") || p.equals("/api/admin/logout") ||
            p.equals("/api/admin/setup") ||
            p.startsWith("/api/view/") || p.startsWith("/api/download/")) return false;
        return p.equals("/") || p.endsWith(".html") || p.startsWith("/api/");
    }

    private static String actionOf(HttpServletRequest req, String p) {
        String m = req.getMethod().toLowerCase();
        if (p.equals("/api/bootstrap")) return "load_site";
        if (p.equals("/api/session")) return "session";
        if (p.equals("/api/github")) return "github";
        if (p.equals("/api/admin/github/refresh")) return "github_refresh";
        if (p.startsWith("/api/admin/")) return "admin_" + m;
        if (p.startsWith("/api/")) return "api_" + m;
        return "page";
    }
}
