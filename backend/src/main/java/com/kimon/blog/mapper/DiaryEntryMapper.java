package com.kimon.blog.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kimon.blog.entity.DiaryEntry;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface DiaryEntryMapper extends BaseMapper<DiaryEntry> {
}
