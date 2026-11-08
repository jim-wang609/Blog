/* ============================================================
   后端接通层 —— 只有一种数据源：数据库

   页面加载时同步取 /api/bootstrap，成功后写 window.POSTS 等。
   取不到 / 返回异常 / 用 file:// 打开，一律整页跳到 offline.html：
   不显示错误条加空壳页面，更不会拿打包时的旧数据凑数。

   1) 同步取 /api/bootstrap  2) 访问统计埋点  3) 登录态与留言/评论
   ============================================================ */

(function () {
  "use strict";

  var K = (window.KIMON = window.KIMON || {});
  K.remote = false;
  K.auth = { user: null, ready: null };

  K.error = "";
  /* 前后端同机时为空；分开部署时由 config.js 指定后端地址 */
  var API = String(window.KIMON_API || "").replace(/\/$/, "");
  K.api = API;

  /* 前后端分离部署时，Cookie 必须跨站携带，否则登录态永远为游客 */
  var crossSite = (function () {
    if (!API) return false;
    try { return new URL(API, location.href).origin !== location.origin; } catch (e) { return false; }
  })();
  var credentials = crossSite ? "include" : "same-origin";
  K.crossSite = crossSite;

  function absUrl(u) {
    if (!API || !u) return u;
    return u.charAt(0) === "/" ? API + u : u;
  }

  /* ---------- 1. 在线模式：内容一律取数据库 ---------- */

  /* 初始化空数据槽位；真正的内容只由 applyBootstrap 从数据库写入 */
  function initEmpty() {
    window.POSTS = [];
    window.RESOURCES = [];
    window.NOTES = { cheatsheets: [], links: [] };
    window.GALLERY = { title: "", intro: "", albums: [], photos: [] };
    window.DIARY = [];
    window.SITE = window.SITE || {
      name: "", location: "", email: "", github: "",
      footerNote: "", bio: "", title: "", stats: {}
    };
    K.counts = {};
  }

  /* 连不上就走独立断连页，绝不在原页面上半遮半掩地渲染空壳 */
  function fail(msg) {
    K.error = msg;
    K.goOffline(msg);
  }

  /* 内容指纹：只取真正的内容字段。访问数 / 阅读量 / 下载数 / 统计会随浏览变化，
     必须排除，否则每次切回标签都会误判成「内容更新」而反复刷新。 */
  function fingerprint(d) {
    var posts = (d.posts || []).map(function (p) {
      return [p.id, p.section, p.title, p.excerpt, p.body, p.cat, p.tags,
              p.minutes, p.pinned, p.status, p.date, p.cover, p.updatedAt];
    });
    var resources = (d.resources || []).map(function (r) {
      var o = {};
      Object.keys(r || {}).forEach(function (k) {
        if (k !== "downloads" && k !== "views" && k !== "downloadUrl") o[k] = r[k];
      });
      return o;
    });
    return JSON.stringify([d.site || {}, posts, resources, d.notes || {},
                           d.gallery || {}, d.guestbook || []]);
  }

  function applyBootstrap(d) {
    /* 必须在 URL 改写之前算指纹，保证与自动同步时拿到的原始响应一致 */
    K.contentRev = fingerprint(d);
    K.remote = true;
    K.guestbook = d.guestbook || [];
    K.counts = d.counts || {};

    if (d.site) {
      Object.keys(d.site).forEach(function (k) { window.SITE[k] = d.site[k]; });
    }
    (d.posts || []).forEach(function (p) {
      if (p.cover && p.cover.image) p.cover.image = absUrl(p.cover.image);
      if (p.avatar) p.avatar = absUrl(p.avatar);
    });
    if (window.SITE && window.SITE.avatar) window.SITE.avatar = absUrl(window.SITE.avatar);
    window.POSTS = d.posts || [];
    if (d.resources) window.RESOURCES = d.resources;
    /* 日记不在这里下发：仅管理员登录后单独拉取 */
    /* 工具清单模块已下线：只保留速查与链接，旧库里残留的 tools 直接忽略 */
    if (d.notes) window.NOTES = { cheatsheets: d.notes.cheatsheets || [], links: d.notes.links || [] };
    if (d.gallery) {
      window.GALLERY = d.gallery;
      (window.GALLERY.photos || []).forEach(function (p) { p.src = absUrl(p.src); });
    }
    /* 资源带 id 才能走 /api/download 计数 */
    window.RESOURCES = (window.RESOURCES || []).map(function (r) {
      r.downloadUrl = r.id && r.hasFile ? API + "/api/download/" + r.id : "";
      return r;
    });
  }

  K.fingerprint = fingerprint;

  /* boot.js 已在 <head> 里同步取过数据；这里只负责把数据库内容写进全局槽位。
     拿不到数据说明引导没跑或被绕过，同样整页跳断连页，绝不渲染空壳。 */
  initEmpty();
  if (K.bootstrap && typeof K.bootstrap === "object") {
    applyBootstrap(K.bootstrap);
  } else {
    fail(K.error || "没有拿到 /api/bootstrap 数据");
  }

  /* ---------- 2. 访问统计 ---------- */

  if (K.remote) {
    window.addEventListener("load", function () {
      try {
        var payload = JSON.stringify({
          path: location.pathname + location.search,
          ref: document.referrer || ""
        });
        /* sendBeacon 跨站不带 Cookie，会让访客 ID 每次都重算，UV 失真 */
        if (navigator.sendBeacon && !crossSite) {
          navigator.sendBeacon(API + "/api/track", new Blob([payload], { type: "application/json" }));
        } else {
          fetch(API + "/api/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            credentials: credentials,
            keepalive: true
          });
        }
      } catch (e) {}
    });
  }

  /* ---------- 3. 账号 ---------- */

  function emit() {
    document.dispatchEvent(new CustomEvent("kimon:auth", { detail: K.auth.user }));
  }

  /* 15 秒超时：后端卡死时请求不能永远挂着（轮询单飞靠它才能复位） */
  var REQUEST_TIMEOUT = 15000;

  K.request = function (path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: credentials, cache: "no-store", headers: {} };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    var ctrl = null;
    var timer = null;
    if (typeof AbortController === "function") {
      ctrl = new AbortController();
      init.signal = ctrl.signal;
      timer = setTimeout(function () {
        try { ctrl.abort(); } catch (e) {}
      }, REQUEST_TIMEOUT);
    }

    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || "请求失败（" + res.status + "）");
        return data;
      });
    }).then(function (data) {
      if (timer) clearTimeout(timer);
      return data;
    }, function (err) {
      if (timer) clearTimeout(timer);
      /* 超时被 abort 后浏览器只会给一个 AbortError，这里换成能看懂的提示 */
      if (err && err.name === "AbortError") {
        throw new Error("请求超时（15 秒），请检查网络或后端状态");
      }
      if (err && err.name === "TypeError") {
        throw new Error("网络错误，无法连接后端");
      }
      throw err;
    });
  };

  K.login = function (name, password) {
    return K.request("/api/login", { method: "POST", body: { name: name, password: password } })
      .then(function (r) { K.auth.user = r.user; emit(); return r.user; });
  };

  K.logout = function () {
    return K.request("/api/logout", { method: "POST" }).then(function () {
      K.auth.user = null;
      emit();
    });
  };

  K.comment = function (payload) {
    return K.request("/api/comments", { method: "POST", body: payload });
  };

  /* 文章阅读量 +1：只在后端在线时上报，失败静默（统计不该影响阅读） */
  K.view = function (id) {
    if (!K.remote || !id) return;
    try {
      K.request("/api/view/" + encodeURIComponent(id), { method: "POST" })
        .catch(function () {});
    } catch (e) {}
  };

  /* 评论 / 留言分页：返回 {items, hasMore}。
     opts.limit 每页条数（后端默认 100、服务端上限 100）；opts.beforeId 传上一页的最小 id 取更早一页。 */
  K.loadComments = function (target, opts) {
    opts = opts || {};
    var qs = "target=" + encodeURIComponent(target);
    if (opts.limit) qs += "&limit=" + encodeURIComponent(opts.limit);
    if (opts.beforeId) qs += "&beforeId=" + encodeURIComponent(opts.beforeId);
    return K.request("/api/comments?" + qs).then(function (r) {
      r = r || {};
      return { items: r.items || [], hasMore: !!r.hasMore };
    });
  };

  if (K.remote) {
    K.auth.ready = K.request("/api/session")
      .then(function (r) {
        var u = r.user || null;
        K.auth.user = (u && u.name) ? u : null;
        emit();
        return K.auth.user;
      })
      .catch(function () { return null; });
  } else {
    K.auth.ready = Promise.resolve(null);
  }

  /* ---------- 3.1 仅管理员可见的元素（日记入口等） ----------
     页面上带 data-admin-only 的元素默认 hidden，
     确认当前登录人是管理员后才显示；退出登录立刻藏回去。 */

  K.isAdmin = function () {
    return !!(K.auth.user && K.auth.user.role === "admin");
  };

  /* 站主入口：顶栏胶囊 + 页脚小字，全站公开页面都能看见。
     未登录 → enter.html（登录后可回自己的首页）
     管理员 → 同一个链接变成「我的空间」，并额外保留一个直达管理台的「管理」。
     由这里统一注入，11 个页面不必各改一遍，也不会漏。 */
  var OWNER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="3.6"/>' +
    '<path d="M10.7 12.3 20 3M17 6l2 2M14 9l2 2"/></svg>';

  function syncOwnerEntry() {
    /* 入口页自己不需要再链一次自己 */
    if (/(^|\/)enter\.html$/.test(location.pathname)) return;

    var actions = document.querySelector(".header-actions");
    if (actions && !actions.querySelector(".owner-entry")) {
      var a = document.createElement("a");
      a.className = "owner-entry";
      a.href = "enter.html";
      a.title = "站主入口 · 登录后回到自己的首页或进入管理台";
      a.innerHTML = OWNER_ICON + "<span>站主入口</span>";
      actions.insertBefore(a, actions.firstChild);
    }

    var foot = document.querySelector(".footer-bottom");
    if (foot && !foot.querySelector(".footer-owner")) {
      var f = document.createElement("a");
      f.className = "footer-owner";
      f.href = "enter.html";
      f.textContent = "站主入口";
      f.title = "站主入口";
      var mini = foot.querySelector(".footer-mini");
      if (mini) mini.appendChild(f);
      else foot.appendChild(f);
    }

    var label = K.isAdmin() ? "我的空间" : "站主入口";
    document.querySelectorAll(".owner-entry span").forEach(function (s) { s.textContent = label; });
    document.querySelectorAll(".footer-owner").forEach(function (s) { s.textContent = label; });
  }

  function syncAdminEntry() {
    var actions = document.querySelector(".header-actions");
    if (!actions) return;
    var link = actions.querySelector(".admin-entry");
    if (K.isAdmin()) {
      if (!link) {
        link = document.createElement("a");
        link.className = "admin-entry";
        link.href = "studio.html";
        link.textContent = "管理";
        link.title = "进入后台";
        actions.appendChild(link);
      }
    } else if (link) {
      link.remove();
    }
  }

  function syncAdminOnly() {
    var show = K.isAdmin();
    document.querySelectorAll("[data-admin-only]").forEach(function (el) {
      el.hidden = !show;
    });
    syncOwnerEntry();
    syncAdminEntry();
  }

  K.syncAdminOnly = syncAdminOnly;

  if (K.auth.ready) K.auth.ready.then(syncAdminOnly);
  document.addEventListener("kimon:auth", syncAdminOnly);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncAdminOnly);
  } else {
    syncAdminOnly();
  }

  /* ---------- 4. 留言 / 评论渲染 ---------- */

  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso).replace("T", " ").slice(0, 16);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* 留言列表渲染：文章评论仍是顺序列表，站长留言板用「一块板」的便签墙 */
  K.renderList = function (wrap, list, opts) {
    if (!wrap) return;
    var board = !!(opts && opts.board);
    if (!list.length) {
      wrap.innerHTML = board
        ? '<div class="gb-note-empty">板上还空着，贴第一张便签吧。</div>'
        : '<div class="cmt-empty">还没有人留言，做第一个吧。</div>';
      return;
    }
    if (board) {
      var tilts = [-0.8, 0.65, -0.5, 0.85, -0.35, 0.45];
      wrap.innerHTML = list.map(function (m, i) {
        var name = m.name || "匿名访客";
        return '<article class="gb-note" data-tint="' + (i % 4) + '" style="--tilt:' + tilts[i % tilts.length] + 'deg">' +
          '<span class="gb-pin" aria-hidden="true"></span>' +
          '<div class="gb-note-head">' +
            '<span class="gb-av">' + esc(name.slice(0, 1).toUpperCase()) + '</span>' +
            '<span class="gb-name">' + esc(name) + '</span>' +
            '<span class="gb-note-no">#' + ("0" + (i + 1)).slice(-2) + '</span>' +
          '</div>' +
          '<div class="gb-body">' + esc(m.body) + '</div>' +
          '<div class="gb-note-foot"><span class="gb-dot"></span>' +
            '<span class="gb-time">' + esc(fmtTime(m.createdAt || m.time)) + '</span>' +
          '</div>' +
        '</article>';
      }).join("");
      return;
    }
    wrap.innerHTML = list.map(function (m) {
      var name = m.name || "匿名访客";
      return '<div class="gb-item">' +
        '<div class="gb-head">' +
          '<div class="gb-av">' + esc(name.slice(0, 1).toUpperCase()) + '</div>' +
          '<span class="gb-name">' + esc(name) + '</span>' +
          '<span class="gb-time">' + esc(fmtTime(m.createdAt || m.time)) + '</span>' +
        '</div>' +
        '<div class="gb-body">' + esc(m.body) + '</div>' +
      '</div>';
    }).join("");
  };

  /* 列表加载失败：显示明确错误 + 重试，不能悄悄当成「还没有内容」 */
  K.renderListError = function (wrap, err, retry) {
    if (!wrap) return;
    wrap.innerHTML = '<div class="cmt-empty">加载失败：' +
      esc(err && err.message ? err.message : "网络错误") +
      ' <button class="btn cmt-retry" type="button" style="margin-left:8px;padding:4px 12px">重试</button></div>';
    var b = wrap.querySelector(".cmt-retry");
    if (b && retry) b.addEventListener("click", retry);
  };

  /* 分页「加载更多」按钮：挂在列表容器外层，重渲染列表时不会被冲掉 */
  function moreBar(anchor, text, onClick) {
    var box = document.createElement("div");
    box.className = "cmt-more";
    box.style.cssText = "text-align:center;margin-top:16px";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = text;
    box.appendChild(btn);
    box.hidden = true;
    btn.addEventListener("click", onClick);
    if (anchor && anchor.parentNode) anchor.parentNode.appendChild(box);
    return { box: box, btn: btn };
  }

  /* 当前已加载数据里最小的 id，作为下一页 beforeId */
  function minId(list) {
    var ids = (list || []).map(function (m) { return Number(m && m.id) || 0; }).filter(Boolean);
    return ids.length ? Math.min.apply(null, ids) : 0;
  }

  /* 留言 / 评论一律免登录、发布即显示：访客填个称呼就能发。
     全站登录统一走「站主入口」enter.html，这里不再放登录表单；
     站长唯一要做的管理动作是在后台删除不想要的留言。 */

  /* ---------- 5. 留言板 ---------- */

  var COMMENT_PAGE = 20;

  K.mountGuestbook = function (root) {
    var wrap = root.querySelector("[data-gb-list]");
    var form = root.querySelector("form");
    if (!form) return;

    var nameEl = form.querySelector("[name=name]");
    var bodyEl = form.querySelector("[name=body]");
    var preview = root.querySelector(".gb-mini-av");
    var flashBox = root.querySelector("[data-flash]");
    var list = [];
    var hasMore = false;
    var loading = false;
    var NAME_KEY = "kimon-gb-name";

    var more = moreBar(wrap, "加载更早的留言", function () { load(false); });
    function syncMore() {
      more.box.hidden = !hasMore;
      more.btn.disabled = loading;
    }

    function syncPreview() {
      if (!preview || !nameEl) return;
      var v = (nameEl.value || "").trim();
      preview.textContent = v ? v.slice(0, 1).toUpperCase() : "?";
      preview.classList.toggle("empty", !v);
    }

    try {
      var saved = localStorage.getItem(NAME_KEY);
      if (saved && nameEl) nameEl.value = saved;
    } catch (e) {}
    syncPreview();

    function render() {
      K.renderList(wrap, list, { board: true });
      var count = root.querySelector("[data-gb-count]");
      if (count) count.textContent = list.length + " 张便签";
      if (K.enhanceMotion && wrap) K.enhanceMotion(wrap);
    }

    function load(reset) {
      if (loading) return Promise.resolve();
      loading = true;
      var opts = { limit: COMMENT_PAGE };
      if (!reset) {
        var before = minId(list);
        if (!before) { loading = false; syncMore(); return Promise.resolve(); }
        opts.beforeId = before;
      }
      return K.loadComments("guestbook", opts).then(function (r) {
        list = reset ? r.items.slice() : list.concat(r.items);
        hasMore = !!r.hasMore;
        loading = false;
        render();
        syncMore();
      }).catch(function (err) {
        loading = false;
        if (reset && !list.length) {
          K.renderListError(wrap, err, function () { load(true); });
        } else {
          flash(flashBox, err.message || "加载失败，请稍后重试");
        }
        syncMore();
      });
    }

    render();
    load(true);
    syncMore();
    if (nameEl) nameEl.addEventListener("input", syncPreview);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = (bodyEl.value || "").trim();
      if (!body) { bodyEl.focus(); return; }

      var name = nameEl ? (nameEl.value || "").trim() : "";
      K.comment({
        target: "guestbook",
        name: name,
        body: body
      }).then(function () {
        bodyEl.value = "";
        bodyEl.blur();
        if (name) {
          try { localStorage.setItem(NAME_KEY, name); } catch (err) {}
        }
        dirtyForm = false;
        /* 免审核：提交即显示，刷新第一页 + 同步指纹，避免下一轮轮询整页刷新 */
        load(true);
        K.syncFingerprint();
        flash(flashBox, "留言已发布");
      }).catch(function (err) {
        flash(flashBox, err.message);
      });
    });
  };

  function flash(el, text) {
    if (!el) { if (K.ui) K.ui.toast(text); return; }
    var old = el.querySelector(".auth-flash");
    if (old) old.remove();
    var d = document.createElement("div");
    d.className = "auth-flash";
    d.textContent = text;
    el.appendChild(d);
    setTimeout(function () { d.remove(); }, 4000);
  }

  /* ---------- 6. 文章评论（支持楼中回复） ---------- */

  function cmtName(m) { return m.name || "匿名访客"; }

  /* 两层结构：顶层评论 + 挂在它下面的回复，回复不再嵌套第三层 */
  K.renderThread = function (wrap, list, savedName) {
    if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = '<div class="cmt-empty">还没有评论，来说两句吧。</div>';
      return;
    }

    var topIds = {};
    list.forEach(function (m) { if (!Number(m.parentId || 0)) topIds[m.id] = 1; });
    var top = list.filter(function (m) {
      var p = Number(m.parentId || 0);
      return !p || !topIds[p];
    });
    var kids = {};
    list.forEach(function (m) {
      var p = Number(m.parentId || 0);
      if (!p || !topIds[p]) return;
      (kids[p] = kids[p] || []).push(m);
    });
    Object.keys(kids).forEach(function (k) {
      kids[k].sort(function (a, b) {
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      });
    });

    wrap.innerHTML = top.map(function (m) {
      var children = kids[m.id] || [];
      var replies = children.map(function (r) {
        return '<div class="cmt-reply">' +
          '<div class="cmt-reply-head"><span class="gb-av sm">' + esc(cmtName(r).slice(0, 1).toUpperCase()) + '</span>' +
            '<span class="cmt-reply-name">' + esc(cmtName(r)) + '</span>' +
            '<span class="gb-time">' + esc(fmtTime(r.createdAt || r.time)) + '</span></div>' +
          '<div class="gb-body">' + esc(r.body) + '</div>' +
        '</div>';
      }).join("");

      return '<div class="gb-item cmt-thread" data-cmt-id="' + m.id + '">' +
        '<div class="gb-head">' +
          '<div class="gb-av">' + esc(cmtName(m).slice(0, 1).toUpperCase()) + '</div>' +
          '<span class="gb-name">' + esc(cmtName(m)) + '</span>' +
          '<span class="gb-time">' + esc(fmtTime(m.createdAt || m.time)) + '</span>' +
        '</div>' +
        '<div class="gb-body">' + esc(m.body) + '</div>' +
        '<div class="cmt-ops">' +
          '<button class="cmt-reply-btn" type="button" data-reply="' + m.id + '">回复</button>' +
          (children.length ? '<span class="cmt-count">' + children.length + ' 条回复</span>' : '') +
        '</div>' +
        (replies ? '<div class="cmt-replies">' + replies + '</div>' : '') +
        '<div class="cmt-reply-form" data-form="' + m.id + '" hidden>' +
          '<input class="field cmt-rname" type="text" maxlength="20" placeholder="你的称呼（可留空）" value="' + esc(savedName || "") + '">' +
          '<textarea class="field cmt-rbody" rows="2" maxlength="600" placeholder="回复 ' + esc(cmtName(m)) + '…"></textarea>' +
          '<div class="cmt-ractions">' +
            '<button class="cmt-reply-btn ghost" type="button" data-reply-cancel>取消</button>' +
            '<button class="cmt-reply-btn send" type="button" data-reply-send>发送回复</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join("");
  };

  K.mountPostComments = function (section, postId) {
    if (!section || !postId) return;
    var wrap = section.querySelector("[data-cmt-list]");
    var form = section.querySelector("form");
    var bodyEl = form ? form.querySelector("[name=body]") : null;
    var nameEl = form ? form.querySelector("[name=name]") : null;
    var preview = section.querySelector(".gb-mini-av");
    var flashBox = section.querySelector("[data-flash]");
    var list = [];
    var hasMore = false;
    var loading = false;
    var NAME_KEY = "kimon-gb-name";
    var saved = "";
    try { saved = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}

    var more = moreBar(wrap, "加载更早的评论", function () { reload(false); });
    function syncMore() {
      more.box.hidden = !hasMore;
      more.btn.disabled = loading;
    }

    function render() {
      K.renderThread(wrap, list, saved);
      if (K.enhanceMotion && wrap) K.enhanceMotion(wrap);
    }

    function reload(reset) {
      if (loading) return Promise.resolve();
      loading = true;
      var opts = { limit: COMMENT_PAGE };
      if (!reset) {
        var before = minId(list);
        if (!before) { loading = false; syncMore(); return Promise.resolve(); }
        opts.beforeId = before;
      }
      return K.loadComments(postId, opts).then(function (r) {
        list = reset ? r.items.slice() : list.concat(r.items);
        hasMore = !!r.hasMore;
        loading = false;
        render();
        syncMore();
      }).catch(function (err) {
        loading = false;
        if (reset && !list.length) {
          /* 加载失败要明确报错，不能显示「还没有评论」误导用户 */
          K.renderListError(wrap, err, function () { reload(true); });
        } else {
          flash(flashBox, err.message || "评论加载失败");
        }
        syncMore();
      });
    }

    render();
    reload(true);
    syncMore();

    function syncPreview() {
      if (!preview || !nameEl) return;
      var v = (nameEl.value || "").trim();
      preview.textContent = v ? v.slice(0, 1).toUpperCase() : "?";
      preview.classList.toggle("empty", !v);
    }

    if (saved && nameEl) nameEl.value = saved;
    syncPreview();
    if (nameEl) nameEl.addEventListener("input", syncPreview);

    function remember(name) {
      if (!name) return;
      saved = name;
      try { localStorage.setItem(NAME_KEY, name); } catch (e) {}
    }

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var body = (bodyEl.value || "").trim();
        if (!body) { bodyEl.focus(); return; }

        var name = nameEl ? (nameEl.value || "").trim() : "";
        K.comment({ target: postId, name: name, body: body })
          .then(function () {
            bodyEl.value = "";
            remember(name);
            dirtyForm = false;
            reload(true);
            K.syncFingerprint();
            flash(flashBox, "评论已发布");
          })
          .catch(function (err) { flash(flashBox, err.message); });
      });
    }

    if (wrap) {
      wrap.addEventListener("click", function (e) {
        var open = e.target.closest("[data-reply]");
        if (open) {
          var box = wrap.querySelector('.cmt-reply-form[data-form="' + open.getAttribute("data-reply") + '"]');
          if (!box) return;
          var wasHidden = box.hidden;
          wrap.querySelectorAll(".cmt-reply-form").forEach(function (f) { f.hidden = true; });
          box.hidden = !wasHidden;
          if (wasHidden) box.querySelector(".cmt-rbody").focus();
          return;
        }
        if (e.target.closest("[data-reply-cancel]")) {
          e.target.closest(".cmt-reply-form").hidden = true;
          return;
        }
        var send = e.target.closest("[data-reply-send]");
        if (!send) return;
        var formEl = send.closest(".cmt-reply-form");
        var parentId = Number(formEl.getAttribute("data-form"));
        var text = (formEl.querySelector(".cmt-rbody").value || "").trim();
        if (!text) { formEl.querySelector(".cmt-rbody").focus(); return; }
        var rname = (formEl.querySelector(".cmt-rname").value || "").trim();
        send.disabled = true;
        K.comment({ target: postId, parentId: parentId, name: rname, body: text })
          .then(function () {
            remember(rname);
            dirtyForm = false;
            formEl.querySelector(".cmt-rbody").value = "";
            flash(flashBox, "回复已发布");
            K.syncFingerprint();
            return reload(true).then(function () {
              var again = wrap.querySelector('.cmt-reply-form[data-form="' + parentId + '"]');
              if (again) again.hidden = true;
            });
          })
          .catch(function (err) { flash(flashBox, err.message); })
          .then(function () { send.disabled = false; });
      });
    }
  };

  /* ---------- 7. 后台改动 → 前台自动同步 ----------
     后台 studio 每次写操作成功后会写 localStorage 标记，同源的前台标签收到
     storage 事件立刻复查数据库。切回标签与定时轮询是跨设备、漏事件的兜底。
     只有「内容字段」真的变了才刷新；正在填表单时只给一条可点的提示。 */

  var CHANGED_KEY = "kimon-content-changed";
  var checking = false;
  var lastCheck = 0;
  var dirtyForm = false;

  /* 只把「表单控件」算作正在填表：搜索框等独立输入不再让更新提示永久挂着 */
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t && t.form) dirtyForm = true;
  }, true);
  document.addEventListener("submit", function () { dirtyForm = false; }, true);
  document.addEventListener("reset", function () { dirtyForm = false; }, true);

  function busy() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || dirtyForm;
  }

  function showUpdateBar() {
    if (document.getElementById("kimon-content-update")) return;
    var bar = document.createElement("div");
    bar.id = "kimon-content-update";
    bar.className = "content-update";
    bar.setAttribute("role", "status");
    bar.innerHTML = '<span>站点内容有更新</span><button type="button">点击刷新</button>';
    bar.querySelector("button").addEventListener("click", function () { location.reload(); });
    (document.body || document.documentElement).appendChild(bar);
  }

  /* /api/rev 轻量版本号：60s 轮询先比它，没变就不用拉整包 bootstrap */
  function fetchRev() {
    return K.request("/api/rev?_=" + Date.now()).then(function (r) {
      if (r && typeof r.rev === "string") K.rev = r.rev;
      return K.rev;
    }).catch(function () { return null; });
  }

  /* 刚发完留言 / 评论：只更新内存指纹，不重渲染，避免下一轮轮询把刚发的内容当成外部变更 */
  K.syncFingerprint = function () {
    if (!K.remote) return Promise.resolve(false);
    return K.request("/api/bootstrap?_=" + Date.now()).then(function (d) {
      if (!d || !Array.isArray(d.posts)) return false;
      K.contentRev = fingerprint(d);
      if (typeof d.rev === "string") K.rev = d.rev;
      else fetchRev();
      return true;
    }).catch(function () { return false; });
  };

  function pullBootstrap(polite, now) {
    return K.request("/api/bootstrap?_=" + now).then(function (d) {
      if (!d || !d.posts) return false;
      if (typeof d.rev === "string") K.rev = d.rev;
      else fetchRev();   /* bootstrap 不带版本号时补记一次，避免下一轮又整包比对 */
      var rev = fingerprint(d);
      if (rev === K.contentRev) return false;
      K.contentRev = rev;         /* 先记下，避免重复触发 */
      if (busy() || polite) showUpdateBar();
      else location.reload();
      return true;
    });
  }

  /* force 跳过节流；polite 只提示不整页刷新（用于页面正开着时的定时复查） */
  K.checkUpdates = function (force, polite) {
    if (!K.remote || checking) return Promise.resolve(false);
    var now = Date.now();
    if (!force && now - lastCheck < 3000) return Promise.resolve(false);
    lastCheck = now;
    checking = true;

    return Promise.resolve().then(function () {
      return K.request("/api/rev?_=" + now).then(function (r) {
        if (r && typeof r.rev === "string" && K.rev && r.rev === K.rev) {
          return false;   /* 版本号没变，跳过整包比对 */
        }
        return pullBootstrap(polite, now);
      }, function () {
        /* rev 接口不可用时退回老办法：拉 bootstrap 比指纹 */
        return pullBootstrap(polite, now);
      });
    }).catch(function () {
      return false;
    }).then(function (v) {
      checking = false;   /* finally 语义：无论如何都要复位，fetch 卡死也不会永久失效 */
      return v;
    }, function () {
      checking = false;
      return false;
    });
  };

  if (K.remote) {
    fetchRev();   /* 首次加载记录一次 rev */
    window.addEventListener("storage", function (e) {
      if (e.key === CHANGED_KEY) K.checkUpdates(true, false);
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) K.checkUpdates(false, false);
    });
    window.addEventListener("focus", function () { K.checkUpdates(false, false); });
    /* 跨浏览器 / 跨设备改内容的兜底：每分钟静默复查一次，只提示不强刷 */
    setInterval(function () {
      if (!document.hidden) K.checkUpdates(false, true);
    }, 60000);
  }
})();
