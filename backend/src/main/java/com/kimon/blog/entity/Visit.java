package com.kimon.blog.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("visits")
public class Visit {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String ts;
    /** 库里叫 day_no（day 是 H2 保留字） */
    private String dayNo;
    private String path;
    private String ref;
    private String vid;
}
