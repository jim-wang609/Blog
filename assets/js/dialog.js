/* ============================================================
   全站统一提示层 —— 代替浏览器原生 alert / confirm / prompt

   用法（都返回 Promise）：
     KIMON.ui.toast("已保存")
     KIMON.ui.alert("搞定了")
     KIMON.ui.confirm("确定删除？").then(function (yes) { ... })
     KIMON.ui.prompt("新日记本叫什么？", "日常随记").then(function (name) { ... })

   队列串行：同时触发多个弹窗时一个接一个出现，不会叠在一起。
   ============================================================ */

(function () {
  "use strict";

  var K = (window.KIMON = window.KIMON || {});

  var ICON = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.6 2.5 17.3A2 2 0 004.2 20.3h15.6a2 2 0 001.7-3L13.7 3.6a2 2 0 00-3.4 0z"/><path d="M12 9v4.5M12 17h.01"/></svg>',
    ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.4 9.2a2.7 2.7 0 015.2.9c0 1.8-2.6 2.1-2.6 3.8M12 17.2h.01"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4z"/></svg>'
  };

  function ready() {
    if (document.body) return Promise.resolve();
    return new Promise(function (resolve) {
      document.addEventListener("DOMContentLoaded", function () { resolve(); }, { once: true });
    });
  }

  function svg(name) { return ICON[name] || ICON.info; }

  /* ---------- toast ---------- */

  function toastHost() {
    var h = document.getElementById("kd-toasts");
    if (!h) {
      h = document.createElement("div");
      h.id = "kd-toasts";
      h.className = "kd-toasts";
      h.setAttribute("aria-live", "polite");
      document.body.appendChild(h);
    }
    return h;
  }

  function toast(msg, kind) {
    return ready().then(function () {
      var host = toastHost();
      var el = document.createElement("div");
      el.className = "kd-toast kd-" + (kind || "info");
      el.innerHTML = '<span class="kd-ti">' + svg(kind === "error" ? "warn" : kind === "success" ? "ok" : "info") + "</span>" +
        '<span class="kd-tt"></span>';
      el.querySelector(".kd-tt").textContent = String(msg == null ? "" : msg);
      host.appendChild(el);
      while (host.children.length > 3) host.removeChild(host.firstElementChild);
      requestAnimationFrame(function () { el.classList.add("in"); });
      setTimeout(function () {
        el.classList.remove("in");
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
      }, 2600);
    });
  }

  /* ---------- modal ---------- */

  var queue = [];
  var active = null;

  function modal(opts) {
    return ready().then(function () {
      return new Promise(function (resolve) {
        queue.push({ opts: opts || {}, resolve: resolve });
        pump();
      });
    });
  }

  function pump() {
    if (active || !queue.length) return;
    var job = queue.shift();
    active = job;
    /* 关掉之后把焦点还给触发弹窗的元素，键盘操作不会丢位置 */
    var opener = document.activeElement;
    var o = job.opts;
    var hasInput = !!o.input;
    var iconName = o.icon || (o.danger ? "warn" : hasInput ? "edit" : o.confirm ? "ask" : "info");

    var wrap = document.createElement("div");
    wrap.className = "kd-backdrop";
    wrap.innerHTML =
      '<div class="kd-card" role="dialog" aria-modal="true" aria-labelledby="kd-title">' +
        '<div class="kd-glow" aria-hidden="true"></div>' +
        '<div class="kd-ico kd-ico-' + (o.danger ? "danger" : hasInput ? "edit" : "normal") + '">' + svg(iconName) + "</div>" +
        '<h2 class="kd-title" id="kd-title"></h2>' +
        '<p class="kd-msg"></p>' +
        (hasInput ? '<input class="kd-input" type="text" autocomplete="off" spellcheck="false">' : "") +
        '<div class="kd-actions">' +
          (o.cancelText === null ? "" : '<button class="kd-btn kd-cancel" type="button"></button>') +
          '<button class="kd-btn kd-ok' + (o.danger ? " danger" : "") + '" type="button"></button>' +
        "</div>" +
      "</div>";

    wrap.querySelector(".kd-title").textContent = o.title || (o.danger ? "确认一下" : hasInput ? "填一个值" : "提示");
    wrap.querySelector(".kd-msg").textContent = o.message || "";
    var cancel = wrap.querySelector(".kd-cancel");
    var ok = wrap.querySelector(".kd-ok");
    if (cancel) cancel.textContent = o.cancelText || "取消";
    ok.textContent = o.okText || "确定";
    var input = wrap.querySelector(".kd-input");
    if (input) {
      /* 默认值 / 占位符都用 DOM 属性写入，绝不拼进 innerHTML */
      input.value = o.value == null ? "" : String(o.value);
      input.placeholder = o.placeholder || "";
      if (o.password) input.type = "password";
    }

    document.body.appendChild(wrap);
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(function () { wrap.classList.add("in"); });

    var done = false;
    function close(result) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      wrap.classList.remove("in");
      wrap.classList.add("out");
      setTimeout(function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        document.body.style.overflow = prevOverflow;
        active = null;
        job.resolve(result);
        /* 通知业务层弹窗已关闭（用于解除按钮锁定等），不暴露具体返回值给无关模块 */
        try {
          document.dispatchEvent(new CustomEvent("kimon:dialog", { detail: { result: result == null ? null : !!result } }));
        } catch (e) {}
        /* 焦点归还原触发元素；元素已从 DOM 移除时浏览器会自动忽略 */
        try {
          if (opener && typeof opener.focus === "function") opener.focus();
        } catch (e) {}
        pump();
      }, 190);
    }

    function submit() {
      close(hasInput ? (input.value.trim() || null) : true);
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(hasInput ? null : false); return; }
      if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        /* 焦点在「取消」上时回车等于取消，不能触发确认 */
        if (cancel && document.activeElement === cancel) { close(hasInput ? null : false); return; }
        submit();
        return;
      }
      if (e.key === "Tab") {
        var items = [].slice.call(wrap.querySelectorAll("input, button"));
        if (!items.length) return;
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(hasInput ? null : false); });
    if (cancel) cancel.addEventListener("click", function () { close(hasInput ? null : false); });
    ok.addEventListener("click", submit);

    setTimeout(function () {
      (input || ok).focus();
      if (input) input.select();
    }, 60);
  }

  var ui = {
    toast: toast,
    alert: function (message, opts) {
      var o = opts || {};
      o.message = message;
      o.confirm = false;
      o.cancelText = null;
      return modal(o);
    },
    confirm: function (message, opts) {
      var o = opts || {};
      o.message = message;
      o.confirm = true;
      return modal(o);
    },
    prompt: function (message, value, opts) {
      var o = opts || {};
      o.message = message;
      o.value = value;
      o.input = true;
      return modal(o);
    }
  };

  K.ui = ui;

  /* 兜底：万一还有漏改的调用，也不让浏览器原生弹窗冒出来。
     confirm / prompt 是同步 API，这里无法保留「等待用户点按」的语义，
     所以统一返回安全值（false / null），并把提示交给自定义弹窗展示。
     业务代码一律用上面的 Promise 版本。 */
  window.alert = function (msg) { toast(String(msg), "info"); };
  window.confirm = function (msg) {
    console.warn("[KIMON] 原生 confirm 已禁用，请改用 KIMON.ui.confirm()");
    ui.confirm(String(msg), { danger: true });
    return false;
  };
  window.prompt = function (msg, def) {
    console.warn("[KIMON] 原生 prompt 已禁用，请改用 KIMON.ui.prompt()");
    ui.prompt(String(msg), def);
    return null;
  };
})();
