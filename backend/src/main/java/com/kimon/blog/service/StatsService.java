package com.kimon.blog.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kimon.blog.entity.Post;
import com.kimon.blog.entity.Resource;
import com.kimon.blog.entity.Visit;
import com.kimon.blog.mapper.PostMapper;
import com.kimon.blog.mapper.ResourceMapper;
import com.kimon.blog.mapper.VisitMapper;
import com.kimon.blog.util.Time;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 访问统计与内容概况 */
@Service
public class StatsService {

    private static final Logger log = LoggerFactory.getLogger(StatsService.class);

    private final VisitMapper visits;
    private final PostMapper posts;
    private final ResourceMapper resources;
    private final CommentService comments;

    /** 访问记录保留天数，默认半年；每天凌晨清理一次 */
    @Value("${app.visits-retention-days:180}")
    private int retentionDays;

    public StatsService(VisitMapper visits, PostMapper posts, ResourceMapper resources, CommentService comments) {
        this.visits = visits;
        this.posts = posts;
        this.resources = resources;
        this.comments = comments;
    }

    public void track(String path, String ref, String vid) {
        Visit v = new Visit();
        v.setTs(java.time.Instant.now().toString());
        v.setDayNo(Time.today().toString());
        v.setPath(path == null || path.isBlank() ? "/" : (path.length() > 300 ? path.substring(0, 300) : path));
        v.setRef(ref == null ? "" : (ref.length() > 300 ? ref.substring(0, 300) : ref));
        v.setVid(vid == null ? "" : (vid.length() > 64 ? vid.substring(0, 64) : vid));
        visits.insert(v);
    }

    /**
     * 每天 03:30 清理过期的访问明细，避免 visits 表无限膨胀。
     * 只删明细，累计访问数会因此略微下降——这是保留策略的预期行为，配置在 app.visits-retention-days。
     */
    @Scheduled(cron = "0 30 3 * * *")
    public void cleanupOldVisits() {
        int days = Math.max(1, retentionDays);
        try {
            String before = Time.today().minusDays(days).toString();
            int n = visits.delete(new QueryWrapper<Visit>().lt("day_no", before));
            if (n > 0) log.info("已清理 {} 条 {} 天前的访问记录（早于 {}）", n, days, before);
        } catch (Exception e) {
            /* 清理失败不影响站点运行，下次定时任务会重试 */
            log.warn("清理访问记录失败：{}", e.getMessage());
        }
    }

    /** 前台首页「累计访问」用的公开计数，不带后台细节 */
    public Map<String, Object> publicCounts() {
        Map<String, Object> all = visits.totalStats();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("visits", num(all.get("n")));
        out.put("uniques", num(all.get("u")));
        return out;
    }

    public Map<String, Object> overview() {
        String today = Time.today().toString();
        String weekAgo = Time.today().minusDays(6).toString();
        String monthAgo = Time.today().minusDays(29).toString();

        Map<String, Object> day = visits.dayStats(today);
        Map<String, Object> all = visits.totalStats();

        Map<String, Object> v = new LinkedHashMap<>();
        v.put("today", num(day.get("n")));
        v.put("todayUniques", num(day.get("u")));
        v.put("week", visits.countSince(weekAgo));
        v.put("month", visits.countSince(monthAgo));
        v.put("total", num(all.get("n")));
        v.put("uniques", num(all.get("u")));

        /* 30 天趋势，没数据的日子补 0 */
        Map<String, long[]> byDay = new LinkedHashMap<>();
        for (Map<String, Object> row : visits.seriesSince(monthAgo)) {
            byDay.put(String.valueOf(row.get("visit_day")),
                    new long[]{num(row.get("n")), num(row.get("u"))});
        }
        List<Map<String, Object>> series = new ArrayList<>();
        for (int i = 29; i >= 0; i--) {
            String d = Time.today().minusDays(i).toString();
            long[] hit = byDay.getOrDefault(d, new long[]{0, 0});
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("day", d);
            item.put("views", hit[0]);
            item.put("uniques", hit[1]);
            series.add(item);
        }

        List<Map<String, Object>> topRefs = new ArrayList<>();
        for (Map<String, Object> row : visits.topRefs(monthAgo)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("ref", row.get("ref"));
            item.put("n", num(row.get("n")));
            topRefs.add(item);
        }

        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("posts", posts.selectCount(new QueryWrapper<Post>().eq("status", "published")));
        counts.put("drafts", posts.selectCount(new QueryWrapper<Post>().eq("status", "draft")));
        counts.put("comments", comments.countVisible(true));
        counts.put("guestbook", comments.countVisible(false) - comments.countVisible(true));
        counts.put("resources", resources.selectCount(null));
        counts.put("downloads", resources.selectList(null).stream()
                .mapToLong(r -> r.getDownloads() == null ? 0 : r.getDownloads()).sum());

        List<Map<String, Object>> topPosts = new ArrayList<>();
        for (Post p : posts.selectList(new QueryWrapper<Post>()
                .eq("status", "published").orderByDesc("views").last("LIMIT 5"))) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", p.getId());
            item.put("title", p.getTitle());
            item.put("views", p.getViews() == null ? 0 : p.getViews());
            topPosts.add(item);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("visits", v);
        out.put("series", series);
        out.put("topRefs", topRefs);
        out.put("counts", counts);
        out.put("topPosts", topPosts);
        out.put("recentComments", comments.recent(6));
        return out;
    }

    private static long num(Object o) {
        if (o == null) return 0;
        if (o instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(String.valueOf(o));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
