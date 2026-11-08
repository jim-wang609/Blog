package com.kimon.blog.util;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;

/** 统一的 JSON 工具，避免到处 new ObjectMapper */
public final class Json {

    public static final ObjectMapper MAPPER = new ObjectMapper();

    private Json() {}

    public static String write(Object o) {
        try {
            return MAPPER.writeValueAsString(o);
        } catch (Exception e) {
            throw new IllegalStateException("JSON 序列化失败", e);
        }
    }

    public static Map<String, Object> readMap(String s) {
        if (s == null || s.isBlank()) return Map.of();
        try {
            return MAPPER.readValue(s, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    /**
     * 严格解析：解析失败直接抛异常，调用方据此中止写入。
     * 站点设置用它——坏 JSON 时宁可让这次更新失败，也不能把 site 当成空对象覆盖掉。
     */
    public static Map<String, Object> readMapStrict(String s) {
        if (s == null || s.isBlank()) return Map.of();
        try {
            Map<String, Object> m = MAPPER.readValue(s, new TypeReference<Map<String, Object>>() {});
            return m == null ? Map.of() : m;
        } catch (Exception e) {
            throw new IllegalStateException("站点设置 JSON 解析失败", e);
        }
    }

    public static List<String> readStringList(String s) {
        if (s == null || s.isBlank()) return List.of();
        try {
            return MAPPER.readValue(s, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }
}
