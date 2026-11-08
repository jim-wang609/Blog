package com.kimon.blog.config;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletResponse;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * JSON 请求体上限：挡住超大 JSON 把内存 / CPU 拖垮。
 *
 * 两道关卡：
 * 1) 带 Content-Length 的请求直接比较，超限立刻 413（请求体一个字节都不读）；
 * 2) chunked（没有 Content-Length）的请求用包装器边读边计数，超限抛
 *    PayloadTooLargeException，由 ApiExceptionHandler 统一转成 413 JSON。
 *
 * 只处理 /api/** 且 Content-Type 含 application/json 的请求；
 * 上传（multipart）与普通表单不受影响，它们有各自的限制。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
public class RequestBodyLimitFilter extends OncePerRequestFilter {

    private final long maxJsonBodyBytes;

    public RequestBodyLimitFilter(@Value("${app.max-json-body-bytes:2097152}") long maxJsonBodyBytes) {
        this.maxJsonBodyBytes = maxJsonBodyBytes > 0 ? maxJsonBodyBytes : 2097152L;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String uri = req.getRequestURI();
        if (uri == null || !uri.startsWith("/api/") || !isJson(req)) {
            chain.doFilter(req, res);
            return;
        }

        /* 已知长度：不必包装，直接拒绝 */
        if (req.getContentLengthLong() > maxJsonBodyBytes) {
            payloadTooLarge(res);
            return;
        }
        /* 未知长度（chunked）：包装请求，读超了就抛异常 */
        chain.doFilter(new LimitedRequest(req, maxJsonBodyBytes), res);
    }

    private static boolean isJson(HttpServletRequest req) {
        String contentType = req.getContentType();
        return contentType != null && contentType.toLowerCase().contains("application/json");
    }

    private static void payloadTooLarge(HttpServletResponse res) throws IOException {
        res.setStatus(413);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"error\":\"请求体太大\"}");
    }

    /** 只限制读取字节数的请求包装器，其余行为全部交给原始请求。 */
    private static final class LimitedRequest extends HttpServletRequestWrapper {

        private final long maxBytes;

        LimitedRequest(HttpServletRequest request, long maxBytes) {
            super(request);
            this.maxBytes = maxBytes;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            return new LimitedInputStream(super.getInputStream(), maxBytes);
        }

        @Override
        public BufferedReader getReader() throws IOException {
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null || encoding.isBlank()
                    ? StandardCharsets.UTF_8 : Charset.forName(encoding);
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }
    }

    private static final class LimitedInputStream extends ServletInputStream {

        private final ServletInputStream delegate;
        private final long maxBytes;
        private long count;

        LimitedInputStream(ServletInputStream delegate, long maxBytes) {
            this.delegate = delegate;
            this.maxBytes = maxBytes;
        }

        @Override
        public int read() throws IOException {
            int b = delegate.read();
            if (b >= 0) count(1);
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int n = delegate.read(b, off, len);
            if (n > 0) count(n);
            return n;
        }

        private void count(long n) {
            count += n;
            if (count > maxBytes) throw new PayloadTooLargeException();
        }

        @Override
        public boolean isFinished() {
            return delegate.isFinished();
        }

        @Override
        public boolean isReady() {
            return delegate.isReady();
        }

        @Override
        public void setReadListener(ReadListener listener) {
            /* 本项目没有异步读；真要异步读时这里的计数会失效，保持同步读取即可 */
            delegate.setReadListener(listener);
        }
    }
}
