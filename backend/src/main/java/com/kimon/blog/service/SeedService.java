package com.kimon.blog.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.kimon.blog.entity.Comment;
import com.kimon.blog.entity.DiaryBook;
import com.kimon.blog.entity.DiaryEntry;
import com.kimon.blog.entity.Document;
import com.kimon.blog.entity.Post;
import com.kimon.blog.entity.Resource;
import com.kimon.blog.mapper.CommentMapper;
import com.kimon.blog.mapper.DiaryBookMapper;
import com.kimon.blog.mapper.DiaryEntryMapper;
import com.kimon.blog.mapper.DocumentMapper;
import com.kimon.blog.mapper.PostMapper;
import com.kimon.blog.mapper.ResourceMapper;
import com.kimon.blog.util.Json;
import com.kimon.blog.util.Time;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.util.List;
import java.util.Map;

/**
 * 首次启动把 seed.json（原来静态站的内容）导入数据库。
 *
 * 整个导入放在一个事务里：任何一张表写入失败，全部回滚、seed 标记也不会写，
 * 下次启动会重新导入，不会出现「导了一半、内容残缺」的中间状态。
 * 真正的「只导一次」判断在 SeedRunner 里（settings.seeded）。
 */
@Service
public class SeedService {

    private static final Logger log = LoggerFactory.getLogger(SeedService.class);

    private final PostMapper posts;
    private final ResourceMapper resources;
    private final DiaryBookMapper books;
    private final DiaryEntryMapper entries;
    private final DocumentMapper documents;
    private final CommentMapper comments;
    private final SettingsService settings;

    public SeedService(PostMapper posts, ResourceMapper resources, DiaryBookMapper books,
                       DiaryEntryMapper entries, DocumentMapper documents, CommentMapper comments,
                       SettingsService settings) {
        this.posts = posts;
        this.resources = resources;
        this.books = books;
        this.entries = entries;
        this.documents = documents;
        this.comments = comments;
        this.settings = settings;
    }

    /**
     * 原子导入种子数据。成功返回后调用方再写 settings.seeded=1；
     * 抛异常时事务回滚，调用方不能写 seeded 标记。
     */
    @Transactional
    @SuppressWarnings("unchecked")
    public void importSeed() {
        ClassPathResource res = new ClassPathResource("seed.json");
        if (!res.exists()) {
            log.info("没有找到 seed.json，跳过内容导入");
            return;
        }

        Map<String, Object> root;
        try (InputStream in = res.getInputStream()) {
            root = Json.MAPPER.readValue(in, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("种子数据读取失败", e);
        }

        if (root.get("site") instanceof Map) {
            settings.saveSite((Map<String, Object>) root.get("site"));
        }

        String now = Time.now().toString();
        int postCount = 0;
        for (Object o : list(root.get("posts"))) {
            Map<String, Object> m = (Map<String, Object>) o;
            Post p = new Post();
            p.setId(str(m.get("id")));
            p.setSection(str(m.get("section")));
            p.setTitle(str(m.get("title")));
            p.setExcerpt(str(m.get("excerpt")));
            p.setBody(str(m.get("body")));
            p.setCat(str(m.get("cat")));
            p.setTags(str(m.get("tags")));
            p.setMinutes(m.get("minutes") instanceof Number n ? n.intValue() : 5);
            p.setPinned(m.get("pinned") instanceof Number n2 ? n2.intValue() : 0);
            p.setCover(str(m.get("cover")));
            p.setStatus(str(m.get("status")).isBlank() ? "published" : str(m.get("status")));
            p.setViews(m.get("views") instanceof Number n3 ? n3.intValue() : 0);
            p.setDate(str(m.get("date")));
            p.setCreatedAt(now);
            p.setUpdatedAt(now);
            posts.insert(p);
            postCount++;
        }

        for (Object o : list(root.get("resources"))) {
            Map<String, Object> m = (Map<String, Object>) o;
            Resource r = new Resource();
            r.setName(str(m.get("name")));
            r.setIcon(str(m.get("icon")));
            r.setTint(str(m.get("tint")));
            r.setVersion(str(m.get("version")));
            r.setSize(str(m.get("size")));
            r.setLang(str(m.get("lang")));
            r.setDescr(str(m.get("descr")));
            r.setDownloads(m.get("downloads") instanceof Number n ? n.intValue() : 0);
            r.setDate(str(m.get("date")));
            r.setFile(str(m.get("file")));
            r.setCreatedAt(now);
            resources.insert(r);
        }

        for (Object o : list(root.get("diaryBooks"))) {
            Map<String, Object> m = (Map<String, Object>) o;
            DiaryBook b = new DiaryBook();
            b.setId(str(m.get("id")));
            b.setName(str(m.get("name")));
            b.setIntro(str(m.get("intro")));
            b.setAccent(str(m.get("accent")));
            b.setSort(m.get("sort") instanceof Number n ? n.intValue() : 0);
            b.setCreatedAt(now);
            books.insert(b);

            for (Object eo : list(m.get("entries"))) {
                Map<String, Object> e = (Map<String, Object>) eo;
                DiaryEntry de = new DiaryEntry();
                de.setId(str(e.get("id")));
                de.setBookId(b.getId());
                de.setDayNo(e.get("day") instanceof Number dn ? dn.intValue() : null);
                de.setDate(str(e.get("date")));
                de.setWeekday(str(e.get("weekday")));
                de.setCat(str(e.get("cat")));
                de.setTitle(str(e.get("title")));
                de.setBody(str(e.get("body")));
                de.setSort(e.get("sort") instanceof Number sn ? sn.intValue() : 0);
                de.setCreatedAt(now);
                entries.insert(de);
            }
        }

        if (root.get("notes") instanceof Map) {
            Document d = new Document();
            d.setK("notes");
            d.setJson(Json.write(root.get("notes")));
            d.setUpdatedAt(now);
            documents.insert(d);
        }

        for (Object o : list(root.get("guestbook"))) {
            Map<String, Object> m = (Map<String, Object>) o;
            Comment c = new Comment();
            c.setTarget("guestbook");
            c.setName(str(m.get("name")));
            c.setUid("");
            c.setBody(str(m.get("body")));
            c.setStatus("approved");
            c.setIp("");
            c.setUa("");
            c.setCreatedAt(str(m.get("created_at")).isBlank() ? now : str(m.get("created_at")));
            comments.insert(c);
        }

        log.info("种子导入完成：{} 篇文章，{} 个资源", postCount, list(root.get("resources")).size());
    }

    private static List<?> list(Object o) {
        return o instanceof List ? (List<?>) o : List.of();
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
