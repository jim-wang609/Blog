package com.kimon.blog.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kimon.blog.util.Json;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 开源项目：站长在后台「设置」里填一个 GitHub 主页地址或用户名，
 * 这里读 GitHub 公开 API 自动算出公开仓库数量与名字，前台不用手填。
 *
 * 结果在内存里缓存 30 分钟（不落库、不算内容改动）；GitHub 挂了会退回上一次的结果，
 * 实在读不到就返回 ok=false，前台把这一块藏起来，绝不编造假数据。
 */
@Service
public class GithubService {

    private static final long TTL_MS = 30 * 60 * 1000L;
    private static final int MAX_PAGES = 3;

    private final SettingsService settings;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(6))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private volatile Cache cache;

    private static final class Cache {
        final String user;
        final Map<String, Object> data;
        final long at;
        Cache(String user, Map<String, Object> data) {
            this.user = user;
            this.data = data;
            this.at = System.currentTimeMillis();
        }
    }

    public GithubService(SettingsService settings) {
        this.settings = settings;
    }

    public void refresh() {
        cache = null;
    }

    public Map<String, Object> get() {
        Object raw = settings.site().get("github");
        String user = normalize(raw == null ? "" : String.valueOf(raw));
        if (user.isEmpty()) return empty(user, "还没填 GitHub 主页或用户名");

        Cache c = cache;
        if (c != null && c.user.equals(user) && System.currentTimeMillis() - c.at < TTL_MS) return c.data;

        try {
            Map<String, Object> data = fetch(user);
            cache = new Cache(user, data);
            return data;
        } catch (Exception e) {
            if (c != null && c.user.equals(user)) return c.data;
            return empty(user, "暂时读不到 GitHub，稍后再试");
        }
    }

    private Map<String, Object> fetch(String user) throws Exception {
        List<Map<String, Object>> repos = new ArrayList<>();
        for (int page = 1; page <= MAX_PAGES; page++) {
            String url = "https://api.github.com/users/" + user +
                    "/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=" + page;
            JsonNode arr = call(url);
            if (!arr.isArray() || arr.isEmpty()) break;
            for (JsonNode n : arr) {
                /* fork 别人的仓库不算自己的开源项目 */
                if (n.path("fork").asBoolean(false)) continue;
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("name", n.path("name").asText(""));
                r.put("desc", n.path("description").asText(""));
                r.put("lang", n.path("language").asText(""));
                r.put("stars", n.path("stargazers_count").asInt(0));
                r.put("url", n.path("html_url").asText(""));
                r.put("pushedAt", n.path("pushed_at").asText(""));
                repos.add(r);
            }
            if (arr.size() < 100) break;
        }

        repos.sort(Comparator.comparingInt((Map<String, Object> r) -> ((Number) r.get("stars")).intValue()).reversed());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("user", user);
        out.put("url", "https://github.com/" + user);
        out.put("count", repos.size());
        out.put("repos", repos);
        out.put("fetchedAt", Instant.now().toString());
        return out;
    }

    private JsonNode call(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "kimon-blog")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .GET()
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() < 200 || res.statusCode() >= 300) {
            throw new IllegalStateException("GitHub 返回 HTTP " + res.statusCode());
        }
        return Json.MAPPER.readTree(res.body());
    }

    /** 支持 @user、https://github.com/user、github.com/user/repo 等写法 */
    private static String normalize(String raw) {
        String s = raw.trim();
        if (s.isEmpty()) return "";
        s = s.replaceFirst("^@+", "");
        if (s.regionMatches(true, 0, "github.com/", 0, 11)) s = "https://" + s;
        if (s.regionMatches(true, 0, "http://", 0, 7) || s.regionMatches(true, 0, "https://", 0, 8)) {
            try {
                s = URI.create(s).getPath();
            } catch (Exception e) {
                return "";
            }
        }
        s = s.replaceAll("^/+", "");
        int cut = s.indexOf('/');
        if (cut >= 0) s = s.substring(0, cut);
        cut = s.indexOf('?');
        if (cut >= 0) s = s.substring(0, cut);
        cut = s.indexOf('#');
        if (cut >= 0) s = s.substring(0, cut);
        s = s.trim();
        if (s.length() > 39 || !s.matches("[A-Za-z0-9-]+")) return "";
        if (s.startsWith("-") || s.endsWith("-")) return "";
        return s;
    }

    private static Map<String, Object> empty(String user, String message) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", false);
        out.put("user", user);
        out.put("url", user.isEmpty() ? "" : "https://github.com/" + user);
        out.put("count", 0);
        out.put("repos", new ArrayList<>());
        out.put("message", message);
        return out;
    }
}
