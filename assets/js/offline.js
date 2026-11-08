/* ============================================================
   断连页逻辑 —— 只做一件事：等后端回来，然后放人回原页面。
   不展示原因、状态、报错码；页面上只有一句轻松的提示。
   ============================================================ */

(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var fileMode = location.protocol === "file:";
  var API = String(window.KIMON_API || "").replace(/\/$/, "");
  var leaving = false;
  var probing = false;
  var btn = document.getElementById("of-retry");

  /* ?from= 只允许站内页面，避免被当成开放重定向。
     必须用 URL 解析再比对 origin：像 /\\evil.com/x.html 这种串，
     浏览器会先把反斜杠规范成 //，光看字符前缀是挡不住的。 */
  function target() {
    var raw = params.get("from") || "";
    if (!raw) return "home.html";

    var u;
    try { u = new URL(raw, location.href); } catch (e) { return "home.html"; }

    /* 只放行 http/https，javascript: / data: 之类一律拒绝 */
    if (u.protocol !== "http:" && u.protocol !== "https:") return "home.html";
    /* 必须是同源，跨站地址不能作为跳转目标 */
    if (u.origin !== location.origin) return "home.html";

    /* 只回站内页面；断连页自身不能作为目标，避免原地打转 */
    if (!/\.html$/i.test(u.pathname)) return "home.html";
    if (/\/offline\.html$/i.test(u.pathname)) return "home.html";

    return u.pathname + u.search + u.hash;
  }
  var back = target();

  function goBack() {
    if (leaving) return;
    leaving = true;
    try { location.replace(back); } catch (e) { location.href = back; }
  }

  function nudge() {
    if (!btn) return;
    btn.textContent = "还没回来…";
    btn.classList.remove("is-wait");
    void btn.offsetWidth;
    btn.classList.add("is-wait");
    clearTimeout(btn._timer);
    btn._timer = setTimeout(function () {
      btn.textContent = "再敲一次门";
      btn.classList.remove("is-wait");
    }, 1800);
  }

  /* 轮询单飞 + 4 秒超时：后端挂起时不会越堆越多请求 */
  function probe(manual) {
    if (leaving || probing) return;
    if (fileMode) { if (manual) nudge(); return; }

    probing = true;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = null;
    var init = { method: "GET", cache: "no-store", credentials: "same-origin" };
    if (ctrl) {
      init.signal = ctrl.signal;
      timer = setTimeout(function () {
        try { ctrl.abort(); } catch (e) {}
      }, 4000);
    }

    function done() {
      probing = false;
      if (timer) clearTimeout(timer);
      timer = null;
    }

    fetch(API + "/api/bootstrap?_=" + Date.now(), init).then(function (res) {
      if (!res.ok) throw new Error("not ready");
      return res.json();
    }).then(function (d) {
      if (!d || !Array.isArray(d.posts)) throw new Error("not ready");
      done();
      goBack();
    }).catch(function () {
      done();
      if (manual) nudge();
    });
  }

  if (btn) btn.addEventListener("click", function () { probe(true); });

  if (!fileMode) {
    probe(false);
    setInterval(function () {
      if (!document.hidden) probe(false);
    }, 5000);
  }
})();
