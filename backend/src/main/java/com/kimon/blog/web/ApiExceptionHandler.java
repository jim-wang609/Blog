package com.kimon.blog.web;

import com.kimon.blog.config.PayloadTooLargeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.util.Map;

/** 统一错误格式，前端只认 { "error": "..." } */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage() == null ? "参数不正确" : e.getMessage()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> tooLarge(MaxUploadSizeExceededException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "文件太大"));
    }

    /** JSON / 请求体超过 app.max-json-body-bytes（含 chunked 边读边计数） */
    @ExceptionHandler(PayloadTooLargeException.class)
    public ResponseEntity<Map<String, Object>> payloadTooLarge(PayloadTooLargeException e) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(Map.of("error", e.getMessage() == null ? "请求体太大" : e.getMessage()));
    }

    /** 查询参数类型不对（例如 id 传了非数字）属于客户端问题，不能算 500 */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> typeMismatch(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "参数格式不对"));
    }

    /** 请求体不是合法 JSON / 字段类型不匹配也返回 400；
     *  chunked 请求体超限时，Jackson 会把 PayloadTooLargeException 包在
     *  HttpMessageNotReadableException 里，这里要还原成 413 而不是 400。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException e) {
        Throwable cause = e.getMostSpecificCause();
        if (cause instanceof PayloadTooLargeException tooLarge) {
            return payloadTooLarge(tooLarge);
        }
        return ResponseEntity.badRequest().body(Map.of("error", "请求体格式不对"));
    }

    /** 路径不存在时返回 404，别当成服务端故障 */
    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> notFound(Exception e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "接口不存在"));
    }

    /** 方法不对（比如该 POST 的用了 GET）返回 405 */
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> badMethod(Exception e) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(Map.of("error", "请求方式不对"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> other(Exception e) {
        log.error("接口异常", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "服务端错误，请查看日志"));
    }
}
