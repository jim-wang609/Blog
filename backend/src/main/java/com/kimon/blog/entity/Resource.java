package com.kimon.blog.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("resources")
public class Resource {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String name;
    private String icon;
    private String tint;
    private String version;
    private String size;
    private String lang;
    private String descr;
    private Integer downloads;
    private String date;
    private String file;
    private String createdAt;
}
