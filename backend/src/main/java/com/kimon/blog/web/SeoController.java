package com.kimon.blog.web;

import com.kimon.blog.entity.Post;
import com.kimon.blog.service.PostService;
import com.kimon.blog.service.SettingsService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 站点自带的 SEO 端点：robots.txt 与 sitemap.xml。
 * 静态文件也可以放仓库根由 Nginx 直接发，但文章列表会变，
 * 交给后端生成才能保证 sitemap 及时反映已发布文章。
 */
@RestController
public class SeoController {

    /** 固定页面（文章详情由数据库动态生成） */
    private static final String[] STATIC_PAGES = {
            "/", "/home.html", "/tech.html", "/essays.html",
            "/notes.html", "/resources.html", "/gallery.html"
    };

    private final PostService posts;
    private final SettingsService settings;

    /** 配了 app.base-url 就以它为准（例如 https://blog.example.com），否则按请求头推导 */
    @Value("${app.base-url:}")
    private String configuredBaseUrl;

    public SeoController(PostService posts, SettingsService settings) {
        this.posts = posts;
        this.settings = settings;
    }

    @GetMapping("/robots.txt")
    public ResponseEntity<String> robots(HttpServletRequest req) {
        StringBuilder sb = new StringBuilder(256);
        sb.append("User-agent: *\n");
        sb.append("Disallow: /studio.html\n");
        sb.append("Disallow: /enter.html\n");
        sb.append("Disallow: /offline.html\n");
        sb.append("Disallow: /api/\n");
        sb.append("\nSitemap: ").append(baseUrl(req)).append("/sitemap.xml\n");
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "plain", StandardCharsets.UTF_8))
                .body(sb.toString());
    }

    @GetMapping("/sitemap.xml")
    public ResponseEntity<String> sitemap(HttpServletRequest req) {
        String base = baseUrl(req);
        String pageLastMod = staticLastMod();

        StringBuilder sb = new StringBuilder(8192);
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
        for (String page : STATIC_PAGES) {
            appendUrl(sb, base + page, pageLastMod);
        }
        List<Post> published = posts.published();
        for (Post p : published) {
            String loc = base + "/post.html?id=" + encodeId(p.getId());
            appendUrl(sb, loc, lastMod(p));
        }
        sb.append("</urlset>\n");
        return ResponseEntity.ok()
                .contentType(new MediaType("application", "xml", StandardCharsets.UTF_8))
                .body(sb.toString());
    }

    private static void appendUrl(StringBuilder sb, String loc, String lastMod) {
        sb.append("  <url><loc>").append(xml(loc)).append("</loc>");
        if (lastMod != null && !lastMod.isBlank()) {
            sb.append("<lastmod>").append(xml(lastMod)).append("</lastmod>");
        }
        sb.append("</url>\n");
    }

    /** 文章取 updatedAt，缺失时退回 date */
    private static String lastMod(Post p) {
        String raw = p.getUpdatedAt();
        if (raw == null || raw.isBlank()) raw = p.getDate();
        return normalizeDate(raw);
    }

    /** 固定页面的最后更新用站点 updated 字段 */
    private String staticLastMod() {
        Map<String, Object> site = settings.site();
        Object updated = site.get("updated");
        return updated == null ? null : normalizeDate(String.valueOf(updated));
    }

    /**
     * sitemap 的 lastmod 只接受完整日期或带时区的日期时间；
     * 库里存的是本地时间字符串（yyyy-MM-dd HH:mm），这里统一取日期粒度，保证格式合法。
     */
    private static String normalizeDate(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        if (v.length() < 10) return null;
        String date = v.substring(0, 10);
        return date.matches("\\d{4}-\\d{2}-\\d{2}") ? date : null;
    }

    private static String encodeId(String id) {
        return URLEncoder.encode(id == null ? "" : id, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String xml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    /**
     * 站点根地址：优先 app.base-url；否则用反向代理头推导（X-Forwarded-Proto + X-Forwarded-Host/Host），
     * 最后退回 Tomcat 解析出的 scheme / serverName / port。
     */
    private String baseUrl(HttpServletRequest req) {
        String configured = configuredBaseUrl == null ? "" : configuredBaseUrl.trim();
        if (!configured.isEmpty()) return sanitize(configured.replaceAll("/+$", ""));

        String proto = header(req, "X-Forwarded-Proto");
        if (!"http".equalsIgnoreCase(proto) && !"https".equalsIgnoreCase(proto)) {
            proto = req.getScheme();
        }
        proto = proto == null || proto.isBlank() ? "http" : proto.toLowerCase(Locale.ROOT);

        String host = header(req, "X-Forwarded-Host");
        if (host.isEmpty()) host = header(req, "Host");
        if (!validHost(host)) {
            host = req.getServerName();
            int port = req.getServerPort();
            boolean defaultPort = ("http".equals(proto) && port == 80)
                    || ("https".equals(proto) && port == 443);
            if (!defaultPort) host = host + ":" + port;
        }
        return sanitize(proto + "://" + host);
    }

    private static String header(HttpServletRequest req, String name) {
        String v = req.getHeader(name);
        if (v == null) return "";
        /* 多级代理时取第一段（最外层那一段就是浏览器访问的域名/协议） */
        return v.split(",")[0].trim();
    }

    private static boolean validHost(String host) {
        return host != null && !host.isBlank() && host.length() <= 255
                && host.matches("[A-Za-z0-9.\\-:\\[\\]]+");
    }

    /** 去掉空白与控制字符，避免异常头把多行写进 robots.txt / XML */
    private static String sanitize(String s) {
        return s == null ? "" : s.replaceAll("[\\s\\p{Cntrl}]", "");
    }
}
