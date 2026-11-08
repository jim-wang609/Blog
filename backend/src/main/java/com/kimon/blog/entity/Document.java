package com.kimon.blog.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("documents")
public class Document {
    @TableId(type = IdType.INPUT)
    private String k;
    private String json;
    private String updatedAt;
}
