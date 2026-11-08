package com.kimon.blog.service;

import com.kimon.blog.entity.Document;
import com.kimon.blog.mapper.DocumentMapper;
import com.kimon.blog.util.Json;
import com.kimon.blog.util.Time;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 相册：和笔记库一样，整份 JSON 存在 documents 表里（k = "gallery"）。
 * 图片本体是 uploads/ 或 assets/ 下的文件，库里只存路径，方便后台随时替换。
 *
 * 文档结构：{ title, intro, albums: ["武汉", "校园", ...], photos: [...] }
 * albums 是站长在后台维护的分组表；照片的 album 必须是分组名之一，
 * 空白或已不属于任何分组的照片归到前台的「未分组」。
 *
 * 首次访问时若文档不存在，写入一组站内自带的示例图与示例分组；
 * 一旦管理员保存过（哪怕清空成空相册），就以库里的内容为准，不会再灌示例。
 */
@Service
public class GalleryService {

    private static final String KEY = "gallery";
    /** 单次保存的数量上限：超了直接报错，不静默截断（用户会以为全存进去了） */
    private static final int MAX_ALBUMS = 60;
    private static final int MAX_PHOTOS = 200;

    private final DocumentMapper documents;

    public GalleryService(DocumentMapper documents) {
        this.documents = documents;
    }

    public synchronized Map<String, Object> get() {
        Document d = documents.selectById(KEY);
        if (d == null || d.getJson() == null || d.getJson().isBlank()) {
            return write(defaults());
        }
        Map<String, Object> m = Json.readMap(d.getJson());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("title", PostService.str(m.get("title"), 80));
        out.put("intro", PostService.str(m.get("intro"), 300));

        List<Map<String, Object>> photos = new ArrayList<>();
        if (m.get("photos") instanceof List) {
            for (Object o : (List<?>) m.get("photos")) {
                if (!(o instanceof Map)) continue;
                @SuppressWarnings("unchecked")
                Map<String, Object> p = (Map<String, Object>) o;
                String src = PostService.str(p.get("src"), 400);
                if (src.isBlank()) continue;
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", PostService.str(p.get("id"), 60));
                item.put("src", src);
                item.put("title", PostService.str(p.get("title"), 80));
                item.put("desc", PostService.str(p.get("desc"), 300));
                item.put("album", PostService.str(p.get("album"), 40).trim());
                item.put("date", PostService.str(p.get("date"), 20));
                item.put("pos", PostService.str(p.get("pos"), 30));
                photos.add(item);
            }
        }

        List<String> albums = parseAlbums(m.get("albums"));
        // 兼容旧文档：还没有 albums 字段时，按照片里出现过的分组名兜底生成（只读，不写库）
        if (!(m.get("albums") instanceof List)) {
            for (Map<String, Object> p : photos) {
                String a = (String) p.get("album");
                if (a != null && !a.isBlank() && !albums.contains(a)) albums.add(a);
            }
        }
        out.put("albums", albums);
        out.put("photos", photos);
        return out;
    }

    @SuppressWarnings("unchecked")
    public synchronized Map<String, Object> save(Map<String, Object> body) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("title", PostService.str(body.get("title"), 80));
        data.put("intro", PostService.str(body.get("intro"), 300));

        List<String> albums = parseAlbums(body.get("albums"));
        if (albums.size() > MAX_ALBUMS) throw new IllegalArgumentException("分组最多 " + MAX_ALBUMS + " 个");
        data.put("albums", albums);

        List<Map<String, Object>> photos = new ArrayList<>();
        if (body.get("photos") instanceof List) {
            for (Object o : (List<?>) body.get("photos")) {
                if (!(o instanceof Map)) continue;
                Map<String, Object> p = (Map<String, Object>) o;
                String src = PostService.str(p.get("src"), 400);
                if (src.isBlank()) continue;
                if (photos.size() >= MAX_PHOTOS) throw new IllegalArgumentException("照片最多 " + MAX_PHOTOS + " 张");
                Map<String, Object> item = new LinkedHashMap<>();
                String id = PostService.str(p.get("id"), 60);
                item.put("id", id.isBlank() ? "g-" + (photos.size() + 1) + "-" + System.currentTimeMillis() : id);
                item.put("src", src);
                item.put("title", PostService.str(p.get("title"), 80));
                item.put("desc", PostService.str(p.get("desc"), 300));
                String album = PostService.str(p.get("album"), 40).trim();
                // 分组被删掉或照片没选分组，统一落到「未分组」，不会丢照片
                item.put("album", albums.contains(album) ? album : "");
                item.put("date", PostService.str(p.get("date"), 20));
                item.put("pos", PostService.str(p.get("pos"), 30));
                photos.add(item);
            }
        }
        data.put("photos", photos);
        return write(data);
    }

    /**
     * 分组名去重、去空、限长；后台传来的顺序即前台筛选按钮的顺序。
     * 读取旧数据时不做截断（历史数据可能超过 60 组，读要兼容），
     * 上限只在 save() 时校验。
     */
    private static List<String> parseAlbums(Object raw) {
        List<String> out = new ArrayList<>();
        if (!(raw instanceof List)) return out;
        for (Object o : (List<?>) raw) {
            String a = PostService.str(o, 40).trim();
            if (a.isBlank() || out.contains(a)) continue;
            out.add(a);
        }
        return out;
    }

    private Map<String, Object> write(Map<String, Object> data) {
        Document d = new Document();
        d.setK(KEY);
        d.setJson(Json.write(data));
        d.setUpdatedAt(Time.now().toString());
        if (documents.selectById(KEY) == null) documents.insert(d);
        else documents.updateById(d);
        return data;
    }

    /** 站内自带的示例插画与示例分组，后台上传真实照片后可直接替换 */
    private static Map<String, Object> defaults() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", "相册");
        m.put("intro", "随手记下的光、风和一些走神的路。");
        m.put("albums", new ArrayList<>(Arrays.asList("武汉", "校园", "途中")));
        List<Map<String, Object>> photos = new ArrayList<>();
        photos.add(photo("g-dawn", "/assets/img/gallery/01-dawn.svg", "清晨的江面", "天刚亮，江上还有薄雾。", "武汉", "2026-10-18"));
        photos.add(photo("g-lake", "/assets/img/gallery/02-lake.svg", "东湖的下午", "风把水面吹出一层层细纹。", "武汉", "2026-10-12"));
        photos.add(photo("g-dusk", "/assets/img/gallery/03-dusk.svg", "回家的黄昏", "桥上的灯一盏盏亮起来。", "武汉", "2026-09-28"));
        photos.add(photo("g-night", "/assets/img/gallery/04-night.svg", "夜里的操场", "跑完步抬头看见的星空。", "校园", "2026-09-15"));
        photos.add(photo("g-rain", "/assets/img/gallery/05-rain.svg", "雨后的街道", "积水里倒着整条街的灯。", "武汉", "2026-08-30"));
        photos.add(photo("g-hill", "/assets/img/gallery/06-hill.svg", "周末的山", "爬到半山腰，云刚好散开。", "途中", "2026-08-09"));
        m.put("photos", photos);
        return m;
    }

    private static Map<String, Object> photo(String id, String src, String title, String desc, String album, String date) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("id", id);
        p.put("src", src);
        p.put("title", title);
        p.put("desc", desc);
        p.put("album", album);
        p.put("date", date);
        p.put("pos", "center");
        return p;
    }
}
