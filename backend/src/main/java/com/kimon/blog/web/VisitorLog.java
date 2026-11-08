package com.kimon.blog.web;

import com.kimon.blog.auth.AuthFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 访客行为日志。统一打成一行 key=value，方便 grep / 采集：
 * act=page ip=… user=… path=/home.html status=200 ms=3 ua=…
 * 只记录「做了什么」，不记录请求体（密码、留言正文都不进日志）。
 */
public final class VisitorLog {

    private static final Logger log = LoggerFactory.getLogger("VISITOR");

    private VisitorLog() {}

    public static void event(HttpServletRequest req, String action, Object... kv) {
        StringBuilder sb = new StringBuilder(220);
        sb.append("act=").append(safe(action))
          .append(" ip=").append(safe(PublicApiController.clientIp(req)))
          .append(" user=").append(safe((String) req.getAttribute(AuthFilter.ATTR_NAME)))
          .append(" path=").append(safe(req.getRequestURI()));
        if (req.getQueryString() != null) {
            sb.append(" query=").append(safe(req.getQueryString()));
        }
        for (int i = 0; i + 1 < kv.length; i += 2) {
            sb.append(' ').append(safe(String.valueOf(kv[i])))
              .append('=').append(safe(String.valueOf(kv[i + 1])));
        }
        log.info(sb.toString());
    }

    /** 通用访问行，由过滤器在请求结束时补上状态码与耗时 */
    public static void access(HttpServletRequest req, int status, long ms, String action) {
        event(req, action, "status", status, "ms", ms, "ua", userAgent(req));
    }

    public static String userAgent(HttpServletRequest req) {
        String ua = req.getHeader("User-Agent");
        return ua == null || ua.isBlank() ? "-" : (ua.length() > 120 ? ua.substring(0, 120) : ua);
    }

    /** 去掉换行 / 制表符，防止日志注入；太长的值截断 */
    private static String safe(String s) {
        if (s == null || s.isBlank()) return "-";
        String v = s.replaceAll("[\\r\\n\\t]", " ").trim();
        return v.length() > 220 ? v.substring(0, 220) : v;
    }
}
