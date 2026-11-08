package com.kimon.blog.web;

import com.kimon.blog.auth.AuthFilter;
import com.kimon.blog.auth.CookieUtil;
import com.kimon.blog.auth.JwtService;
import com.kimon.blog.entity.Post;
import com.kimon.blog.entity.Resource;
import com.kimon.blog.entity.User;
import com.kimon.blog.service.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 后台：登录态、文章、日记、笔记、资源、分类标签、导出 */
@RestController
@RequestMapping("/api/admin")
public class AdminContentController {

    private final AuthService auth;
    private final JwtService jwt;
    private final CookieUtil cookies;
    private final PostService postService;
    private final ResourceService resourceService;
    private final DiaryService diaryService;
    private final NotesService notesService;
    private final TermService termService;
    private final CommentService commentService;
    private final GalleryService galleryService;
    private final SettingsService settings;

    /** 初始化口令：配置后首次建管理员必须带上，防止公网被人抢注。空 = 不启用。 */
    @Value("${app.setup-token:}")
    private String setupToken;

    public AdminContentController(AuthService auth, JwtService jwt, CookieUtil cookies,
                                  PostService postService, ResourceService resourceService,
                                  DiaryService diaryService, NotesService notesService,
                                  TermService termService, CommentService commentService,
                                  GalleryService galleryService, SettingsService settings) {
        this.auth = auth;
        this.jwt = jwt;
        this.cookies = cookies;
        this.postService = postService;
        this.resourceService = resourceService;
        this.diaryService = diaryService;
        this.notesService = notesService;
        this.termService = termService;
        this.commentService = commentService;
        this.galleryService = galleryService;
        this.settings = settings;
    }

    /* ---------- 登录相关（拦截器放行） ---------- */

    @GetMapping("/state")
    public Map<String, Object> state(HttpServletRequest req) {
        String name = (String) req.getAttribute(AuthFilter.ATTR_NAME);
        String role = (String) req.getAttribute(AuthFilter.ATTR_ROLE);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("needSetup", !auth.hasAdmin());
        /* 配置了 app.setup-token 时前端要多填一个初始化口令 */
        out.put("setupTokenRequired", setupToken != null && !setupToken.isBlank());
        out.put("user", name == null ? null : Map.of("name", name, "role", role));
        return out;
    }

    @PostMapping("/setup")
    public Map<String, Object> setup(@RequestBody Map<String, Object> body,
                                     HttpServletRequest req, HttpServletResponse res) {
        /* 已配置初始化口令时先用常量时间比较挡住猜解，再走服务层的并发安全创建 */
        String expected = setupToken == null ? "" : setupToken.trim();
        if (!expected.isEmpty()) {
            String provided = PublicApiController.str(body.get("setupToken")).trim();
            if (!setupTokenEquals(expected, provided)) {
                throw new IllegalArgumentException("初始化口令不对");
            }
        }
        /* 不再在 web 层 hasAdmin()+createAdmin 两步判断：交给 service 的
           synchronized 方法，数据库层面抢注与并发初始化只会有一次成功。 */
        User u = auth.createFirstAdminIfNone(
                PublicApiController.str(body.get("name")),
                PublicApiController.str(body.get("password")));
        if (u == null) throw new IllegalArgumentException("初始化失败，请重试");
        cookies.write(res, CookieUtil.SESSION, jwt.issue(u.getName(), u.getRole()), (int) (JwtService.TTL_MS / 1000));
        VisitorLog.event(req, "admin_setup", "name", u.getName());
        return Map.of("ok", true, "user", Map.of("name", u.getName(), "role", u.getRole()));
    }

    /** 常量时间比较初始化口令，避免按响应时间逐位猜解 */
    private static boolean setupTokenEquals(String expected, String provided) {
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                provided.getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body,
                                     HttpServletRequest req, HttpServletResponse res) {
        String name = PublicApiController.str(body.get("name"));
        try {
            User u = auth.login(name, PublicApiController.str(body.get("password")));
            cookies.write(res, CookieUtil.SESSION, jwt.issue(u.getName(), u.getRole()), (int) (JwtService.TTL_MS / 1000));
            VisitorLog.event(req, "admin_login", "name", u.getName(), "result", "ok");
            return Map.of("ok", true, "user", Map.of("name", u.getName(), "role", u.getRole()));
        } catch (RuntimeException e) {
            VisitorLog.event(req, "admin_login", "name", name, "result", "fail");
            throw e;
        }
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest req, HttpServletResponse res) {
        cookies.clear(res, CookieUtil.SESSION);
        VisitorLog.event(req, "admin_logout", "name", req.getAttribute(AuthFilter.ATTR_NAME));
        return Map.of("ok", true);
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req) {
        return Map.of("user", Map.of(
                "name", String.valueOf(req.getAttribute(AuthFilter.ATTR_NAME)),
                "role", String.valueOf(req.getAttribute(AuthFilter.ATTR_ROLE))));
    }

    /* ---------- 文章 ---------- */

    @GetMapping("/posts")
    public Map<String, Object> posts(@RequestParam(defaultValue = "all") String status,
                                     @RequestParam(defaultValue = "") String q) {
        List<Map<String, Object>> items = postService.list(status, q).stream()
                .map(postService::toListJson).toList();
        return Map.of("items", items);
    }

