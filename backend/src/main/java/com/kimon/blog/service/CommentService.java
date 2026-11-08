package com.kimon.blog.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kimon.blog.entity.Comment;
import com.kimon.blog.mapper.CommentMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** 评论与留言：共用一张表，target 区分。免审核，提交即显示；站长可在后台删除。 */
@Service
public class CommentService {

    private static final String DEFAULT_TARGET = "guestbook";
    private static final int MAX_BODY = 1200;
    private static final int MAX_TARGET = 60;
    private static final int MAX_NAME = 60;
    private static final int MAX_IP = 64;
    private static final int MAX_UA = 300;
    /** 前台分页单页上限（bootstrap 的 visible 也走这里） */
    private static final int MAX_PAGE = 100;
    /** 后台分页单页上限，防止一次拉爆 */
    private static final int MAX_ADMIN_PAGE = 200;

    private final CommentMapper comments;

    public CommentService(CommentMapper comments) {
        this.comments = comments;
    }

    public Map<String, Object> toJson(Comment c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.getId());
        m.put("target", c.getTarget());
        m.put("parentId", c.getParentId() == null ? 0L : c.getParentId());
        m.put("name", c.getName() == null || c.getName().isBlank() ? "匿名访客" : c.getName());
        m.put("uid", c.getUid() == null ? "" : c.getUid());
        m.put("body", c.getBody());
        m.put("status", c.getStatus());
        m.put("createdAt", c.getCreatedAt());
        return m;
    }

    /** 状态只用于兼容旧数据：历史上标过 spam 的仍然隐藏，旧的 pending 现在也照常显示。 */
    private static QueryWrapper<Comment> notSpam() {
        QueryWrapper<Comment> w = new QueryWrapper<>();
        w.and(q -> q.isNull("status").or().ne("status", "spam"));
        return w;
    }

    /**
     * 前台评论分页：按 created_at DESC, id DESC，beforeId 为上一页最后一条的 id（游标分页）。
     * 返回 {"items": [...], "hasMore": boolean}，内部多取一条判断是否还有下一页。
     */
    public Map<String, Object> pageVisible(String target, int limit, Long beforeId) {
        int lim = clamp(limit, 1, MAX_PAGE);
        String t = normalizeTarget(target);

        QueryWrapper<Comment> w = notSpam();
        w.eq("target", t);
        if (beforeId != null) w.lt("id", beforeId);
        w.orderByDesc("created_at").orderByDesc("id").last("LIMIT " + (lim + 1));

        List<Comment> rows = comments.selectList(w);
        boolean hasMore = rows.size() > lim;
        List<Comment> page = hasMore ? rows.subList(0, lim) : rows;

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", page.stream().map(this::toJson).collect(Collectors.toList()));
        out.put("hasMore", hasMore);
        return out;
    }

    /**
     * 后台评论分页：条件与 adminList 一致（留言板只看 guestbook，文章评论排除 guestbook），
     * 返回 {"items": [...], "total": long}，total 用同一条件的 count。
     */
    public Map<String, Object> adminPage(boolean guestbook, boolean postsOnly, int limit, int offset) {
        int lim = clamp(limit, 1, MAX_ADMIN_PAGE);
        int off = Math.max(0, offset);

        QueryWrapper<Comment> w = adminFilter(guestbook, postsOnly);
        long total = comments.selectCount(w);
        w.orderByDesc("created_at").last("LIMIT " + lim + " OFFSET " + off);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", comments.selectList(w).stream().map(this::toJson).collect(Collectors.toList()));
        out.put("total", total);
        return out;
    }

    /** 前台可见的评论 / 留言（bootstrap 用，取最新 100 条）。 */
    public List<Map<String, Object>> visible(String target) {
        Object items = pageVisible(target, MAX_PAGE, null).get("items");
        if (items instanceof List<?> list) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> out = (List<Map<String, Object>>) list;
            return out;
        }
        return List.of();
    }

    /** 后台列表（旧接口保留）：留言板 scope 只看 guestbook，评论 scope 看文章评论，按时间倒序。 */
    public List<Map<String, Object>> adminList(boolean guestbook, boolean postsOnly) {
        QueryWrapper<Comment> w = adminFilter(guestbook, postsOnly);
        w.orderByDesc("created_at").last("LIMIT 300");
        return comments.selectList(w).stream().map(this::toJson).collect(Collectors.toList());
    }

    /**
     * 访客提交：免登录、免审核，落库后前台立刻可见。
     * 唯一的管理动作是后台删除；限流按 IP 保留，避免刷屏。
     */
    public Map<String, Object> add(String target, String body, String name, String uid,
                                   String ip, String ua, long parentId) {
        String text = body == null ? "" : body.trim();
        if (text.isEmpty()) throw new IllegalArgumentException("留言内容不能为空");
        if (text.length() > MAX_BODY) text = text.substring(0, MAX_BODY);

        String t = normalizeTarget(target);
        boolean logged = uid != null && !uid.isBlank();
        String ipText = truncate(ip == null ? "" : ip.trim(), MAX_IP);

        /* 楼中回复只对文章评论开放，且必须挂在同一个 target 下的一条真实评论上；
           若对方本身也是回复，就统一挂到它的父评论，避免出现三层嵌套。 */
        long parent = 0L;
        if (parentId > 0 && !DEFAULT_TARGET.equals(t)) {
            Comment p = comments.selectById(parentId);
            if (p != null && t.equals(p.getTarget())) {
                Long grand = p.getParentId();
                parent = (grand != null && grand > 0) ? grand : p.getId();
            }
        }

        long recent = comments.selectCount(new QueryWrapper<Comment>()
                .eq("ip", ipText)
                .gt("created_at", Instant.now().minusSeconds(600).toString()));
        int cap = logged ? 20 : 5;
        if (recent >= cap) throw new IllegalArgumentException("发得太频繁了，过一会儿再试");

        Comment c = new Comment();
        c.setTarget(t);
        c.setParentId(parent);
        c.setName(logged
                ? truncate(uid.trim(), MAX_NAME)
                : (name == null || name.isBlank() ? "匿名访客" : truncate(name.trim(), MAX_NAME)));
        c.setUid(logged ? truncate(uid.trim(), MAX_NAME) : "");
        c.setBody(text);
        c.setStatus("approved");
        c.setIp(ipText);
        c.setUa(truncate(ua == null ? "" : ua.trim(), MAX_UA));
        c.setCreatedAt(Instant.now().toString());
        comments.insert(c);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", c.getId());
        out.put("status", c.getStatus());
        out.put("parentId", parent);
        out.put("name", c.getName());
        return out;
    }

    /** 删顶层评论时，把它下面的楼中回复一起删掉，避免留下孤儿回复。 */
    @Transactional
    public void delete(long id) {
        comments.delete(new QueryWrapper<Comment>().eq("parent_id", id));
        comments.deleteById(id);
    }

    public long countVisible(boolean excludeGuestbook) {
        QueryWrapper<Comment> w = notSpam();
        if (excludeGuestbook) w.ne("target", DEFAULT_TARGET);
        return comments.selectCount(w);
    }

    public List<Map<String, Object>> recent(int limit) {
        int lim = clamp(limit, 1, MAX_ADMIN_PAGE);
        return comments.selectList(new QueryWrapper<Comment>()
                        .orderByDesc("created_at").last("LIMIT " + lim))
                .stream().map(this::toJson).collect(Collectors.toList());
    }

    /* ---------- 内部 ---------- */

    private static QueryWrapper<Comment> adminFilter(boolean guestbook, boolean postsOnly) {
        QueryWrapper<Comment> w = new QueryWrapper<>();
        if (guestbook) w.eq("target", DEFAULT_TARGET);
        if (postsOnly) w.ne("target", DEFAULT_TARGET);
        return w;
    }

    private static String normalizeTarget(String target) {
        String t = target == null ? "" : target.trim();
        if (t.isEmpty()) t = DEFAULT_TARGET;
        return truncate(t, MAX_TARGET);
    }

    private static String truncate(String s, int max) {
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
