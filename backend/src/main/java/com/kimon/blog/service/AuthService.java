package com.kimon.blog.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kimon.blog.auth.PasswordUtil;
import com.kimon.blog.entity.User;
import com.kimon.blog.mapper.UserMapper;
import com.kimon.blog.util.Time;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 账号：admin 能改所有内容，guest 只能留言 */
@Service
public class AuthService {

    /** 管理员密码最短长度（站点初始化和后台改密都按这个） */
    private static final int ADMIN_MIN_PASSWORD = 10;
    /** 访客账号密码最短长度 */
    private static final int GUEST_MIN_PASSWORD = 6;
    private static final int MAX_NAME = 60;

    private final UserMapper users;

    public AuthService(UserMapper users) {
        this.users = users;
    }

    public User find(String name) {
        if (name == null) return null;
        return users.selectOne(new QueryWrapper<User>().eq("name", name.trim()));
    }

    public boolean hasAdmin() {
        return users.selectCount(new QueryWrapper<User>().eq("role", "admin")) > 0;
    }

    public void createAdmin(String name, String password) {
        String n = normalizeName(name, "admin");
        if (password == null || password.length() < ADMIN_MIN_PASSWORD) {
            throw new IllegalArgumentException("管理员密码至少 " + ADMIN_MIN_PASSWORD + " 位");
        }
        if (find(n) != null) throw new IllegalArgumentException("账号已存在");
        User u = new User();
        u.setName(n);
        u.setPass(PasswordUtil.hash(password));
        u.setRole("admin");
        u.setCreatedAt(Time.now().toString());
        users.insert(u);
    }

    public void createGuest(String name, String password) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) throw new IllegalArgumentException("账号不能为空");
        if (n.length() > MAX_NAME) throw new IllegalArgumentException("账号最多 " + MAX_NAME + " 个字符");
        if (password == null || password.length() < GUEST_MIN_PASSWORD) {
            throw new IllegalArgumentException("访客密码至少 " + GUEST_MIN_PASSWORD + " 位");
        }
        if (find(n) != null) throw new IllegalArgumentException("这个账号已经存在了");
        User u = new User();
        u.setName(n);
        u.setPass(PasswordUtil.hash(password));
        u.setRole("guest");
        u.setCreatedAt(Time.now().toString());
        users.insert(u);
    }

    /**
     * 首次初始化管理员（/api/admin/setup 用）：
     * synchronized 防止两个初始化请求同时通过 hasAdmin 检查；已有管理员时直接拒绝。
     */
    public synchronized User createFirstAdminIfNone(String name, String password) {
        if (hasAdmin()) throw new IllegalArgumentException("管理员已存在");
        createAdmin(name, password);
        return find(normalizeName(name, "admin"));
    }

    /** 校验通过返回用户，失败抛异常 */
    public User login(String name, String password) {
        User u = find(name == null ? "" : name);
        if (u == null || !PasswordUtil.verify(password == null ? "" : password, u.getPass())) {
            throw new IllegalArgumentException("账号或密码不对");
        }
        return u;
    }

    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
        users.selectList(new QueryWrapper<User>().orderByAsc("id")).forEach(u -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", u.getId());
            m.put("name", u.getName());
            m.put("role", u.getRole());
            m.put("created_at", u.getCreatedAt());
            out.add(m);
        });
        return out;
    }

    /**
     * 改密码：管理员（requireStrong=true）至少 10 位，访客至少 6 位。
     * 成功后写 pass_changed_at，之前签发的 JWT 全部立即失效（见 tokenStillValid）。
     */
    public void changePassword(String name, String next, boolean requireStrong) {
        User u = find(name);
        if (u == null) throw new IllegalArgumentException("账号不存在");
        int min = requireStrong ? ADMIN_MIN_PASSWORD : GUEST_MIN_PASSWORD;
        if (next == null || next.length() < min) throw new IllegalArgumentException("新密码至少 " + min + " 位");
        u.setPass(PasswordUtil.hash(next));
        u.setPassChangedAt(Instant.now().toString());
        users.updateById(u);
    }

    /**
     * JWT 是否仍然有效：改过密码之后，签发时间早于 pass_changed_at 的 token 一律作废。
     * issuedAt 为空、用户已不存在都按无效处理；pass_changed_at 为空说明没改过密码，保持有效。
     */
    public boolean tokenStillValid(String name, Instant issuedAt) {
        if (issuedAt == null) return false;
        User u = find(name);
        if (u == null) return false;
        String changed = u.getPassChangedAt();
        if (changed == null || changed.isBlank()) return true;
        try {
            /* JWT 的 iat 只有秒级精度，pass_changed_at 带纳秒；统一截断到秒再比较，
               否则「改密后同一秒内重新登录」签发的新 token 会被自己立刻判为失效。 */
            Instant changedAt = Instant.parse(changed.trim()).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
            return !issuedAt.isBefore(changedAt);
        } catch (RuntimeException e) {
            /* 库里存了脏值时不因此把所有人踢下线 */
            return true;
        }
    }

    public void delete(String name) {
        User u = find(name);
        if (u == null) throw new IllegalArgumentException("账号不存在");
        if ("admin".equals(u.getRole())) {
            long admins = users.selectCount(new QueryWrapper<User>().eq("role", "admin"));
            if (admins <= 1) throw new IllegalArgumentException("至少要留一个管理员");
        }
        users.deleteById(u.getId());
    }

    private static String normalizeName(String name, String dft) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) n = dft;
        if (n.length() > MAX_NAME) throw new IllegalArgumentException("账号最多 " + MAX_NAME + " 个字符");
        return n;
    }
}
