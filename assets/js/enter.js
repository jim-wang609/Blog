/* ============================================================
   站主入口 / 我的空间
   数据源只有一个：remote.js 同步取到的 /api/bootstrap（数据库）
   登录态走 /api/session，登录走 /api/login，与管理台共用同一会话 Cookie
   ============================================================ */

(function () {
  "use strict";

  /* boot.js 判定后端连不上时已整页跳到 offline.html，这里不再渲染任何东西 */
  if (window.KIMON && window.KIMON.failed) return;

  var K = window.KIMON || {};
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 通用 ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function setText(id, v) { var el = $(id); if (el) el.textContent = String(v == null ? "" : v); }

  function fmtNum(n) {
    n = Number(n) || 0;
    return n >= 1000 ? String(n / 1000).replace(/(\.\d)0$/, "$1") + "k" : String(n);
  }

  function assetUrl(u) {
    if (!u) return "";
    if (u.charAt(0) === "/" && K.api) return K.api + u;
    return u;
  }

  var VIEWS = ["loading", "login", "setup", "lobby", "guest"];
  function show(name) {
    VIEWS.forEach(function (v) { var el = $("view-" + v); if (el) el.hidden = v !== name; });
  }

  function fail(msgId, text) {
    var m = $(msgId);
    if (m) { m.textContent = text; m.classList.remove("ok"); }
    var card = document.querySelector(".door-card");
    if (card) { card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); }
  }

  function busy(btn, on, label) {
    if (!btn) return;
    btn.disabled = !!on;
    var span = btn.querySelector("span");
    if (span && label != null) span.textContent = label;
  }

  /* ?next= 只允许站内页面名 + 可选锚点，避免开放重定向 */
  var NEXT = {
    home: "home.html", studio: "studio.html", diary: "diary.html",
    guestbook: "guestbook.html", posts: "studio.html#posts",
    comments: "studio.html#comments", settings: "studio.html#settings"
  };
  function nextTarget() {
    var q = "";
    try { q = new URLSearchParams(location.search).get("next") || ""; } catch (e) {}
    if (NEXT[q]) return NEXT[q];
    if (/^[a-z0-9_-]+\.html(#[a-z0-9_/-]+)?$/i.test(q)) return q;
    return "";
  }

  /* ---------- 主题 ---------- */

  $("door-theme").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("kimon-theme", next); } catch (e) {}
  });

  /* ---------- 站点信息（全部来自数据库） ---------- */

  var site = window.SITE || {};
  var counts = K.counts || {};
  var name = site.name || "Kimon";

  function initial(s) {
    s = String(s || "K").trim();
    return s ? s.charAt(0).toUpperCase() : "K";
  }

  function paintAvatar(el, src, who) {
    if (!el) return;
    var letter = el.querySelector(".avatar-letter");
    var img = el.querySelector("img");
    if (src) {
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        el.insertBefore(img, el.firstChild);
      }
      img.src = assetUrl(src);
      if (letter) letter.style.display = "none";
    } else {
      if (img) img.remove();
      if (letter) { letter.style.display = ""; letter.textContent = initial(who); }
    }
  }

  function paintNumbers() {
    var p = fmtNum(counts.posts != null ? counts.posts : (window.POSTS || []).length);
    var e = fmtNum(counts.essays != null ? counts.essays : 0);
    var v = fmtNum(counts.visits != null ? counts.visits : 0);
    setText("stat-posts", p); setText("stat-essays", e); setText("stat-visits", v);
    /* 门厅用「文章 / 资源 / 访问」，跟左侧概览错开，避免同一组数字出现两遍 */
    setText("m-posts", p);
    setText("m-resources", fmtNum((window.RESOURCES || []).length));
    setText("m-visits", v);
  }

  function paintSite() {
    document.title = "站主入口 · " + name;
    setText("door-owner-name", name);
    setText("door-owner-sub", site.title || "个人博客 · 内容来自数据库");
    setText("foot-name", name);
    setText("door-lead", site.bio || "站在这儿的你，既是读者，也是这里的主人。");
    paintAvatar($("door-avatar"), site.avatar, name);
    paintAvatar($("lobby-avatar"), site.avatar, name);
    paintNumbers();
    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }

  /* ---------- 状态分发 ---------- */

  function paintLobby() {
    var u = K.auth.user || {};
    setText("lobby-title", "欢迎回来，" + (u.name || name));
    /* setText 走 textContent，这里不能再 esc，否则名字里出现 & < 会被二次转义成 &amp; */
    setText("lobby-who", "已登录 · " + (u.name || name) + " · 管理员");
    paintNumbers();
  }

  function start() {
    paintSite();

    if (!K.remote) {
      /* remote.js 已整页跳到 offline.html；这里只是跳转被拦截时的兜底 */
      K.goOffline(K.error || "无法读取站点数据");
      return;
    }

    var ready = K.auth.ready || Promise.resolve(null);
    ready.then(function () {
      return K.request("/api/admin/state");
    }).then(function (s) {
      if (s && s.needSetup) {
        setupTokenRequired = !!(s.setupTokenRequired);
        show("setup");
        ensureSetupToken();
        return;
      }
      var u = K.auth.user;
      if (u && u.role === "admin") { paintLobby(); show("lobby"); }
      else if (u) {
        setText("guest-desc", "当前登录的是「" + (u.name || "访客") + "」，这个账号只能留言，不能管理内容。请换用管理员账号。");
        show("guest");
      } else {
        show("login");
        var n = $("login-name");
        if (n && !n.value) setTimeout(function () { n.focus(); }, 80);
      }
    }).catch(function (err) {
      K.goOffline("连接管理接口失败：" + (err && err.message ? err.message : "未知错误") + "。请确认后端已启动。");
    });
  }

  /* ---------- 登录 ---------- */

  $("toggle-pass").addEventListener("click", function () {
    var i = $("login-pass");
    var reveal = i.type === "password";
    i.type = reveal ? "text" : "password";
    this.classList.toggle("on", reveal);
    this.setAttribute("aria-label", reveal ? "隐藏密码" : "显示密码");
    this.title = reveal ? "隐藏密码" : "显示密码";
  });

  function afterLogin(user) {
    if (!user || user.role !== "admin") {
      /* 访客账号也能通过 /api/login，但不能进后台：退回并提示 */
      return K.logout().then(function () {
        setText("guest-desc", "「" + ((user && user.name) || "这个账号") + "」是访客账号，只能留言。请用管理员账号登录。");
        show("guest");
      });
    }
    var dest = "home.html";
    var picked = document.querySelector('input[name="dest"]:checked');
    if (picked && picked.value === "studio") dest = "studio.html";
    var target = nextTarget() || dest;

    var m = $("login-msg");
    m.textContent = "✓ 已登录，正在回到 " + (target.indexOf("studio") > -1 ? "管理台" : "你的首页") + "…";
    m.classList.add("ok");
    setTimeout(function () { window.location.href = target; }, 520);
  }

  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var n = $("login-name").value.trim();
    var p = $("login-pass").value;
    var btn = $("login-submit");
    if (!n || !p) { fail("login-msg", "账号和密码都要填"); return; }

    busy(btn, true, "验证中…");
    $("login-msg").textContent = "";
    K.login(n, p).then(afterLogin).catch(function (err) {
      busy(btn, false, "进入");
      fail("login-msg", err.message || "登录失败，请再试一次");
    });
  });

  /* ---------- 首次初始化 ---------- */

  var setupTokenRequired = false;

  /* 后端配置了初始化口令时，setup 表单需要一起提交 setupToken */
  function ensureSetupToken() {
    if (!setupTokenRequired || !$("setup-form") || $("setup-token")) return;
    var msg = $("setup-msg");
    var wrap = document.createElement("div");
    wrap.id = "setup-token-wrap";
    wrap.innerHTML =
      '<label class="door-label" for="setup-token">初始化口令</label>' +
      '<div class="door-input"><input id="setup-token" type="password" autocomplete="off" placeholder="部署时设置的 SETUP_TOKEN"></div>';
    if (msg && msg.parentNode) msg.parentNode.insertBefore(wrap, msg);
    else $("setup-form").appendChild(wrap);
  }

  $("setup-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var n = $("setup-name").value.trim() || "admin";
    var p = $("setup-pass").value;
    var p2 = $("setup-pass2").value;
    var btn = $("setup-submit");
    if (p.length < 10) { fail("setup-msg", "管理员密码至少 10 位"); return; }
    if (p !== p2) { fail("setup-msg", "两次输入不一致"); return; }
    var token = $("setup-token") ? $("setup-token").value.trim() : "";
    if (setupTokenRequired && !token) { fail("setup-msg", "请填写初始化口令"); $("setup-token").focus(); return; }

    busy(btn, true, "创建中…");
    var body = { name: n, password: p };
    if (token) body.setupToken = token;
    K.request("/api/admin/setup", { method: "POST", body: body })
      .then(function (r) {
        K.auth.user = r.user;
        document.dispatchEvent(new CustomEvent("kimon:auth", { detail: r.user }));
        var m = $("setup-msg");
        m.textContent = "✓ 创建成功，正在进入…";
        m.classList.add("ok");
        setTimeout(function () { window.location.href = nextTarget() || "home.html"; }, 700);
      })
      .catch(function (err) {
        busy(btn, false, "创建并进入");
        fail("setup-msg", err.message || "创建失败");
      });
  });

  /* ---------- 退出 / 切换账号 ---------- */

  function backToLogin() {
    K.logout().then(function () {
      show("login");
      $("login-pass").value = "";
      $("login-msg").textContent = "";
      $("login-name").focus();
    }).catch(function () { window.location.reload(); });
  }

  $("lobby-logout").addEventListener("click", backToLogin);
  $("guest-switch").addEventListener("click", backToLogin);

  /* Esc 回首页 */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      window.location.href = "home.html";
    }
  });

  /* 浏览器 bfcache：从「后退」回到这一页时重新确认登录态，别显示过期视图 */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) window.location.reload();
  });

  start();
})();
