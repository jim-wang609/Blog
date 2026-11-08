package com.kimon.blog.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

@Data
@TableName("users")
public class User {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String name;
    @JsonIgnore
    private String pass;
    private String role;
    private String createdAt;
    /** 最近一次改密码的时间（Instant 字符串）；早于它的 JWT 立即失效。列名 pass_changed_at */
    @TableField("pass_changed_at")
    private String passChangedAt;
}
