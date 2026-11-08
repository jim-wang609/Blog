package com.kimon.blog.config;

import com.kimon.blog.auth.AdminInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.*;

import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

/**
 * 静态站点 + 上传目录 + 后台拦截器 + 跨域白名单。
 * 生产环境静态文件由 Nginx 直接发，这里的映射主要方便本地开发（一个端口全搞定）。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AdminInterceptor adminInterceptor;

    @Value("${app.static-dir:../}")
    private String staticDir;

    @Value("${app.upload-dir:../uploads}")
    private String uploadDir;

    @Value("${app.allowed-origins:}")
    private String allowedOrigins;

    public WebConfig(AdminInterceptor adminInterceptor) {
        this.adminInterceptor = adminInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(adminInterceptor).addPathPatterns("/api/admin/**");
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        /* 访问根路径时给出开始页，否则静态资源处理器会把 "/" 当目录处理 */
        registry.addViewController("/").setViewName("forward:/index.html");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String upload = Path.of(uploadDir).toAbsolutePath().normalize().toUri().toString();
        String site = Path.of(staticDir).toAbsolutePath().normalize().toUri().toString();

        registry.addResourceHandler("/uploads/**").addResourceLocations(upload);
        /* 其余静态文件（html / css / js）走站点目录；没有匹配到控制器时才轮到它 */
        /* 本地开发不缓存静态文件：改了 html/css/js 刷新就生效。
           生产环境静态文件由 Nginx 直接发，缓存策略在 Nginx 侧控制，不受这里影响。 */
        registry.addResourceHandler("/**")
                .addResourceLocations(site)
                .setCachePeriod(0);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        if (allowedOrigins == null || allowedOrigins.isBlank()) return;
        List<String> origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
        registry.addMapping("/api/**")
                .allowedOrigins(origins.toArray(new String[0]))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
