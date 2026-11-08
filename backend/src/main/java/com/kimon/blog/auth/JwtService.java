package com.kimon.blog.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Date;

/** 签发与校验 JWT（放在 HttpOnly Cookie 里） */
@Service
public class JwtService {

    public static final long TTL_MS = 14L * 24 * 60 * 60 * 1000;

    private final SecretKey key;

    public JwtService(@Value("${app.jwt-secret:}") String secret) {
        byte[] bytes;
        String s = secret == null ? "" : secret.trim();
        if (s.length() >= 32) {
            bytes = s.getBytes(StandardCharsets.UTF_8);
        } else {
            bytes = loadOrCreateSecret();
        }
        this.key = Keys.hmacShaKeyFor(bytes);
    }

    /** 没配置就用本地文件里的随机密钥，重启后仍然有效 */
    private byte[] loadOrCreateSecret() {
        try {
            Path p = Path.of("storage", "secret.key");
            if (Files.exists(p)) {
                String v = Files.readString(p).trim();
                if (v.length() >= 32) return v.getBytes(StandardCharsets.UTF_8);
            }
            Files.createDirectories(p.getParent());
            byte[] rnd = new byte[48];
            new SecureRandom().nextBytes(rnd);
            String v = Base64.getEncoder().encodeToString(rnd);
            Files.writeString(p, v);
            return v.getBytes(StandardCharsets.UTF_8);
        } catch (IOException e) {
            byte[] rnd = new byte[48];
            new SecureRandom().nextBytes(rnd);
            return Base64.getEncoder().encodeToString(rnd).getBytes(StandardCharsets.UTF_8);
        }
    }

    public String issue(String name, String role) {
        return Jwts.builder()
                .subject(name)
                .claim("role", role)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + TTL_MS))
                .signWith(key)
                .compact();
    }

    /** 解析失败返回 null */
    public Claims parse(String token) {
        try {
            return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        } catch (Exception e) {
            return null;
        }
    }
}
