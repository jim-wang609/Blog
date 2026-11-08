package com.kimon.blog.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kimon.blog.entity.Document;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface DocumentMapper extends BaseMapper<Document> {
}
