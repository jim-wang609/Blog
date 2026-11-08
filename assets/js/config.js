/* ============================================================
   部署配置 + 连通性引导（所有页面 <head> 里最早加载）

   前后端放在同一台服务器（推荐）：留空即可，所有请求走相对路径
   前后端分开部署（静态走 CDN）：填后端地址，例如
     window.KIMON_API = "https://api.your-domain.com";
   后端要设置 ALLOWED_ORIGINS，并设 COOKIE_SAME_SITE=None、COOKIE_SECURE=true
   （跨站 Cookie 必须走 HTTPS）。前台会自动把请求切成 credentials: include。

   站点没有任何静态内容兜底：连不上数据库就在渲染前整页跳到 offline.html，
   绝不显示空壳页面，更不会拿打包时的旧内容凑数。
   ============================================================ */

window.KIMON_API = "";
/* 站点对外地址（SEO 用）：留空表示按当前访问域名自动拼接 canonical / og:url。
   前后端分离部署时可在页面里先设好，再加载 config.js（例如 https://your-domain.com，不带结尾斜杠）。 */
if (typeof window.KIMON_SITE_URL !== "string") window.KIMON_SITE_URL = "";

(function () {
  "use strict";
  var K = (window.KIMON = window.KIMON || {});

  /* 跨域部署判定：用来决定同步探测要不要带 Cookie */
  function isCrossSite(api) {
    if (!api) return false;
    try { return new URL(api, location.href).origin !== location.origin; } catch (e) { return false; }
  }

  /* 在 <head> 里同步探测一次：成功返回 bootstrap 数据，失败返回可读的原因字符串。
     同步是为了让跳转发生在任何 DOM 渲染之前，页面不会闪一下空壳。 */
  K.probe = function () {
    var API = String(window.KIMON_API || "").replace(/\/$/, "");
    if (location.protocol === "file:") {
      return "当前是用 file:// 直接打开的本地文件，没有服务端可读数据库。请用 http://127.0.0.1:8080/ 或你的域名访问。";
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", API + "/api/bootstrap?_=" + Date.now(), false);
      /* 跨域部署时登录态在 Cookie 里，同步探测也必须带上，否则会被当成游客；
         自定义请求头（如 Cache-Control）会触发跨域预检，URL 上带 _= 时间戳已足够防缓存，不再设置。 */
      if (isCrossSite(API)) xhr.withCredentials = true;
      xhr.send(null);
      if (xhr.status < 200 || xhr.status >= 300) {
        return "请求 /api/bootstrap 返回 HTTP " + xhr.status;
      }
      var d = JSON.parse(xhr.responseText);
      if (!d || !Array.isArray(d.posts)) {
        return "接口返回的数据结构不对（/api/bootstrap 没有 posts）";
      }
      return d;
    } catch (e) {
      return "无法访问 " + (API || "同源") + "/api/bootstrap";
    }
  };

  K.goOffline = function (reason) {
    if (K.offlineRedirecting || /(^|\/)offline\.html$/.test(location.pathname)) return;
    K.offlineRedirecting = true;
    K.failed = true;
    K.error = reason || "";
    /* 万一脚本在 body 已存在时才失败，先清掉骨架再跳 */
    try { if (document.body) document.body.innerHTML = ""; } catch (e) {}

    /* 跳转失败时页面已经被清空，必须补一句兜底文案，不能留白页 */
    function fallback() {
      try {
        if (!document.body) {
          /* 脚本在 <head> 里执行，body 还没解析出来，等 DOM 就绪再补文案 */
          document.addEventListener("DOMContentLoaded", fallback);
          return;
        }
        if (document.getElementById("kimon-offline-fallback")) return;
        var box = document.createElement("div");
        box.id = "kimon-offline-fallback";
        box.style.cssText = "min-height:100vh;display:flex;align-items:center;justify-content:center;" +
          "padding:24px;text-align:center;font:15px/1.8 system-ui,sans-serif;color:#666";
        box.textContent = "暂时连不上后端，请稍后刷新页面重试。";
        document.body.appendChild(box);
      } catch (e) {}
    }

    /* 断连页只给一句轻松提示，URL 里不带报错细节 */
    var here = location.pathname + location.search;
    var url = "offline.html?from=" + encodeURIComponent(here);
    var ok = false;
    try { location.replace(url); ok = true; } catch (e) {}
    if (!ok) { try { location.href = url; ok = true; } catch (e2) {} }
    if (!ok) fallback();
  };
})();
