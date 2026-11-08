package com.kimon.blog.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kimon.blog.entity.Visit;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface VisitMapper extends BaseMapper<Visit> {

    /** 某天的访问量与独立访客（day 是保留字，列名用 day_no） */
    @Select("SELECT COUNT(*) AS n, COUNT(DISTINCT vid) AS u FROM visits WHERE day_no = #{day}")
    Map<String, Object> dayStats(@Param("day") String day);

    /** >= fromDay 的访问量 */
    @Select("SELECT COUNT(*) AS n FROM visits WHERE day_no >= #{from}")
    long countSince(@Param("from") String from);

    /** 全站访问量与独立访客 */
    @Select("SELECT COUNT(*) AS n, COUNT(DISTINCT vid) AS u FROM visits")
    Map<String, Object> totalStats();

    @Select("SELECT day_no AS visit_day, COUNT(*) AS n, COUNT(DISTINCT vid) AS u FROM visits WHERE day_no >= #{from} GROUP BY day_no")
    List<Map<String, Object>> seriesSince(@Param("from") String from);

    @Select("SELECT path, COUNT(*) AS n FROM visits WHERE day_no >= #{from} GROUP BY path ORDER BY n DESC LIMIT 8")
    List<Map<String, Object>> topPaths(@Param("from") String from);

    @Select("SELECT ref, COUNT(*) AS n FROM visits WHERE day_no >= #{from} AND ref <> '' GROUP BY ref ORDER BY n DESC LIMIT 6")
    List<Map<String, Object>> topRefs(@Param("from") String from);
}
