package com.kimon.blog.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * 应用自身的静态目录泄露防护。
 *
 * 生产环境静态页面由 Nginx 直接发，但本地开发、以及 Nginx 漏配时，
 * Spring 的 /** 静态映射会把仓库根目录（static-dir）整个暴露出去，
 * 于是 /backend/、/storage/、/deploy/、/README.md、/.git/ 都能被直接下载。
 * 这里对「非 /api/」请求做一次兜底 404，Nginx 侧也要继续保持同样的拦截。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class StaticPathGuardFilter extends OncePerRequestFilter {

    /** 不允许通过静态映射访问的路径前缀（源码、后端工程、日志、部署脚本、密钥、隐藏目录）。 */
    private static final String[] BLOCKED_PREFIXES = {
            "/backend", "/storage", "/logs", "/deploy", "/readme",
            "/启动服务器", "/.git", "/.workbuddy"
    };

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String uri = req.getRequestURI();
        if (uri == null) {
            chain.doFilter(req, res);
            return;
        }

        String raw = uri.toLowerCase(Locale.ROOT);
        /* 单层解码后再判断：%2e%2e、%2F 等编码绕过都要挡住；
           双重编码（%252e）解一层后还会留下 "%2e"，所以原始串也检查一次。
           路径穿越对 /api/ 同样拒绝（正常接口路径不可能出现 ..），
           前缀拦截只针对走静态映射的非 /api/ 请求，避免误伤合法接口。 */
        String path = decode(raw);
        if (raw.contains("%2e") || path.contains("%2e") || path.contains("..")) {
            notFound(res);
            return;
        }
        if (!uri.startsWith("/api/") && blocked(path)) {
            notFound(res);
            return;
        }
        chain.doFilter(req, res);
    }

    /** 解码 + 统一分隔符 + 折叠重复斜杠，防止 /..//backend 这类变体绕过前缀判断 */
    private static String decode(String raw) {
        try {
            return URLDecoder.decode(raw, StandardCharsets.UTF_8)
                    .replace('\\', '/')
                    .replaceAll("/{2,}", "/")
                    .toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException e) {
            /* 非法百分号编码按原始串处理，后面还会统一转小写判断 */
            return raw;
        }
    }

    private static boolean blocked(String path) {
        for (String prefix : BLOCKED_PREFIXES) {
            if (path.startsWith(prefix)) return true;
        }
        return false;
    }

    private static void notFound(HttpServletResponse res) throws IOException {
        res.setStatus(HttpServletResponse.SC_NOT_FOUND);
        res.setContentType("text/plain;charset=UTF-8");
        res.getWriter().write("Not Found");
    }
}
