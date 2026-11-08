package com.kimon.blog;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 个人博客后端入口。
 * 启动：mvn spring-boot:run
 * 打包：mvn clean package -DskipTests → target/blog-backend.jar
 *
 * @EnableScheduling 用于 visits 过期明细清理等定时任务（见 StatsService.cleanupOldVisits）。
 */
@SpringBootApplication
@MapperScan("com.kimon.blog.mapper")
@EnableScheduling
public class BlogApplication {
    public static void main(String[] args) {
        SpringApplication.run(BlogApplication.class, args);
    }
}
