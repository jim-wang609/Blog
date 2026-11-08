package com.kimon.blog.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kimon.blog.entity.Comment;
import com.kimon.blog.entity.Post;
import com.kimon.blog.mapper.CommentMapper;
import com.kimon.blog.mapper.PostMapper;
import com.kimon.blog.util.Json;
import com.kimon.blog.util.Time;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 文章（含随笔）与草稿 */
@Service
public class PostService {

    /** 标签数量与单个标签长度上限 */
    private static final int MAX_TAGS = 20;
    private static final int MAX_TAG_LEN = 30;

    private final PostMapper posts;
    private final CommentMapper comments;

    public PostService(PostMapper posts, CommentMapper comments) {
        this.posts = posts;
        this.comments = comments;
    }

    /* ---------- 输出 ---------- */

    public Map<String, Object> toJson(Post p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.getId());
        m.put("section", p.getSection());
        m.put("title", p.getTitle());
        m.put("excerpt", p.getExcerpt() == null ? "" : p.getExcerpt());
        m.put("body", p.getBody() == null ? "" : p.getBody());
        m.put("cat", p.getCat() == null ? "" : p.getCat());
        m.put("tags", Json.readStringList(p.getTags()));
        m.put("minutes", p.getMinutes() == null ? 5 : p.getMinutes());
        m.put("pinned", p.getPinned() != null && p.getPinned() == 1);
        m.put("cover", Json.readMap(p.getCover()));
        m.put("status", p.getStatus());
        m.put("views", p.getViews() == null ? 0 : p.getViews());
        m.put("date", p.getDate());
        m.put("createdAt", p.getCreatedAt());
        m.put("updatedAt", p.getUpdatedAt());
        return m;
    }

    /** 列表用的精简版（不带正文） */
    public Map<String, Object> toListJson(Post p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.getId());
        m.put("title", p.getTitle());
        m.put("section", p.getSection());
        m.put("cat", p.getCat() == null ? "" : p.getCat());
        m.put("tags", Json.readStringList(p.getTags()));
        m.put("date", p.getDate());
        m.put("status", p.getStatus());
        m.put("pinned", p.getPinned() != null && p.getPinned() == 1);
        m.put("views", p.getViews() == null ? 0 : p.getViews());
        m.put("excerpt", p.getExcerpt() == null ? "" : p.getExcerpt());
        m.put("minutes", p.getMinutes() == null ? 5 : p.getMinutes());
        m.put("updatedAt", p.getUpdatedAt());
        return m;
    }

    /* ---------- 查询 ---------- */

    public List<Post> published() {
        QueryWrapper<Post> w = new QueryWrapper<>();
        w.eq("status", "published").orderByDesc("date");
        return posts.selectList(w);
    }

    public List<Post> list(String status, String q) {
        QueryWrapper<Post> w = new QueryWrapper<>();
        if ("draft".equals(status) || "published".equals(status)) w.eq("status", status);
        if (q != null && !q.isBlank()) {
            w.and(x -> x.like("title", q).or().like("cat", q).or().like("tags", q));
        }
        w.orderByDesc("date").orderByDesc("updated_at");
        return posts.selectList(w);
    }

    public Post get(String id) {
        return posts.selectById(id);
    }

    /* ---------- 写入 ---------- */

    public Post save(Map<String, Object> body, String id) {
        String title = str(body.get("title"), 200);
        if (title.isBlank()) throw new IllegalArgumentException("标题不能为空");

        List<String> tags = parseTags(body.get("tags"));

        Object cover = body.get("cover");
        String coverJson = cover instanceof Map ? Json.write(cover) : "{}";

        String status = "draft".equals(body.get("status")) ? "draft" : "published";
        String now = Time.now().toString();

        Post p = id == null ? new Post() : posts.selectById(id);
        if (p == null) throw new IllegalArgumentException("文章不存在");

        boolean isNew = id == null;
        String base = null;
        if (isNew) {
            base = baseId(str(body.get("slug"), 80).isBlank() ? title : str(body.get("slug"), 80));
            p.setViews(0);
            p.setCreatedAt(now);
        }

        p.setSection("essay".equals(body.get("section")) ? "essay" : "tech");
        p.setTitle(title);
        p.setExcerpt(str(body.get("excerpt"), 600));
        p.setBody(str(body.get("body"), 400_000));
        p.setCat(str(body.get("cat"), 80));
        p.setTags(Json.write(tags));
        p.setMinutes(Math.max(1, num(body.get("minutes"), 5)));
        p.setPinned(truthy(body.get("pinned")) ? 1 : 0);
        p.setCover(coverJson);
        p.setStatus(status);
        p.setDate(str(body.get("date"), 10).isBlank() ? Time.today().toString() : str(body.get("date"), 10));
        p.setUpdatedAt(now);

        if (isNew) {
            insertNew(p, base);
        } else {
            /* 更新时不能把阅读量覆盖成请求里缺省的值：置 null，MyBatis-Plus 会跳过该列 */
            p.setViews(null);
            posts.updateById(p);
            /* 更新后重新读一次，保证响应里的 views / 其它库端默认值是最新值 */
            Post fresh = posts.selectById(p.getId());
            if (fresh != null) p = fresh;
        }
        return p;
    }

    /** 删除文章：先删它下面的评论（target = 文章 id，楼中回复的 target 也是同一个），再删文章。 */
    @Transactional
    public void delete(String id) {
        comments.delete(new QueryWrapper<Comment>().eq("target", id));
        posts.deleteById(id);
    }

    /** 前台打开文章详情时调用一次 */
    public void bumpViews(String id) {
        posts.incrViews(id);
    }

    /* ---------- 内部 ---------- */

    /**
     * 生成一个当前库中未被占用的文章 id。
     * 并发新建仍可能同时算出同一个 id，真正插入时的冲突由 insertNew() 捕获后重试。
     */
    public String makeId(String seed) {
        String base = baseId(seed);
        String id = base;
        int n = 1;
        while (posts.selectById(id) != null) {
            n++;
            id = base + "-" + n;
        }
        return id;
    }

    /** 并发新建撞主键时依次尝试 base-2 … base-5，仍冲突就加随机后缀，避免直接 500。 */
    private void insertNew(Post p, String base) {
        p.setId(makeId(base));
        for (int n = 2; n <= 5; n++) {
            try {
                posts.insert(p);
                return;
            } catch (DuplicateKeyException e) {
                p.setId(base + "-" + n);
            }
        }
        p.setId(base + "-" + Long.toHexString(System.nanoTime()));
        try {
            posts.insert(p);
        } catch (DuplicateKeyException e) {
            throw new IllegalStateException("文章 ID 生成冲突，请重试", e);
        }
    }

    /** 把标题 / slug 归一成合法的 id 前缀（小写、连字符、最长 55，给冲突后缀留余地） */
    private static String baseId(String seed) {
        String base = seed.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        if (base.length() < 3) {
            base = "post-" + Time.today().toString().replace("-", "") + "-"
                    + Long.toHexString(System.nanoTime()).substring(4, 8);
        }
        if (base.length() > 55) base = base.substring(0, 55);
        return base;
    }

    /** 标签：最多 20 个、每个最多 30 字，去空去重 */
    private static List<String> parseTags(Object rawTags) {
        List<String> out = new ArrayList<>();
        if (rawTags instanceof List<?> list) {
            for (Object t : list) addTag(out, t);
        } else if (rawTags != null) {
            for (String s : String.valueOf(rawTags).split("[,，\\s]+")) addTag(out, s);
        }
        return out;
    }

    private static void addTag(List<String> out, Object raw) {
        if (out.size() >= MAX_TAGS) return;
        String s = raw == null ? "" : String.valueOf(raw).trim();
        if (s.isEmpty()) return;
        if (s.length() > MAX_TAG_LEN) s = s.substring(0, MAX_TAG_LEN);
        if (!out.contains(s)) out.add(s);
    }

    /** 兼容前端传 Boolean true、数字 1、字符串 "true"/"1" 三种置顶写法 */
    private static boolean truthy(Object v) {
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.intValue() == 1;
        if (v == null) return false;
        String s = String.valueOf(v).trim();
        return "true".equalsIgnoreCase(s) || "1".equals(s);
    }

    static String str(Object v, int max) {
        String s = v == null ? "" : String.valueOf(v);
        return s.length() > max ? s.substring(0, max) : s;
    }

    static int num(Object v, int dft) {
        try {
            return v == null ? dft : Integer.parseInt(String.valueOf(v));
        } catch (NumberFormatException e) {
            return dft;
        }
    }
}
