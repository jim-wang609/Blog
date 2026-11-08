package com.kimon.blog.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kimon.blog.entity.Resource;
import com.kimon.blog.mapper.ResourceMapper;
import com.kimon.blog.util.Time;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** 资源下载：卡片信息 + 下载计数。
 *  文件大小一律从磁盘上的真实文件算，不信任库里手填 / 种子里写死的值。 */
@Service
public class ResourceService {

    private final ResourceMapper resources;

    @Value("${app.upload-dir:../uploads}")
    private String uploadDir;

    public ResourceService(ResourceMapper resources) {
        this.resources = resources;
    }

    public Map<String, Object> toJson(Resource r) {
        String file = r.getFile() == null ? "" : r.getFile();
        String realSize = realSize(file);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.getId());
        m.put("name", r.getName());
        m.put("icon", r.getIcon());
        m.put("tint", r.getTint());
        m.put("version", r.getVersion());
        m.put("size", realSize);
        m.put("lang", r.getLang());
        m.put("desc", r.getDescr());
        /* downloads 只由 /api/download/{id} 自增，不再带种子里的假基数 */
        m.put("downloads", r.getDownloads() == null ? 0 : r.getDownloads());
        m.put("date", realSize.isEmpty() ? "" : r.getDate());
        m.put("file", file);
        m.put("hasFile", !realSize.isEmpty());
        return m;
    }

    /** 从实际文件读字节数；路径越界、文件不存在都返回空串，前台显示「待上传」。 */
    private String realSize(String file) {
        if (file == null || file.isBlank()) return "";
        try {
            String rel = file.startsWith("/") ? file.substring(1) : file;
            if (rel.startsWith("uploads/")) rel = rel.substring("uploads/".length());
            Path base = Path.of(uploadDir).toAbsolutePath().normalize();
            Path target = base.resolve(rel).normalize();
            if (!target.startsWith(base) || !Files.isRegularFile(target)) return "";
            return human(Files.size(target));
        } catch (IOException | RuntimeException e) {
            return "";
        }
    }

    private static String human(long n) {
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return String.format("%.1f KB", n / 1024.0);
        return String.format("%.1f MB", n / (1024.0 * 1024.0));
    }

    public List<Map<String, Object>> list() {
        return resources.selectList(new QueryWrapper<Resource>().orderByDesc("id"))
                .stream().map(this::toJson).collect(Collectors.toList());
    }

    public Resource get(long id) {
        return resources.selectById(id);
    }

    public Resource save(Map<String, Object> body, Long id) {
        String name = PostService.str(body.get("name"), 160).trim();
        if (name.isEmpty()) throw new IllegalArgumentException("名称不能为空");

        Resource r = id == null ? new Resource() : resources.selectById(id);
        if (r == null) throw new IllegalArgumentException("资源不存在");

        r.setName(name);
        r.setIcon(blankTo(PostService.str(body.get("icon"), 12), "FILE"));
        r.setTint(blankTo(PostService.str(body.get("tint"), 16), "purple"));
        r.setVersion(PostService.str(body.get("version"), 40));
        r.setSize(PostService.str(body.get("size"), 24));
        r.setLang(PostService.str(body.get("lang"), 60));
        r.setDescr(PostService.str(body.get("desc"), 1000));
        r.setDate(blankTo(PostService.str(body.get("date"), 10), Time.today().toString()));
        r.setFile(PostService.str(body.get("file"), 400));

        if (id == null) {
            r.setDownloads(0);
            r.setCreatedAt(Time.now().toString());
            resources.insert(r);
        } else {
            resources.updateById(r);
        }
        return r;
    }

    public void delete(long id) {
        resources.deleteById(id);
    }

    public void bumpDownloads(long id) {
        /* 原子自增，不再读-改-写，避免并发下载时计数互相覆盖 */
        resources.incrDownloads(id);
    }

    public long totalDownloads() {
        return resources.selectList(null).stream()
                .mapToLong(r -> r.getDownloads() == null ? 0 : r.getDownloads()).sum();
    }

    private static String blankTo(String s, String dft) {
        return s == null || s.isBlank() ? dft : s;
    }
}
