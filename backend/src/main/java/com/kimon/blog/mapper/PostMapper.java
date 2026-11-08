package com.kimon.blog.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kimon.blog.entity.Post;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface PostMapper extends BaseMapper<Post> {

    /** 原子自增，避免先读后写在并发下丢计数；草稿不计阅读量 */
    @Update("UPDATE posts SET views = COALESCE(views, 0) + 1 WHERE id = #{id} AND status = 'published'")
    int incrViews(@Param("id") String id);
}
