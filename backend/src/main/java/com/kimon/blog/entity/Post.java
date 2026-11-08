package com.kimon.blog.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("posts")
public class Post {
    @TableId(type = IdType.INPUT)
    private String id;
    private String section;
    private String title;
    private String excerpt;
    private String body;
    private String cat;
    private String tags;
    private Integer minutes;
    private Integer pinned;
    private String cover;
    private String status;
    private Integer views;
    private String date;
    private String createdAt;
    private String updatedAt;
}
