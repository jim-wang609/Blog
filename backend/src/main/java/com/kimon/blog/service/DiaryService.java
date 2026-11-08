package com.kimon.blog.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kimon.blog.entity.DiaryBook;
import com.kimon.blog.entity.DiaryEntry;
import com.kimon.blog.mapper.DiaryBookMapper;
import com.kimon.blog.mapper.DiaryEntryMapper;
import com.kimon.blog.util.Time;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 日记：多本日记本 + 条目 */
@Service
public class DiaryService {

    private final DiaryBookMapper books;
    private final DiaryEntryMapper entries;

    public DiaryService(DiaryBookMapper books, DiaryEntryMapper entries) {
        this.books = books;
        this.entries = entries;
    }

    /** 前台需要的结构：每本带上自己的条目 */
    public List<Map<String, Object>> all() {
        List<DiaryBook> list = books.selectList(new QueryWrapper<DiaryBook>().orderByAsc("sort"));
        List<DiaryEntry> allEntries = entries.selectList(new QueryWrapper<DiaryEntry>()
                .orderByDesc("date").orderByAsc("sort"));

        List<Map<String, Object>> out = new ArrayList<>();
        for (DiaryBook b : list) {
            Map<String, Object> book = new LinkedHashMap<>();
            book.put("id", b.getId());
            book.put("name", b.getName());
            book.put("desc", b.getIntro() == null ? "" : b.getIntro());
            book.put("accent", b.getAccent());

            List<Map<String, Object>> es = new ArrayList<>();
            for (DiaryEntry e : allEntries) {
                if (!b.getId().equals(e.getBookId())) continue;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", e.getId());
                m.put("day", e.getDayNo());
                m.put("date", e.getDate());
                m.put("weekday", e.getWeekday());
                m.put("cat", e.getCat());
                m.put("title", e.getTitle());
                m.put("body", e.getBody());
                es.add(m);
            }
            book.put("entries", es);
            out.add(book);
        }
        return out;
    }

    public String createBook(Map<String, Object> body) {
        String name = PostService.str(body.get("name"), 60).trim();
        if (name.isEmpty()) throw new IllegalArgumentException("本子名字不能为空");
        String id = PostService.str(body.get("id"), 40).trim();
        if (id.isEmpty()) id = "book-" + Long.toString(System.currentTimeMillis(), 36);
        if (books.selectById(id) != null) id = id + "-" + Integer.toHexString((int) (Math.random() * 4096));

        DiaryBook b = new DiaryBook();
        b.setId(id);
        b.setName(name);
        b.setIntro(PostService.str(body.get("desc"), 300));
        b.setAccent(PostService.str(body.get("accent"), 16).isBlank() ? "amber" : PostService.str(body.get("accent"), 16));
        b.setSort(nextBookSort());
        b.setCreatedAt(Time.now().toString());
        books.insert(b);
        return id;
    }

    public void updateBook(String id, Map<String, Object> body) {
        DiaryBook b = books.selectById(id);
        if (b == null) throw new IllegalArgumentException("日记本不存在");
        b.setName(PostService.str(body.get("name"), 60).isBlank() ? "未命名" : PostService.str(body.get("name"), 60));
        b.setIntro(PostService.str(body.get("desc"), 300));
        b.setAccent(PostService.str(body.get("accent"), 16).isBlank() ? "amber" : PostService.str(body.get("accent"), 16));
        books.updateById(b);
    }

    /**
     * 删日记本（连同条目）：synchronized + 事务，检查「至少留一本」与删除在同一个临界区里，
     * 避免两个后台请求同时删掉最后两本、把日记删到 0 本。
     */
    @Transactional
    public synchronized void deleteBook(String id) {
        if (books.selectById(id) == null) throw new IllegalArgumentException("日记本不存在");
        if (books.selectCount(null) <= 1) throw new IllegalArgumentException("至少要留一本日记");
        entries.delete(new QueryWrapper<DiaryEntry>().eq("book_id", id));
        books.deleteById(id);
    }

    public String createEntry(Map<String, Object> body) {
        String title = PostService.str(body.get("title"), 200).trim();
        if (title.isEmpty()) throw new IllegalArgumentException("标题不能为空");
        String bookId = PostService.str(body.get("bookId"), 60);
        if (books.selectById(bookId) == null) throw new IllegalArgumentException("日记本不存在");

        DiaryEntry e = new DiaryEntry();
        e.setId("e-" + Long.toString(System.currentTimeMillis(), 36) + "-" + Integer.toHexString((int) (Math.random() * 4096)));
        fillEntry(e, body, title);
        e.setBookId(bookId);
        e.setSort(nextEntrySort(bookId));
        e.setCreatedAt(Time.now().toString());
        entries.insert(e);
        return e.getId();
    }

    public void updateEntry(String id, Map<String, Object> body) {
        DiaryEntry e = entries.selectById(id);
        if (e == null) throw new IllegalArgumentException("条目不存在");
        fillEntry(e, body, PostService.str(body.get("title"), 200).isBlank() ? "无标题" : PostService.str(body.get("title"), 200));
        entries.updateById(e);
    }

    public void deleteEntry(String id) {
        DiaryEntry e = entries.selectById(id);
        if (e == null) throw new IllegalArgumentException("条目不存在");
        entries.deleteById(id);
    }

    private void fillEntry(DiaryEntry e, Map<String, Object> body, String title) {
        Object day = body.get("day");
        e.setDayNo(day == null || String.valueOf(day).isBlank() ? null : PostService.num(day, 0));
        e.setDate(PostService.str(body.get("date"), 10));
        e.setWeekday(PostService.str(body.get("weekday"), 12));
        e.setCat(PostService.str(body.get("cat"), 16).isBlank() ? "daily" : PostService.str(body.get("cat"), 16));
        e.setTitle(title);
        e.setBody(PostService.str(body.get("body"), 20000));
    }

    private int nextBookSort() {
        return books.selectList(null).stream()
                .mapToInt(b -> b.getSort() == null ? 0 : b.getSort()).max().orElse(0) + 1;
    }

    private int nextEntrySort(String bookId) {
        return entries.selectList(new QueryWrapper<DiaryEntry>().eq("book_id", bookId)).stream()
                .mapToInt(e -> e.getSort() == null ? 0 : e.getSort()).max().orElse(0) + 1;
    }
}
