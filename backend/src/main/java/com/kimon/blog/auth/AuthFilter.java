package com.kimon.blog.auth;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import com.kimon.blog.service.AuthService;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.Date;

/**
 * 解析 Cookie 里的 JWT，把用户名与角色放进 request attribute。
 * 不做拦截，拦不拦由 AdminInterceptor 决定（访客也能带着身份留言）。
 */
@Component
/* 必须排在访问日志过滤器前面，日志里才能带上登录者身份 */
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AuthFilter extends OncePerRequestFilter {

    public static final String ATTR_NAME = "authName";
    public static final String ATTR_ROLE = "authRole";

    private final CookieUtil cookies;
    private final JwtService jwt;
    private final AuthService auth;

    public AuthFilter(CookieUtil cookies, JwtService jwt, AuthService auth) {
        this.cookies = cookies;
        this.jwt = jwt;
        this.auth = auth;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        /* 所有 API 一律不缓存：后台改完内容，前台刷新 / 自动同步必须立刻拿到库里的最新值。
           否则浏览器可能把 /api/bootstrap 的旧响应留在缓存里，造成「改了不生效」。 */
        if (req.getRequestURI().startsWith("/api/")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            res.setHeader("Pragma", "no-cache");
        }
        String token = cookies.read(req, CookieUtil.SESSION);
        if (token != null && !token.isBlank()) {
            Claims claims = jwt.parse(token);
            String subject = claims == null ? null : claims.getSubject();
            if (subject != null) {
                /* Cookie 里的 JWT 本身没过期还不够：改密 / 删号后旧 token 必须立刻失效。
                   签发时间缺失视为无效，绝不把身份写进 request attribute。
                   校验过程中出现任何异常（老库缺列、数据库抖动）一律按未登录处理。 */
                Date issued = claims.getIssuedAt();
                Instant issuedAt = issued == null ? null : issued.toInstant();
                try {
                    if (auth.tokenStillValid(subject, issuedAt)) {
                        req.setAttribute(ATTR_NAME, subject);
                        req.setAttribute(ATTR_ROLE, claims.get("role", String.class));
                    }
                } catch (RuntimeException ignore) {
                    /* 鉴权失败按未登录处理，不把 500 抛给访客 */
                }
            }
        }
        chain.doFilter(req, res);
    }
}
