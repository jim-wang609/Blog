package com.kimon.blog.util;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * 统一时间工具：全站固定中国时区（Asia/Shanghai）。
 *
 * 服务器时区可能是 UTC，直接用 LocalDateTime.now() 会让「今天」「更新时间」偏 8 小时；
 * 所有业务代码一律走这里，不要各自再调 now()。
 */
public final class Time {

    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private Time() {}

    public static LocalDateTime now() {
        return LocalDateTime.now(ZONE);
    }

    public static LocalDate today() {
        return LocalDate.now(ZONE);
    }

    /** 后台「最近更新」等展示用的 yyyy-MM-dd HH:mm */
    public static String formatDateTime() {
        return now().format(DATE_TIME);
    }
}
