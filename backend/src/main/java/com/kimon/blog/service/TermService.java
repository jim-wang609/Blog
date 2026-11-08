package com.kimon.blog.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kimon.blog.entity.Document;
import com.kimon.blog.entity.Post;
import com.kimon.blog.mapper.DocumentMapper;
import com.kimon.blog.mapper.PostMapper;
import com.kimon.blog.util.Json;
import com.kimon.blog.util.Time;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * 分类与标签：文章里正在用的从 posts 聚合；站长可以另外「先建好、还没用到」的
 * 空分类 / 空标签，存在 documents 表的 k="terms" 文档里，写文章时就能直接选。
 */
@Service
public class TermService {

    private static final String DOC = "terms";

    private final PostMapper posts;
    private final DocumentMapper documents;

    public TermService(PostMapper posts, DocumentMapper documents) {
        this.posts = posts;
        this.documents = documents;
    }

    public Map<String, Object> terms() {
        Map<String, Integer> cats = new LinkedHashMap<>();
        Map<String, Integer> tags = new LinkedHashMap<>();

        for (Post p : posts.selectList(null)) {
            String c = p.getCat() == null ? "" : p.getCat().trim();
            if (!c.isEmpty()) cats.merge(c, 1, Integer::sum);
            for (String t : Json.readStringList(p.getTags())) {
                if (t != null && !t.isBlank()) tags.merge(t.trim(), 1, Integer::sum);
            }
        }

        List<String> customCats = custom("cats");
        List<String> customTags = custom("tags");
        for (String c : customCats) if (!cats.containsKey(c)) cats.put(c, 0);
        for (String t : customTags) if (!tags.containsKey(t)) tags.put(t, 0);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("cats", toList(cats, customCats));
        out.put("tags", toList(tags, customTags));
        return out;
    }

    /** 新增一个还没用到文章上的分类 / 标签，写库后立刻出现在编辑器候选里。 */
    @Transactional
    public void add(String kind, String name) {
        String k = normalizeKind(kind);
        String n = normalizeName(name);
        List<String> list = custom(k);
        if (list.contains(n)) throw new IllegalArgumentException("「" + n + "」已经存在了");

        Map<String, Integer> used = usedNames(k);
        if (used.containsKey(n)) throw new IllegalArgumentException("「" + n + "」已经被文章使用了，无需重复添加");

        list.add(n);
        saveCustom(k, list);
    }

    @Transactional
    public void rename(String kind, String from, String to) {
        if (from == null || from.isBlank() || to == null || to.isBlank()) {
            throw new IllegalArgumentException("参数不完整");
        }
        String k = normalizeKind(kind);
        String oldName = from.trim();
        String newName = normalizeName(to);

        /* 自建项也跟着改名，否则改完还留着旧名字 */
        List<String> list = custom(k);
        int at = list.indexOf(oldName);
        if (at >= 0) {
            list.set(at, newName);
            saveCustom(k, distinct(list));
        }

        if ("cats".equals(k)) {
            for (Post p : posts.selectList(new QueryWrapper<Post>().eq("cat", oldName))) {
                p.setCat(newName);
                posts.updateById(p);
            }
            return;
        }
        for (Post p : posts.selectList(null)) {
            List<String> tags = new ArrayList<>(Json.readStringList(p.getTags()));
            if (!tags.contains(oldName)) continue;
            List<String> next = new ArrayList<>();
            for (String t : tags) next.add(t.equals(oldName) ? newName : t);
            p.setTags(Json.write(next.stream().distinct().toList()));
            posts.updateById(p);
        }
    }

    @Transactional
    public void delete(String kind, String name) {
        String k = normalizeKind(kind);
        String n = name == null ? "" : name.trim();

        List<String> list = custom(k);
        if (list.remove(n)) saveCustom(k, list);

        if ("cats".equals(k)) {
            for (Post p : posts.selectList(new QueryWrapper<Post>().eq("cat", n))) {
                p.setCat("");
                posts.updateById(p);
            }
            return;
        }
        for (Post p : posts.selectList(null)) {
            List<String> tags = new ArrayList<>(Json.readStringList(p.getTags()));
            if (!tags.contains(n)) continue;
            p.setTags(Json.write(tags.stream().filter(t -> !t.equals(n)).toList()));
            posts.updateById(p);
        }
    }

    /* ---------- 自建项的读写 ---------- */

    private List<String> custom(String kind) {
        Document d = documents.selectById(DOC);
        if (d == null || d.getJson() == null || d.getJson().isBlank()) return new ArrayList<>();
        Object v = Json.readMap(d.getJson()).get(kind);
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> raw) {
            for (Object o : raw) {
                if (o instanceof String s && !s.isBlank()) out.add(s.trim());
            }
        }
        return distinct(out);
    }

    private void saveCustom(String kind, List<String> names) {
        Document d = documents.selectById(DOC);
        Map<String, Object> data = new LinkedHashMap<>();
        Map<String, Object> old = d == null ? Map.of() : Json.readMap(d.getJson());
        for (String k : List.of("cats", "tags")) {
            Object v = old.get(k);
            List<String> keep = new ArrayList<>();
            if (v instanceof List<?> raw) {
                for (Object o : raw) if (o instanceof String s && !s.isBlank()) keep.add(s.trim());
            }
            data.put(k, distinct(keep));
        }
        data.put(kind, distinct(names));

        Document row = new Document();
        row.setK(DOC);
        row.setJson(Json.write(data));
        row.setUpdatedAt(Time.now().toString());
        if (d == null) documents.insert(row);
        else documents.updateById(row);
    }

    private Map<String, Integer> usedNames(String kind) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Post p : posts.selectList(null)) {
            if ("cats".equals(kind)) {
                String c = p.getCat() == null ? "" : p.getCat().trim();
                if (!c.isEmpty()) counts.merge(c, 1, Integer::sum);
            } else {
                for (String t : Json.readStringList(p.getTags())) {
                    if (t != null && !t.isBlank()) counts.merge(t.trim(), 1, Integer::sum);
                }
            }
        }
        return counts;
    }

    private List<Map<String, Object>> toList(Map<String, Integer> counts, List<String> customs) {
        List<Map<String, Object>> list = new ArrayList<>();
        counts.entrySet().stream()
                .sorted((a, b) -> {
                    int byCount = b.getValue() - a.getValue();
                    return byCount != 0 ? byCount : a.getKey().compareToIgnoreCase(b.getKey());
                })
                .forEach(e -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("name", e.getKey());
                    item.put("count", e.getValue());
                    item.put("custom", e.getValue() == 0 && customs.contains(e.getKey()));
                    list.add(item);
                });
        return list;
    }

    /** 统一用复数键，和 documents 里存的 {"cats":[],"tags":[]} 对齐 */
    private static String normalizeKind(String kind) {
        if ("cat".equals(kind) || "cats".equals(kind)) return "cats";
        if ("tag".equals(kind) || "tags".equals(kind)) return "tags";
        throw new IllegalArgumentException("类型不对");
    }

    private static String normalizeName(String name) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) throw new IllegalArgumentException("名称不能为空");
        if (n.length() > 30) throw new IllegalArgumentException("名称最多 30 个字");
        return n;
    }

    private static List<String> distinct(List<String> in) {
        return new ArrayList<>(new LinkedHashSet<>(in));
    }
}
