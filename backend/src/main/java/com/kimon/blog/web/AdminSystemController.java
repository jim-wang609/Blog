package com.kimon.blog.web;

import com.kimon.blog.auth.AuthFilter;
import com.kimon.blog.entity.User;
import com.kimon.blog.service.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** 后台：统计、评论、账号、设置、上传 */
@RestController
@RequestMapping("/api/admin")
public class AdminSystemController {

    private static final Set<String> IMAGE_EXT = Set.of(".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif");
    private static final Set<String> BLOCKED_EXT = Set.of(".html", ".htm", ".xhtml", ".js", ".mjs", ".php", ".phtml", ".cgi", ".svg");
    private static final long IMAGE_MAX_BYTES = 12L * 1024 * 1024;
    private static final long FILE_MAX_BYTES = 120L * 1024 * 1024;
    /** 像素炸弹门槛：4000 万像素或任一边超过 12000 一律拒绝 */
    private static final long MAX_PIXELS = 40_000_000L;
    private static final int MAX_EDGE = 12_000;
    /** PNG/JPEG 超过这个最长边或 1.5MB 就重新编码到 1920 */
    private static final int TARGET_EDGE = 1_920;
    private static final long RESIZE_BYTES = 1_572_864L;

    private final StatsService stats;
    private final CommentService comments;
    private final AuthService auth;
    private final SettingsService settings;
    private final GithubService github;

    @Value("${app.upload-dir:../uploads}")
    private String uploadDir;

    public AdminSystemController(StatsService stats, CommentService comments,
                                 AuthService auth, SettingsService settings, GithubService github) {
        this.stats = stats;
        this.comments = comments;
        this.auth = auth;
        this.settings = settings;
        this.github = github;
    }

    /* ---------- 统计 ---------- */

    @GetMapping("/overview")
    public Map<String, Object> overview() {
        return stats.overview();
    }

    /* ---------- 评论 ---------- */

    @GetMapping("/comments")
    public Map<String, Object> listComments(@RequestParam(defaultValue = "false") boolean guestbook,
                                            @RequestParam(defaultValue = "false") boolean posts,
                                            @RequestParam(defaultValue = "100") int limit,
                                            @RequestParam(defaultValue = "0") int offset) {
        int size = Math.max(1, Math.min(300, limit));
        int start = Math.max(0, offset);
        /* service 直接返回 { items, total } */
        return comments.adminPage(guestbook, posts, size, start);
    }

    /** 免审核：不再提供改状态接口，站长唯一的管理动作是删除。 */
    @DeleteMapping("/comments/{id}")
    public Map<String, Object> deleteComment(@PathVariable long id) {
        comments.delete(id);
        return Map.of("ok", true);
    }

    /* ---------- 账号 ---------- */

    @GetMapping("/users")
    public Map<String, Object> users() {
        return Map.of("items", auth.list());
    }

    @PostMapping("/users")
    public Map<String, Object> createUser(@RequestBody Map<String, Object> body) {
        auth.createGuest(PublicApiController.str(body.get("name")), PublicApiController.str(body.get("password")));
        return Map.of("item", Map.of("name", PublicApiController.str(body.get("name")), "role", "guest"));
    }

    @PostMapping("/users/password")
    public Map<String, Object> resetPassword(@RequestBody Map<String, Object> body) {
        String name = PublicApiController.str(body.get("name"));
        User u = auth.find(name);
        if (u == null) throw new IllegalArgumentException("账号不存在");
        auth.changePassword(name, PublicApiController.str(body.get("next")), "admin".equals(u.getRole()));
        return Map.of("ok", true);
    }

    @DeleteMapping("/users/{name}")
    public Map<String, Object> deleteUser(@PathVariable String name) {
        auth.delete(name);
        return Map.of("ok", true);
    }

    @PostMapping("/password")
    public Map<String, Object> changeMyPassword(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        String name = (String) req.getAttribute(AuthFilter.ATTR_NAME);
        User me = auth.find(name);
        if (me == null || !com.kimon.blog.auth.PasswordUtil.verify(
                PublicApiController.str(body.get("old")), me.getPass())) {
            throw new IllegalArgumentException("原密码不对");
        }
        auth.changePassword(name, PublicApiController.str(body.get("next")), true);
        return Map.of("ok", true);
    }

    /* ---------- 设置 ---------- */

