package com.kimon.blog.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kimon.blog.entity.Resource;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface ResourceMapper extends BaseMapper<Resource> {

    /** 原子自增下载量，避免「先读后写」在并发下载时丢计数 */
    @Update("UPDATE resources SET downloads = COALESCE(downloads, 0) + 1 WHERE id = #{id}")
    int incrDownloads(@Param("id") long id);
}
