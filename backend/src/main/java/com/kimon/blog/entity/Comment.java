package com.kimon.blog.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("comments")
public class Comment {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String target;
    /** 0 = 顶层留言/评论；否则为所回复评论的 id（只做两层） */
    private Long parentId;
    private String name;
    private String uid;
    private String body;
    private String status;
    private String ip;
    private String ua;
    private String createdAt;
}
