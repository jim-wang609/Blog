package com.kimon.blog.auth;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 密码哈希：PBKDF2-HMAC-SHA256，JDK 自带，不引第三方。
 * 存储格式：pbkdf2$迭代次数$盐$哈希
 */
public final class PasswordUtil {

    private static final int ITERATIONS = 120_000;
    private static final int KEY_LENGTH = 256;

    private PasswordUtil() {}

    public static String hash(String raw) {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        byte[] dk = derive(raw, salt, ITERATIONS);
        return "pbkdf2$" + ITERATIONS + "$"
                + Base64.getEncoder().encodeToString(salt) + "$"
                + Base64.getEncoder().encodeToString(dk);
    }

    public static boolean verify(String raw, String stored) {
        try {
            String[] parts = stored.split("\\$");
            if (parts.length != 4 || !"pbkdf2".equals(parts[0])) return false;
            int iter = Integer.parseInt(parts[1]);
            byte[] salt = Base64.getDecoder().decode(parts[2]);
            byte[] want = Base64.getDecoder().decode(parts[3]);
            byte[] mine = derive(raw, salt, iter);
            return MessageDigest.isEqual(mine, want);
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] derive(String raw, byte[] salt, int iterations) {
        try {
            PBEKeySpec spec = new PBEKeySpec(raw.toCharArray(), salt, iterations, KEY_LENGTH);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException("密码哈希失败", e);
        }
    }
}
