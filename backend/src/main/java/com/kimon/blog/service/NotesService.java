package com.kimon.blog.service;

import com.kimon.blog.entity.Document;
import com.kimon.blog.mapper.DocumentMapper;
import com.kimon.blog.util.Json;
import com.kimon.blog.util.Time;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 笔记库：速查 / 链接 两组内容（工具清单模块已下线）。
 * 数据结构各不相同，用一份 JSON 文档整存整取最简单，也方便以后加字段。
 */
@Service
public class NotesService {

    private final DocumentMapper documents;

    public NotesService(DocumentMapper documents) {
        this.documents = documents;
    }

    public Map<String, Object> get() {
        Document d = documents.selectById("notes");
        if (d == null || d.getJson() == null || d.getJson().isBlank()) return empty();
        Map<String, Object> m = Json.readMap(d.getJson());
        Map<String, Object> out = empty();
        for (String k : out.keySet()) {
            if (m.get(k) instanceof List) out.put(k, m.get(k));
        }
        return out;
    }

    public Map<String, Object> save(Map<String, Object> body) {
        Map<String, Object> data = new LinkedHashMap<>();

        List<Map<String, Object>> cheats = new ArrayList<>();
        for (Object o : list(body.get("cheatsheets"))) {
            Map<String, Object> g = asMap(o);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("title", PostService.str(g.get("title"), 80));
            List<String> items = new ArrayList<>();
            for (Object s : list(g.get("items"))) items.add(PostService.str(s, 500));
            item.put("items", items);
            cheats.add(item);
        }

        List<Map<String, Object>> links = new ArrayList<>();
        for (Object o : list(body.get("links"))) {
            Map<String, Object> g = asMap(o);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("abbr", PostService.str(g.get("abbr"), 12));
            item.put("tint", orDefault(PostService.str(g.get("tint"), 12), "purple"));
            item.put("title", PostService.str(g.get("title"), 120));
            item.put("desc", PostService.str(g.get("desc"), 300));
            item.put("url", PostService.str(g.get("url"), 400));
            links.add(item);
        }

        data.put("cheatsheets", cheats);
        data.put("links", links);

        Document d = new Document();
        d.setK("notes");
        d.setJson(Json.write(data));
        d.setUpdatedAt(Time.now().toString());
        if (documents.selectById("notes") == null) documents.insert(d);
        else documents.updateById(d);

        return data;
    }

    private static Map<String, Object> empty() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("cheatsheets", new ArrayList<>());
        m.put("links", new ArrayList<>());
        return m;
    }

    private static List<?> list(Object o) {
        return o instanceof List ? (List<?>) o : List.of();
    }

    /** 结构校验：每个分组必须是 JSON 对象，别用裸强转把格式错误变成 500 ClassCastException */
    private static Map<String, Object> asMap(Object o) {
        if (!(o instanceof Map<?, ?> raw)) throw new IllegalArgumentException("笔记数据格式不对");
        @SuppressWarnings("unchecked")
        Map<String, Object> m = (Map<String, Object>) raw;
        return m;
    }

    private static String orDefault(String s, String dft) {
        return s == null || s.isBlank() ? dft : s;
    }
}
