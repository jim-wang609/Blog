package com.kimon.blog.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kimon.blog.entity.Setting;
import com.kimon.blog.mapper.SettingMapper;
import com.kimon.blog.util.Json;
import com.kimon.blog.util.Time;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/** 站点设置：site 信息（JSON）。留言已取消审核，不再有 moderate 开关。 */
@Service
public class SettingsService {

    private final SettingMapper settings;

    public SettingsService(SettingMapper settings) {
        this.settings = settings;
    }

    public Map<String, Object> site() {
        Setting s = settings.selectById("site");
        /* 严格解析：库里 site 的 JSON 坏掉时宁可抛异常，也不返回空对象把设置清空 */
        return s == null ? new LinkedHashMap<>() : new LinkedHashMap<>(Json.readMapStrict(s.getV()));
    }

    public void saveSite(Map<String, Object> site) {
        Setting s = new Setting();
        s.setK("site");
        s.setV(Json.write(site));
        if (settings.selectById("site") == null) settings.insert(s);
        else settings.updateById(s);
    }

    /**
     * 站点「更新时间」不再手填：后台任何一次成功的内容改动之后，
     * 由 AdminInterceptor 统一调用这里，写成当前时间（固定中国时区，
     * 避免生产服务器是 UTC 时显示成外国时间）。
     * 读-改-写加同步，防止两个后台请求同时保存时互相覆盖。
     */
    public synchronized void touchUpdated() {
        Map<String, Object> site = site();
        site.put("updated", Time.formatDateTime());
        saveSite(site);
    }

    public void saveRaw(String key, String value) {
        Setting s = new Setting();
        s.setK(key);
        s.setV(value);
        if (settings.selectById(key) == null) settings.insert(s);
        else settings.updateById(s);
    }

    public String raw(String key) {
        Setting s = settings.selectById(key);
        return s == null ? null : s.getV();
    }

    public void delete(String key) {
        QueryWrapper<Setting> w = new QueryWrapper<>();
        w.eq("k", key);
        settings.delete(w);
    }
}
