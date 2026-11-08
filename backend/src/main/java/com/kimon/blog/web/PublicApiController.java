package com.kimon.blog.web;

import com.kimon.blog.auth.AuthFilter;
import com.kimon.blog.auth.CookieUtil;
import com.kimon.blog.auth.JwtService;
import com.kimon.blog.entity.Resource;
import com.kimon.blog.entity.User;
import com.kimon.blog.service.AuthService;
import com.kimon.blog.service.CommentService;
import com.kimon.blog.service.DiaryService;
import com.kimon.blog.service.GalleryService;
import com.kimon.blog.service.GithubService;
import com.kimon.blog.service.NotesService;
import com.kimon.blog.service.PostService;
import com.kimon.blog.service.ResourceService;
import com.kimon.blog.service.SettingsService;
import com.kimon.blog.service.StatsService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 前台与访客能访问的接口 */
@RestController
@RequestMapping("/api")
public class PublicApiController {

    private final PostService postService;
    private final ResourceService resourceService;
    private final DiaryService diaryService;
    private final NotesService notesService;
    private final CommentService commentService;
    private final GalleryService galleryService;
    private final GithubService github;
    private final SettingsService settings;
    private final StatsService stats;
    private final AuthService auth;
    private final JwtService jwt;
    private final CookieUtil cookies;

    @Value("${app.upload-dir:../uploads}")
    private String uploadDir;

    public PublicApiController(PostService postService, ResourceService resourceService,
                               DiaryService diaryService, NotesService notesService,
                               CommentService commentService, GalleryService galleryService,
                               SettingsService settings, StatsService stats, AuthService auth,
                               JwtService jwt, CookieUtil cookies, GithubService github) {
        this.postService = postService;
        this.resourceService = resourceService;
        this.diaryService = diaryService;
        this.notesService = notesService;
        this.commentService = commentService;
        this.galleryService = galleryService;
        this.github = github;
        this.settings = settings;
        this.stats = stats;
        this.auth = auth;
        this.jwt = jwt;
        this.cookies = cookies;
    }

    /** 前台一次性拉全站数据 */
    @GetMapping("/bootstrap")
    public Map<String, Object> bootstrap() {
        List<Map<String, Object>> posts = postService.published().stream().map(postService::toJson).toList();
        List<Map<String, Object>> resources = resourceService.list();

        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("posts", posts.size());
        counts.put("essays", posts.stream().filter(p -> "essay".equals(p.get("section"))).count());
        counts.put("comments", commentService.countVisible(true));
        counts.put("views", posts.stream().mapToLong(p -> ((Number) p.get("views")).longValue()).sum());
        /* 首页「累计访问」用真实埋点数，不再显示写死的占位数字 */
        counts.putAll(stats.publicCounts());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("site", settings.site());
        out.put("posts", posts);
        out.put("resources", resources);
        /* 日记不公开：只有管理员登录后通过 /api/admin/diary 获取 */
        out.put("notes", notesService.get());
        out.put("gallery", galleryService.get());
        out.put("guestbook", commentService.visible("guestbook"));
        out.put("counts", counts);
        return out;
    }

    /** 开源项目：按后台设置的 GitHub 主页 / 用户名自动读公开仓库 */
    @GetMapping("/github")
    public Map<String, Object> github() {
        return github.get();
    }

    /** 轻量版本号：前端每 60 秒先查它，发现变了再拉 /api/bootstrap，避免整站 JSON 反复传输 */
    @GetMapping("/rev")
    public Map<String, Object> rev() {
        try {
            Object updated = settings.site().get("updated");
            return Map.of("rev", updated == null ? "" : String.valueOf(updated));
        } catch (RuntimeException e) {
            /* 公开轮询接口不能因为设置表里的脏数据 500：拿不到就当未知版本 */
            return Map.of("rev", "");
        }
    }

    @GetMapping("/comments")
    public Map<String, Object> comments(@RequestParam(defaultValue = "guestbook") String target,
                                        @RequestParam(defaultValue = "100") int limit,
                                        @RequestParam(required = false) Long beforeId) {
        int size = Math.max(1, Math.min(100, limit));
        /* service 直接返回 { items, hasMore }，这里不再包一层，避免丢 hasMore */
        return commentService.pageVisible(target, size, beforeId);
    }

    @PostMapping("/comments")
    public Map<String, Object> postComment(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        String uid = (String) req.getAttribute(AuthFilter.ATTR_NAME);
        long parentId = 0L;
        Object raw = body.get("parentId");
        if (raw instanceof Number n) parentId = n.longValue();
        else if (raw instanceof String s && !s.isBlank()) {
            try { parentId = Long.parseLong(s.trim()); } catch (NumberFormatException ignored) {}
        }
        Map<String, Object> out = commentService.add(
                str(body.get("target")),
                str(body.get("body")),
                str(body.get("name")),
                uid,
                clientIp(req),
                req.getHeader("User-Agent"),
                parentId
        );
        Object pv = out.get("parentId");
        long actualParent = pv instanceof Number num ? num.longValue() : 0L;
        VisitorLog.event(req, actualParent > 0 ? "reply" : "comment",
                "target", str(body.get("target")),
                "parent", actualParent,
                "id", out.get("id"),
                "len", str(body.get("body")).length(),
                "name", out.get("name"));
        return out;
    }

