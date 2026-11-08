package com.kimon.blog.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

/**
 * 安全响应头 + 写操作的来源校验（防 CSRF）。
 * 静态文件由 Nginx 发时，这里主要保护 /api 与本地开发时的页面。
 */
@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {

    private static final String CSP = String.join("; ",
            "default-src 'self'",
            "img-src 'self' data: blob:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-inline'",
            "connect-src 'self'",
            "font-src 'self' data:",
            "frame-ancestors 'self'",
            "base-uri 'self'",
            "form-action 'self'");

    @Value("${app.allowed-origins:}")
    private String allowedOrigins;

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {

        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        res.setHeader("Permissions-Policy", "geolocation=(self), microphone=(), camera=()");

        String path = req.getRequestURI();
        String method = req.getMethod();

        /* 写操作校验来源，挡住跨站伪造请求 */
        if (List.of("POST", "PUT", "DELETE", "PATCH").contains(method) && !originOk(req)) {
            res.setStatus(403);
            res.setContentType("application/json;charset=UTF-8");
            res.getWriter().write("{\"error\":\"来源不被允许\"}");
            return;
        }

        if (path.endsWith(".html") || path.equals("/")) {
            res.setHeader("Content-Security-Policy", CSP);
        }
        if (path.startsWith("/uploads/") && path.endsWith(".svg")) {
            res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
        }

        chain.doFilter(req, res);
    }

    private boolean originOk(HttpServletRequest req) {
        String origin = req.getHeader("Origin");
        if (origin == null || origin.isBlank()) return true;   /* curl / 同源表单 */
        String host = req.getHeader("Host");
        if (host != null && origin.replaceFirst("^https?://", "").equals(host)) return true;

        if (allowedOrigins != null && !allowedOrigins.isBlank()) {
            List<String> list = Arrays.stream(allowedOrigins.split(",")).map(String::trim).toList();
            return list.contains(origin);
        }
        return false;
    }
}
