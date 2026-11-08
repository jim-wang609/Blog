package com.kimon.blog.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("diary_entries")
public class DiaryEntry {
    @TableId(type = IdType.INPUT)
    private String id;
    private String bookId;
    /** 对外 JSON 叫 day，库里叫 day_no（day 是 H2 保留字） */
    private Integer dayNo;
    private String date;
    private String weekday;
    private String cat;
    private String title;
    private String body;
    private Integer sort;
    private String createdAt;
}
