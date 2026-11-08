package com.kimon.blog.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kimon.blog.entity.Setting;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface SettingMapper extends BaseMapper<Setting> {
}