    @PostMapping("/track")
    public Map<String, Object> track(@RequestBody Map<String, Object> body,
                                     HttpServletRequest req, HttpServletResponse res) {
        String vid = cookies.read(req, CookieUtil.VISITOR);
        if (vid == null || vid.isBlank()) {
            vid = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
            cookies.write(res, CookieUtil.VISITOR, vid, 365 * 24 * 3600);
        }
        String visitPath = str(body.get("path"));
        String ref = str(body.get("ref"));
        stats.track(visitPath, ref, vid);
        VisitorLog.event(req, "visit", "page", visitPath, "ref", ref, "vid", vid,
                "ua", VisitorLog.userAgent(req));
        return Map.of("ok", true);
    }

    @GetMapping("/session")
    public Map<String, Object> session(HttpServletRequest req) {
        String name = (String) req.getAttribute(AuthFilter.ATTR_NAME);
        String role = (String) req.getAttribute(AuthFilter.ATTR_ROLE);
        return Map.of("user", name == null ? Map.of() : Map.of("name", name, "role", role));
    }

    /** 访客账号登录：只能留言 */
    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body,
                                     HttpServletRequest req, HttpServletResponse res) {
        String name = str(body.get("name"));
        try {
            User u = auth.login(name, str(body.get("password")));
            cookies.write(res, CookieUtil.SESSION, jwt.issue(u.getName(), u.getRole()), (int) (JwtService.TTL_MS / 1000));
            VisitorLog.event(req, "login", "name", u.getName(), "role", u.getRole(), "result", "ok");
            return Map.of("ok", true, "user", Map.of("name", u.getName(), "role", u.getRole()));
        } catch (RuntimeException e) {
            /* 只记账号与失败，绝不把密码写进日志 */
            VisitorLog.event(req, "login", "name", name, "result", "fail");
            throw e;
        }
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest req, HttpServletResponse res) {
        cookies.clear(res, CookieUtil.SESSION);
        VisitorLog.event(req, "logout", "name", req.getAttribute(AuthFilter.ATTR_NAME));
        return Map.of("ok", true);
    }

    /** 文章阅读量 +1：前台打开详情页时上报 */
    @PostMapping("/view/{id}")
    public Map<String, Object> view(@PathVariable String id, HttpServletRequest req) {
        postService.bumpViews(id);
        VisitorLog.event(req, "read_article", "post", id);
        return Map.of("ok", true);
    }

    /** 下载并计数 */
    @GetMapping("/download/{id}")
    public ResponseEntity<?> download(@PathVariable long id, HttpServletRequest req) throws Exception {
        Resource r = resourceService.get(id);
        if (r == null || r.getFile() == null || r.getFile().isBlank()) {
            VisitorLog.event(req, "download", "resource", id, "result", "missing");
            return ResponseEntity.status(404).body(Map.of("error", "文件不存在"));
        }
        Path base = Path.of(uploadDir).toAbsolutePath().normalize();
        /* 后台上传回填的是 "/uploads/files/xxx"，而 uploadDir 本身就是 uploads/，
           直接 resolve 会拼成 uploads/uploads/files/xxx，永远 404。这里去掉重复前缀。 */
        String rel = r.getFile().startsWith("/") ? r.getFile().substring(1) : r.getFile();
        if (rel.startsWith("uploads/")) rel = rel.substring("uploads/".length());
        Path file = Path.of(rel);
        Path target = base.resolve(file).normalize();
        if (!target.startsWith(base) || !Files.isRegularFile(target)) {
            VisitorLog.event(req, "download", "resource", id, "result", "missing");
            return ResponseEntity.status(404).body(Map.of("error", "文件已被移除"));
        }

        resourceService.bumpDownloads(id);
        VisitorLog.event(req, "download", "resource", id, "name", target.getFileName().toString(),
                "bytes", Files.size(target), "result", "ok");

        String name = URLEncoder.encode(target.getFileName().toString(), StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + name)
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(Files.size(target))
                .body(new FileSystemResource(target));
    }

    static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    /**
     * 是否信任反向代理传来的真实 IP。生产环境只有本机 nginx 能连到后端
     * （服务只监听 127.0.0.1），所以默认信任；直连部署时可用 app.trust-proxy=false 关掉。
     */
    private static boolean trustProxy = true;

    @Value("${app.trust-proxy:true}")
    public void setTrustProxy(boolean trustProxy) {
        PublicApiController.trustProxy = trustProxy;
    }

    /**
     * 客户端 IP：优先 nginx 传入的 X-Real-IP，其次 X-Forwarded-For 的最后一段
     * （nginx 用 $proxy_add_x_forwarded_for 追加，最后一段是真实连入 IP，前面的可被伪造）；
     * 都拿不到才退回连接地址。结果去空白并截断，避免超长头写坏数据库 / 日志。
     */
    static String clientIp(HttpServletRequest req) {
        String ip = null;
        if (trustProxy) {
            ip = req.getHeader("X-Real-IP");
            if (ip == null || ip.isBlank()) {
                String xff = req.getHeader("X-Forwarded-For");
                if (xff != null && !xff.isBlank()) {
                    String[] parts = xff.split(",");
                    ip = parts[parts.length - 1];
                }
            }
        }
        if (ip == null || ip.isBlank()) ip = req.getRemoteAddr();
        ip = ip == null ? "" : ip.trim();
        return ip.length() > 64 ? ip.substring(0, 64) : ip;
    }
}
