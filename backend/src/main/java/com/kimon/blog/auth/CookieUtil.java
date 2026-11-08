package com.kimon.blog.auth;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Cookie 读写：统一处理 Secure / SameSite / HttpOnly */
@Component
public class CookieUtil {

    public static final String SESSION = "kimon_sid";
    public static final String VISITOR = "kimon_vid";

    private final boolean secure;
    private final String sameSite;

    public CookieUtil(@Value("${app.cookie-secure:false}") boolean secure,
                      @Value("${app.cookie-same-site:Lax}") String sameSite) {
        this.secure = secure;
        this.sameSite = sameSite == null || sameSite.isBlank() ? "Lax" : sameSite;
    }

    public String read(HttpServletRequest req, String name) {
        Cookie[] cookies = req.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (name.equals(c.getName())) return c.getValue();
        }
        return null;
    }

    public void write(HttpServletResponse res, String name, String value, int maxAgeSeconds) {
        StringBuilder sb = new StringBuilder();
        sb.append(name).append('=').append(value)
          .append("; Path=/; HttpOnly; SameSite=").append(sameSite)
          .append("; Max-Age=").append(maxAgeSeconds);
        if (secure) sb.append("; Secure");
        res.addHeader("Set-Cookie", sb.toString());
    }

    public void clear(HttpServletResponse res, String name) {
        write(res, name, "", 0);
    }
}