    @GetMapping("/posts/{id}")
    public Map<String, Object> post(@PathVariable String id) {
        Post p = postService.get(id);
        if (p == null) throw new IllegalArgumentException("文章不存在");
        return Map.of("item", postService.toJson(p));
    }

    @PostMapping("/posts")
    public Map<String, Object> createPost(@RequestBody Map<String, Object> body) {
        return Map.of("item", postService.toJson(postService.save(body, null)));
    }

    @PutMapping("/posts/{id}")
    public Map<String, Object> updatePost(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return Map.of("item", postService.toJson(postService.save(body, id)));
    }

    @DeleteMapping("/posts/{id}")
    public Map<String, Object> deletePost(@PathVariable String id) {
        postService.delete(id);
        return Map.of("ok", true);
    }

    /* ---------- 日记 ---------- */

    @GetMapping("/diary")
    public Map<String, Object> diary() {
        return Map.of("books", diaryService.all());
    }

    @PostMapping("/diary/books")
    public Map<String, Object> createBook(@RequestBody Map<String, Object> body) {
        return Map.of("id", diaryService.createBook(body));
    }

    @PutMapping("/diary/books/{id}")
    public Map<String, Object> updateBook(@PathVariable String id, @RequestBody Map<String, Object> body) {
        diaryService.updateBook(id, body);
        return Map.of("ok", true);
    }

    @DeleteMapping("/diary/books/{id}")
    public Map<String, Object> deleteBook(@PathVariable String id) {
        diaryService.deleteBook(id);
        return Map.of("ok", true);
    }

    @PostMapping("/diary/entries")
    public Map<String, Object> createEntry(@RequestBody Map<String, Object> body) {
        return Map.of("id", diaryService.createEntry(body));
    }

    @PutMapping("/diary/entries/{id}")
    public Map<String, Object> updateEntry(@PathVariable String id, @RequestBody Map<String, Object> body) {
        diaryService.updateEntry(id, body);
        return Map.of("ok", true);
    }

    @DeleteMapping("/diary/entries/{id}")
    public Map<String, Object> deleteEntry(@PathVariable String id) {
        diaryService.deleteEntry(id);
        return Map.of("ok", true);
    }

    /* ---------- 笔记与术语 ---------- */

    @GetMapping("/notes")
    public Map<String, Object> notes() {
        return notesService.get();
    }

    @PutMapping("/notes")
    public Map<String, Object> saveNotes(@RequestBody Map<String, Object> body) {
        return notesService.save(body);
    }

    /* ---------- 相册 ---------- */

    @GetMapping("/gallery")
    public Map<String, Object> gallery() {
        return galleryService.get();
    }

    @PutMapping("/gallery")
    public Map<String, Object> saveGallery(@RequestBody Map<String, Object> body) {
        return galleryService.save(body);
    }

    @GetMapping("/terms")
    public Map<String, Object> terms() {
        return termService.terms();
    }

    @PostMapping("/terms/add")
    public Map<String, Object> addTerm(@RequestBody Map<String, Object> body) {
        termService.add(PublicApiController.str(body.get("kind")),
                PublicApiController.str(body.get("name")));
        return termService.terms();
    }

    @PostMapping("/terms/rename")
    public Map<String, Object> renameTerm(@RequestBody Map<String, Object> body) {
        termService.rename(PublicApiController.str(body.get("kind")),
                PublicApiController.str(body.get("from")), PublicApiController.str(body.get("to")));
        return termService.terms();
    }

    @PostMapping("/terms/delete")
    public Map<String, Object> deleteTerm(@RequestBody Map<String, Object> body) {
        termService.delete(PublicApiController.str(body.get("kind")), PublicApiController.str(body.get("name")));
        return termService.terms();
    }

    /* ---------- 资源 ---------- */

    @GetMapping("/resources")
    public Map<String, Object> resources() {
        return Map.of("items", resourceService.list());
    }

    @PostMapping("/resources")
    public Map<String, Object> createResource(@RequestBody Map<String, Object> body) {
        return Map.of("item", resourceService.toJson(resourceService.save(body, null)));
    }

    @PutMapping("/resources/{id}")
    public Map<String, Object> updateResource(@PathVariable long id, @RequestBody Map<String, Object> body) {
        return Map.of("item", resourceService.toJson(resourceService.save(body, id)));
    }

    @DeleteMapping("/resources/{id}")
    public Map<String, Object> deleteResource(@PathVariable long id) {
        resourceService.delete(id);
        return Map.of("ok", true);
    }

    /* ---------- 导出备份 ---------- */

    @GetMapping("/export")
    public Map<String, Object> export() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("exportedAt", java.time.Instant.now().toString());
        out.put("site", settings.site());
        out.put("posts", postService.list("all", "").stream().map(postService::toJson).toList());
        out.put("resources", resourceService.list());
        out.put("diary", diaryService.all());
        out.put("notes", notesService.get());
        out.put("gallery", galleryService.get());
        out.put("guestbook", commentService.visible("guestbook"));
        return out;
    }
}