    @GetMapping("/settings")
    public Map<String, Object> getSettings() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("site", settings.site());
        out.put("users", auth.list());
        return out;
    }

    @PutMapping("/settings")
    public Map<String, Object> saveSettings(@RequestBody Map<String, Object> body) {
        if (body.get("site") instanceof Map<?, ?> site) {
            settings.saveSite(castMap(site));
        }
        return getSettings();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> raw) {
        return (Map<String, Object>) raw;
    }

    /** 手动清一次 GitHub 缓存，立刻重新读仓库数量与名称 */
    @PostMapping("/github/refresh")
    public Map<String, Object> refreshGithub() {
        github.refresh();
        return github.get();
    }

    /* ---------- 上传 ---------- */

    @PostMapping("/upload")
    public Map<String, Object> upload(@RequestParam("file") MultipartFile file,
                                      @RequestParam(value = "kind", defaultValue = "") String kind) throws IOException {
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("没有收到文件");

        String original = Optional.ofNullable(file.getOriginalFilename()).orElse("file");
        String ext = "";
        int dot = original.lastIndexOf('.');
        if (dot > -1) ext = original.substring(dot).toLowerCase();

        /* SVG 可以内嵌脚本，等同于上传 HTML：全局禁止（包括伪装成普通文件的上传） */
        if (".svg".equals(ext)) throw new IllegalArgumentException("出于安全考虑不再支持 SVG，请用 PNG/JPG/WebP");

        /* kind=avatar 也按图片处理：前端会把头像先压到 512 */
        boolean isImage = "image".equals(kind) || "avatar".equals(kind)
                || (kind.isBlank() && file.getContentType() != null
                    && file.getContentType().startsWith("image/"));

        long limit = isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES;
        if (file.getSize() > limit) throw new IllegalArgumentException("文件太大");

        if (isImage && !IMAGE_EXT.contains(ext)) {
            throw new IllegalArgumentException("只支持 png / jpg / gif / webp / avif 图片");
        }
        if (!isImage && BLOCKED_EXT.contains(ext)) {
            throw new IllegalArgumentException("出于安全考虑，不允许上传 " + ext + " 文件");
        }

        /* 图片：先校验真实文件头与尺寸；PNG/JPEG 过大时重新编码到最长边 1920 */
        String format = null;
        boolean resize = false;
        if (isImage) {
            format = detectImageFormat(file);
            if (format == null) throw new IllegalArgumentException("这个文件看起来不是图片");
            if (!formatMatchesExt(format, ext)) throw new IllegalArgumentException("图片内容和扩展名对不上");
            /* WebP / AVIF 没有 JDK 自带的 ImageIO 解码器：只做文件头校验，不读尺寸也不缩放 */
            if (!"WEBP".equals(format) && !"AVIF".equals(format)) {
                int[] wh = readImageSize(file);
                checkImageSize(wh[0], wh[1]);
                boolean large = wh[0] > TARGET_EDGE || wh[1] > TARGET_EDGE || file.getSize() > RESIZE_BYTES;
                resize = ("PNG".equals(format) || "JPEG".equals(format)) && large;
            }
        }

        String stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss"));
        String rand = Long.toHexString(Double.doubleToLongBits(Math.random())).substring(0, 6);
        String base = original.replaceAll("\\.[^.]+$", "").replaceAll("[^\\w\\-\\u4e00-\\u9fa5]+", "-");
        if (base.length() > 60) base = base.substring(0, 60);
        String filename = stamp + "-" + rand + "-" + (base.isBlank() ? "file" : base) + ext;

        Path dir = Path.of(uploadDir, isImage ? "images" : "files").toAbsolutePath().normalize();
        Files.createDirectories(dir);
        Path target = dir.resolve(filename);
        if (resize) {
            writeScaledImage(file, format, target);
        } else {
            /* 流式写入：不再 file.getBytes()，120MB 的文件也不会整块进堆内存 */
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }

        long size = Files.size(target);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("url", "/uploads/" + (isImage ? "images/" : "files/") + filename);
        out.put("name", original);
        out.put("size", humanSize(size));
        out.put("bytes", size);
        out.put("saved", filename);
        return out;
    }

    /** 只读文件头判断真实格式（不信任 Content-Type 与扩展名） */
    private static String detectImageFormat(MultipartFile file) throws IOException {
        byte[] head = new byte[64];
        int n;
        try (InputStream in = file.getInputStream()) {
            n = readFully(in, head);
        }
        if (n < 12) return null;
        if ((head[0] & 0xFF) == 0x89 && head[1] == 'P' && head[2] == 'N' && head[3] == 'G') {
            /* 完整 8 字节 PNG 签名，避免只伪造前 4 字节 */
            return n >= 8 && head[4] == 0x0D && head[5] == 0x0A && head[6] == 0x1A && head[7] == 0x0A
                    ? "PNG" : null;
        }
        if ((head[0] & 0xFF) == 0xFF && (head[1] & 0xFF) == 0xD8 && (head[2] & 0xFF) == 0xFF
                && (head[3] & 0xFF) != 0x00) {
            return "JPEG";
        }
        if (head[0] == 'G' && head[1] == 'I' && head[2] == 'F'
                && head[3] == '8' && (head[4] == '7' || head[4] == '9') && head[5] == 'a') {
            return "GIF";
        }
        if (head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
                && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P') {
            return "WEBP";
        }
        if (head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p') {
            String brand = new String(head, 8, 4, StandardCharsets.US_ASCII);
            if ("avif".equals(brand) || "avis".equals(brand)) return "AVIF";
            /* 兼容品牌可能把 avif 写在兼容列表里（mif1/msf1 主品牌） */
            String brands = new String(head, 8, n - 8, StandardCharsets.US_ASCII);
            if (brands.contains("avif") || brands.contains("avis")) return "AVIF";
        }
        return null;
    }

    private static boolean formatMatchesExt(String format, String ext) {
        return switch (format) {
            case "PNG" -> ".png".equals(ext);
            case "JPEG" -> ".jpg".equals(ext) || ".jpeg".equals(ext);
            case "GIF" -> ".gif".equals(ext);
            case "WEBP" -> ".webp".equals(ext);
            case "AVIF" -> ".avif".equals(ext);
            default -> false;
        };
    }

    /** PNG / JPEG / GIF 用 ImageReader 只读尺寸（不解码整图），先挡解压炸弹 */
    private static int[] readImageSize(MultipartFile file) throws IOException {
        try (InputStream in = file.getInputStream();
             ImageInputStream iis = ImageIO.createImageInputStream(in)) {
            ImageReader reader = firstReader(iis);
            reader.setInput(iis, true, true);
            try {
                return new int[]{reader.getWidth(0), reader.getHeight(0)};
            } catch (IOException e) {
                throw new IllegalArgumentException("图片文件已损坏");
            } finally {
                reader.dispose();
            }
        }
    }

    private static ImageReader firstReader(ImageInputStream iis) {
        if (iis == null) throw new IllegalArgumentException("这个文件看起来不是图片");
        Iterator<ImageReader> readers = ImageIO.getImageReaders(iis);
        if (!readers.hasNext()) throw new IllegalArgumentException("这个文件看起来不是图片");
        return readers.next();
    }

    private static void checkImageSize(int w, int h) {
        if (w <= 0 || h <= 0) throw new IllegalArgumentException("图片文件已损坏");
        if ((long) w * h > MAX_PIXELS || w > MAX_EDGE || h > MAX_EDGE) {
            throw new IllegalArgumentException("图片分辨率太大（超过 4000 万像素或边长 12000）");
        }
    }

    /** 等比缩放到最长边 1920 后写回：PNG 保持 PNG，JPEG 用 0.85 质量重新编码 */
    private static void writeScaledImage(MultipartFile file, String format, Path target) throws IOException {
        BufferedImage src;
        try (InputStream in = file.getInputStream();
             ImageInputStream iis = ImageIO.createImageInputStream(in)) {
            ImageReader reader = firstReader(iis);
            reader.setInput(iis, true, true);
            ImageReadParam param = reader.getDefaultReadParam();
            /* 大图先做子采样解码，避免 4000 万像素整图解码把堆打满 */
            int factor = Math.max(1, Math.max(reader.getWidth(0), reader.getHeight(0)) / TARGET_EDGE);
            if (factor > 1) {
                try {
                    param.setSourceSubsampling(factor, factor, 0, 0);
                } catch (RuntimeException ignore) {
                    /* 个别格式不支持子采样，退回整图读取 */
                }
            }
            try {
                src = reader.read(0, param);
            } catch (RuntimeException | IOException e) {
                reader.setInput(iis, true, true);
                src = reader.read(0);
            } finally {
                reader.dispose();
            }
        }
        BufferedImage out = scaleToFit(src, format);
        if ("JPEG".equals(format)) writeJpeg(out, target);
        else ImageIO.write(out, "png", target.toFile());
    }

    private static BufferedImage scaleToFit(BufferedImage src, String format) {
        int w = src.getWidth();
        int h = src.getHeight();
        boolean jpeg = "JPEG".equals(format);
        double ratio = Math.min(1.0d, (double) TARGET_EDGE / Math.max(w, h));
        int tw = Math.max(1, (int) Math.round(w * ratio));
        int th = Math.max(1, (int) Math.round(h * ratio));
        int type = jpeg ? BufferedImage.TYPE_INT_RGB
                : (src.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        BufferedImage dst = new BufferedImage(tw, th, type);
        Graphics2D g = dst.createGraphics();
        try {
            if (jpeg) {
                /* JPEG 没有透明通道：透明区域填白，避免转成黑底 */
                g.setColor(Color.WHITE);
                g.fillRect(0, 0, tw, th);
            }
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.drawImage(src, 0, 0, tw, th, null);
        } finally {
            g.dispose();
        }
        return dst;
    }

    private static void writeJpeg(BufferedImage img, Path target) throws IOException {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpeg");
        if (!writers.hasNext()) throw new IOException("没有可用的 JPEG 编码器");
        ImageWriter writer = writers.next();
        try (ImageOutputStream out = ImageIO.createImageOutputStream(target.toFile())) {
            if (out == null) throw new IOException("无法写入图片");
            writer.setOutput(out);
            ImageWriteParam param = writer.getDefaultWriteParam();
            if (param.canWriteCompressed()) {
                param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                param.setCompressionQuality(0.85f);
            }
            writer.write(null, new IIOImage(img, null, null), param);
        } finally {
            writer.dispose();
        }
    }

    private static int readFully(InputStream in, byte[] buf) throws IOException {
        int total = 0;
        while (total < buf.length) {
            int n = in.read(buf, total, buf.length - total);
            if (n < 0) break;
            total += n;
        }
        return total;
    }

    private static String humanSize(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        return String.format("%.1f MB", bytes / 1024.0 / 1024.0);
    }
}
