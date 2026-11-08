package com.kimon.blog.config;

/**
 * 请求体超过 app.max-json-body-bytes 时抛出。
 * 由 RequestBodyLimitFilter 在读取过程中抛出，交给 ApiExceptionHandler 统一映射成 413。
 */
public class PayloadTooLargeException extends RuntimeException {

    public PayloadTooLargeException() {
        super("请求体太大");
    }
}
