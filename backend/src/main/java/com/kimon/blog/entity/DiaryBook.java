package com.kimon.blog.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("diary_books")
public class DiaryBook {
    @TableId(type = IdType.INPUT)
    private String id;
    private String name;
    private String intro;
    private String accent;
    private Integer sort;
    private String createdAt;
}
