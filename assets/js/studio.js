/* ============================================================
   管理台前端逻辑
   只依赖浏览器原生 API，不引框架
   ============================================================ */

(function () {
  "use strict";

  /* boot.js 判定后端连不上时已整页跳到 offline.html，这里不再渲染任何东西 */
  if (window.KIMON && window.KIMON.failed) return;

  var $ = function (id) { return document.getElementById(id); };
  var view = $("view");
  /* 统一提示层：dialog.js 在 <head> 里已加载；这里给个空实现兜底，绝不弹原生框 */
  var UI = (window.KIMON && window.KIMON.ui) || {
    toast: function () {},
    confirm: function () { return Promise.resolve(false); },
    prompt: function () { return Promise.resolve(null); }
  };

  var state = {
    user: null,
    needSetup: false,
    setupTokenRequired: false,
    view: "overview",
    postsStatus: "all",
    postsQuery: "",
    editing: null,
    overview: null,
    site: {},
    terms: { cats: [], tags: [] }
  };

  /* 未保存改动标记：编辑区 / 设置 / 日记 / 相册等表单被改过就置 true */
  var dirty = false;
  function markDirty() { dirty = true; }
  function clearDirty() { dirty = false; }

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(msg) {
    if (window.KIMON && window.KIMON.ui) { UI.toast(msg); return; }
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* 与前台共用 config.js 里的后端地址：分离部署时后台也要连得上后端 */
  var API = String(window.KIMON_API || "").replace(/\/$/, "");
  var crossSite = (function () {
    if (!API) return false;
    try { return new URL(API, location.href).origin !== location.origin; } catch (e) { return false; }
  })();

  function assetUrl(u) {
    if (!API || !u) return u;
    return u.charAt(0) === "/" ? API + u : u;
  }

  /* ---------- 写操作单飞 + 按钮锁定 ----------
     请求在返回前不重复发；点过的写操作按钮在请求 / 确认框结束前保持禁用。 */
  var pendingWrites = {};
  var writePending = 0;
  var lockedActions = [];

  function beginWrite() { writePending++; }

  function endWrite() {
    writePending = Math.max(0, writePending - 1);
    if (!writePending) releaseAllActions();
  }

  function lockActionButton(btn) {
    if (!btn || btn._actLock) return;
    btn._actLock = true;
    btn._actPrev = !!btn.disabled;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    lockedActions.push(btn);
    clearTimeout(btn._actTimer);
    /* 兜底：万一下面既没有请求也没有弹窗（比如前端校验直接返回），8 秒后解锁 */
    btn._actTimer = setTimeout(function () { releaseActionButton(btn); }, 8000);
  }

  function releaseActionButton(btn) {
    if (!btn || !btn._actLock) return;
    clearTimeout(btn._actTimer);
    delete btn._actTimer;
    btn._actLock = false;
    btn.disabled = !!btn._actPrev;
    delete btn._actPrev;
    btn.removeAttribute("aria-busy");
  }

  function releaseAllActions() {
    var list = lockedActions;
    lockedActions = [];
    list.forEach(releaseActionButton);
  }

  function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || "GET",
      credentials: crossSite ? "include" : "same-origin",
      cache: "no-store",
      headers: {}
    };
    if (opts.body instanceof FormData) {
      init.body = opts.body;
    } else if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    /* 带时间戳，避免后台列表被浏览器缓存成旧数据 */
    var url = API + path + (init.method === "GET" ? (path.indexOf("?") < 0 ? "?_=" : "&_=") + Date.now() : "");

    /* 写请求单飞：相同 method + path + body 在返回前复用同一个 Promise，
       双击保存 / 删除不会真的写两次（新建文章只生成一篇）。 */
    var write = init.method !== "GET";
    var wkey = write
      ? (init.method + " " + path + " " + (typeof init.body === "string" ? init.body : "[form]"))
      : "";
    if (write && pendingWrites[wkey]) return pendingWrites[wkey];
    if (write) beginWrite();

    var request = fetch(url, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 || res.status === 403) {
          /* 会话失效 / 权限被收回：统一退回登录 gate，不能停在已登录界面继续点 */
          state.user = null;
          try {
            var side = document.querySelector(".st-side");
            if (side) side.style.display = "";
            showGate(false);
            var gateMsg = $("gate-msg");
            if (gateMsg) gateMsg.textContent = data.error || "登录状态已失效，请重新登录";
          } catch (e) {}
          var authErr = new Error(data.error || "登录状态已失效，请重新登录");
          authErr.status = res.status;
          authErr.auth = true;
          throw authErr;
        }
        if (!res.ok) throw new Error(data.error || "请求失败（" + res.status + "）");
        /* 任何后台写操作成功后广播：同源的前台标签会立刻复查数据库并刷新 */
        if (write && path.indexOf("/api/admin/") === 0) {
          try { localStorage.setItem("kimon-content-changed", String(Date.now())); } catch (e2) {}
        }
        return data;
      });
    });

    if (write) {
      pendingWrites[wkey] = request;
      var settle = function () {
        delete pendingWrites[wkey];
        endWrite();
      };
      request.then(settle, settle);
    }
    return request;
  }

  /* 弹窗关闭后（确认 / 取消）解除按钮锁定；如果此时已有写请求进行，交给 endWrite 处理 */
  document.addEventListener("kimon:dialog", function () {
    setTimeout(function () {
      if (!writePending) releaseAllActions();
    }, 0);
  });

  /* ---------- 防重复提交 ----------
     同一个 key 的写操作在返回前拒绝第二次触发；传入 btn 时请求期间禁用该按钮。 */
  var inflight = {};

  function lock(key, btn) {
    if (inflight[key]) return false;
    inflight[key] = true;
    if (btn) {
      btn._lockPrev = !!btn.disabled;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    }
    return true;
  }

  function unlock(key, btn) {
    delete inflight[key];
    if (btn) {
      btn.disabled = !!btn._lockPrev;
      delete btn._lockPrev;
      btn.removeAttribute("aria-busy");
    }
  }

  /* 统一包装：work 可以是 Promise，返回时自动解锁；已锁定则直接忽略 */
  function guarded(key, btn, work) {
    if (!lock(key, btn)) return Promise.resolve(false);
    var finish = function () { unlock(key, btn); };
    var p;
    try { p = work(); } catch (e) { finish(); return Promise.reject(e); }
    if (!p || typeof p.then !== "function") { finish(); return Promise.resolve(true); }
    return p.then(function (v) { finish(); return v; }, function (e) { finish(); throw e; });
  }

  /* 编辑器里同时禁用「存草稿 / 发布」两个按钮 */
  function setPostSaving(on) {
    view.querySelectorAll('[data-act="save-draft"],[data-act="save-publish"]').forEach(function (b) {
      if (on) {
        if (b._savePrev != null) return;
        b._savePrev = !!b.disabled;
        b.disabled = true;
        b.setAttribute("aria-busy", "true");
      } else {
        b.disabled = !!b._savePrev;
        delete b._savePrev;
        b.removeAttribute("aria-busy");
      }
    });
  }

  function fmtDate(iso) {
    if (!iso) return "";
    return String(iso).slice(0, 10);
  }

  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 16).replace("T", " ");
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---------- 登录 / 初始化 ---------- */

  var gate = $("gate");

  /* 初始化口令输入框：HTML 里没有就动态补一个，避免影响其它页面结构 */
  function ensureSetupTokenField(show) {
    var wrap = $("gate-token-wrap");
    if (!show) {
      if (wrap) wrap.hidden = true;
      return;
    }
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "st-field";
      wrap.id = "gate-token-wrap";
      wrap.innerHTML =
        '<label for="gate-token">初始化口令</label>' +
        '<input class="st-input" id="gate-token" type="password" autocomplete="off" placeholder="部署时设置的 SETUP_TOKEN">';
      var pass2 = $("gate-pass2-wrap");
      if (pass2 && pass2.parentNode) pass2.parentNode.insertBefore(wrap, pass2.nextSibling);
      else {
        var okBtn = $("gate-submit");
        if (okBtn && okBtn.parentNode) okBtn.parentNode.insertBefore(wrap, okBtn);
      }
    }
    wrap.hidden = false;
  }

  function showGate(setup) {
    state.needSetup = setup;
    clearDirty();
    gate.hidden = false;
    $("gate-title").textContent = setup ? "设置管理员密码" : "登录管理台";
    $("gate-desc").textContent = setup
      ? "第一次使用，先设一个密码。以后写文章、审评论都靠它。至少 10 位。"
      : "输入管理员账号与密码。";
    $("gate-pass2-wrap").hidden = !setup;
    /* 后端配置了初始化口令时，setup 表单需要一起提交 setupToken */
    ensureSetupTokenField(!!(setup && state.setupTokenRequired));
    $("gate-submit").textContent = setup ? "创建并进入" : "进入";
    if (setup) $("gate-user").value = "admin";
    setTimeout(function () { $("gate-pass").focus(); }, 60);
  }

  function hideGate() {
    gate.hidden = true;
    $("gate-msg").textContent = "";
    $("gate-pass").value = "";
    if ($("gate-pass2")) $("gate-pass2").value = "";
    if ($("gate-token")) $("gate-token").value = "";
  }

  function submitGate() {
    var user = $("gate-user").value.trim() || "admin";
    var pass = $("gate-pass").value;
    var msg = $("gate-msg");
    var btn = $("gate-submit");

    if (state.needSetup) {
      if (pass.length < 10) { msg.textContent = "密码至少 10 位"; return; }
      if (pass !== $("gate-pass2").value) { msg.textContent = "两次输入不一致"; return; }
      var tokenEl = $("gate-token");
      var token = tokenEl ? tokenEl.value.trim() : "";
      if (state.setupTokenRequired && !token) { msg.textContent = "请填写初始化口令"; if (tokenEl) tokenEl.focus(); return; }
      msg.textContent = "";
      guarded("gate-setup", btn, function () {
        var body = { name: user, password: pass };
        if (token) body.setupToken = token;
        return api("/api/admin/setup", { method: "POST", body: body });
      }).then(function (r) {
        if (!r) return;
        state.user = r.user;
        hideGate();
        boot();
      }).catch(function (e) { msg.textContent = e.message; });
      return;
    }

    msg.textContent = "";
    guarded("gate-login", btn, function () {
      return api("/api/admin/login", { method: "POST", body: { name: user, password: pass } });
    }).then(function (r) {
      if (!r) return;
      state.user = r.user;
      hideGate();
      boot();
    }).catch(function (e) { msg.textContent = e.message; });
  }

  $("gate-submit").addEventListener("click", submitGate);
  gate.addEventListener("keydown", function (e) { if (e.key === "Enter") submitGate(); });

  /* ---------- 主题 / 退出 ---------- */

  $("btn-theme").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("kimon-theme", next); } catch (e) {}
  });

  $("btn-logout").addEventListener("click", function () {
    api("/api/admin/logout", { method: "POST" }).then(function () {
      state.user = null;
      showGate(false);
    });
  });

  /* ---------- 侧栏 ---------- */

  document.querySelectorAll(".st-nav-item").forEach(function (btn) {
    btn.addEventListener("click", function () {
      go(btn.getAttribute("data-view"));
    });
  });

  function setActive(viewName) {
    document.querySelectorAll(".st-nav-item").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-view") === viewName);
    });
  }

  var leaveChecking = false;

  function go(name, opts) {
    opts = opts || {};
    var next = name === "drafts" ? "posts" : name;
    /* 切视图前有未保存改动：先确认，避免手滑丢掉编辑器 / 设置里的内容 */
    if (dirty && next !== state.view) {
      if (leaveChecking) return;   /* 确认框已经开着，别重复弹 */
      leaveChecking = true;
      UI.confirm("当前页有未保存的改动，确定离开吗？", { title: "未保存的改动", danger: true, okText: "离开" })
        .then(function (yes) {
          leaveChecking = false;
          if (!yes) return;
          clearDirty();
          goNow(name, opts);
        });
      return;
    }
    goNow(name, opts);
  }

  function goNow(name, opts) {
    /* 草稿箱不再单独占一个菜单；旧的 #drafts 深链自动落到「文章」并切到草稿筛选 */
    if (name === "drafts") { name = "posts"; state.postsStatus = "draft"; opts.keepFilter = true; }
    state.view = name;
    if (name === "posts" && !opts.keepFilter) state.postsStatus = "all";
    setActive(name === "editor" ? "posts" : name);
    /* 同步地址栏，刷新后还在当前视图；编辑器保留 #edit/<id> 深链 */
    if (name !== "editor") {
      try { history.replaceState(null, "", "#" + name); } catch (e) {}
    }
    render();
  }

  /* ---------- 深链：studio.html#<视图>/<参数> ----------
     前台卡片上的「编辑」按钮直接跳到对应的编辑界面：
     #posts #comments #guestbook #notes #resources #diary #gallery #terms #users #settings
     #drafts 是旧地址，等价于「文章 + 草稿筛选」，不再有独立菜单
     #new-post            新建文章
     #edit/<postId>       编辑某篇文章
     #resources/new       新建资源
     #resources/<id>      编辑某个资源
     #diary/<bookId>      打开某本日记
     #diary/<bookId>/new  在某本里写新条目
     #diary/<bookId>/<entryId>  编辑某条日记 */
  function applyHash() {
    var h = (location.hash || "").replace(/^#/, "");
    if (!h) return go("overview");
    var parts = h.split("/").filter(Boolean).map(function (s) {
      try { return decodeURIComponent(s); } catch (e) { return s; }
    });
    var v = parts[0];

    if (v === "new-post") { state.editing = null; return go("editor"); }

    if (v === "edit" && parts[1]) {
      return api("/api/admin/posts/" + encodeURIComponent(parts[1])).then(function (r) {
        state.editing = r.item;
        go("editor");
      }).catch(function (err) { toast(err.message); go("posts"); });
    }

    if (v === "resources") {
      if (parts[1]) state.resOpenId = parts[1];
      return go("resources");
    }

    if (v === "diary") {
      if (parts[1]) diaryState.bookId = parts[1];
      if (parts[2] === "new") diaryState.pendingEntry = "new";
      else if (parts[2]) diaryState.pendingEntry = parts[2];
      return go("diary");
    }

    var known = ["overview", "posts", "drafts", "comments", "guestbook", "notes", "gallery", "terms", "users", "settings"];
    go(known.indexOf(v) >= 0 ? v : "overview");
  }

  /* ---------- 渲染入口 ---------- */

  function loading() {
    view.innerHTML = '<div class="st-empty">载入中…</div>';
  }

  function render() {
    if (!state.user) return;
    if (state.view === "overview") return renderOverview();
    if (state.view === "posts") return renderPosts();
    if (state.view === "editor") return renderEditor();
    if (state.view === "comments") return renderComments("posts");
    if (state.view === "guestbook") return renderComments("guestbook");
    if (state.view === "diary") return renderDiary();
    if (state.view === "notes") return renderNotes();
    if (state.view === "resources") return renderResources();
    if (state.view === "gallery") return renderGalleryAdmin();
    if (state.view === "terms") return renderTerms();
    if (state.view === "users") return renderUsers();
    if (state.view === "settings") return renderSettings();
  }

  /* ---------- 概览 ---------- */

  function renderOverview() {
    loading();
    api("/api/admin/overview").then(function (d) {
      state.overview = d;
      var v = d.visits;
      var max = Math.max.apply(null, d.series.map(function (s) { return s.views; }).concat([1]));

      var bars = d.series.map(function (s) {
        var h = Math.max(2, Math.round((s.views / max) * 122));
        return '<div class="bar" style="height:' + h + 'px"><span>' + s.day.slice(5) + ' · ' + s.views + '</span></div>';
      }).join("");

      var topRefs = d.topRefs.length ? d.topRefs.map(function (r) {
        return '<div class="st-list-row"><span class="txt">' + esc(r.ref) + '</span><span class="n">' + r.n + '</span></div>';
      }).join("") : '<div class="st-empty">还没有外部来源</div>';

      var topPosts = d.topPosts.length ? d.topPosts.map(function (p) {
        return '<div class="st-list-row"><a class="txt" href="post.html?id=' + encodeURIComponent(p.id) + '" target="_blank" style="color:inherit;text-decoration:none">' + esc(p.title) + '</a><span class="n">' + p.views + ' 阅</span></div>';
      }).join("") : '<div class="st-empty">还没有文章</div>';

      var latest = d.recentComments.length ? d.recentComments.map(function (c) {
        return '<div class="st-list-row"><span class="txt">' + esc(c.name) + '：' + esc(c.body.slice(0, 26)) + '</span><span class="n">' + fmtDate(c.createdAt) + '</span></div>';
      }).join("") : '<div class="st-empty">还没有评论</div>';

      view.innerHTML =
        '<div class="st-head"><div><h1>概览</h1><p>最近 30 天的访问与内容概况</p></div>' +
          '<div class="st-actions">' +
            '<button class="st-btn" data-act="new-post">写文章</button>' +
            '<button class="st-btn primary" data-act="refresh">刷新</button>' +
          '</div></div>' +

        '<div class="st-stats">' +
          stat("今日访问", v.today, "独立访客 " + v.todayUniques) +
          stat("近 7 天", v.week, "近 30 天 " + v.month) +
          stat("累计访问", v.total, "独立访客 " + v.uniques) +
          stat("留言与评论", (d.counts.comments || 0) + (d.counts.guestbook || 0), "发布即显示 · 后台可删除") +
        '</div>' +

        '<div class="st-card">' +
          '<h2>访问趋势</h2>' +
          '<div class="st-chart">' + bars + '</div>' +
          '<div class="st-chart-labels"><span>' + d.series[0].day.slice(5) + '</span><span>今天</span></div>' +
        '</div>' +

        '<div class="st-two">' +
          '<div class="st-card"><h2>阅读排行</h2>' + topPosts + '</div>' +
          '<div class="st-card"><h2>内容概况</h2>' +
            '<div class="st-list">' +
              row("已发布文章", d.counts.posts + " 篇") +
              row("草稿", d.counts.drafts + " 篇") +
              row("资源", d.counts.resources + " 个") +
              row("资源下载", d.counts.downloads + " 次") +
              row("留言", d.counts.guestbook + " 条") +
            '</div>' +
          '</div>' +
        '</div>' +

        /* 访客来源默认收起：想看的时候点一下才展开 */
        '<details class="st-disclose">' +
          '<summary>' +
            '<span class="sd-label">访客来源</span>' +
            '<span class="sd-hint">想看再展开 · 近 30 天</span>' +
            '<svg class="sd-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
          '</summary>' +
          '<div class="st-list">' + topRefs + '</div>' +
        '</details>' +

        '<div class="st-card" style="margin-top:14px"><h2>最新评论</h2>' + latest + '</div>';

    }).catch(function (e) {
      view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>';
    });
  }

  function stat(k, v, d) {
    return '<div class="st-stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="d">' + esc(d) + '</div></div>';
  }

  function row(k, v) {
    return '<div class="st-list-row"><span class="txt">' + esc(k) + '</span><span class="n">' + esc(v) + '</span></div>';
  }

  /* ---------- 文章列表 ---------- */

  function renderPosts() {
    loading();
    var qs = "?status=" + encodeURIComponent(state.postsStatus === "all" ? "all" : state.postsStatus);
    if (state.postsQuery) qs += "&q=" + encodeURIComponent(state.postsQuery);

    api("/api/admin/posts" + qs).then(function (d) {
      var rows = d.items.map(function (p) {
        return '<tr>' +
          '<td><div class="t">' + esc(p.title) + '</div>' +
            '<div class="sub">' + esc(p.cat || "未分类") + ' · ' + esc((p.tags || []).join(" / ") || "无标签") + '</div></td>' +
          '<td><span class="st-pill">' + (p.section === "essay" ? "随笔" : "技术") + '</span></td>' +
          '<td>' + esc(fmtDate(p.date)) + '</td>' +
          '<td>' + (p.status === "draft" ? '<span class="st-pill warn">草稿</span>' : '<span class="st-pill ok">已发布</span>') + '</td>' +
          '<td style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-3)">' + p.views + '</td>' +
          '<td><div class="ops">' +
            '<button class="st-btn sm" data-act="edit" data-id="' + esc(p.id) + '">编辑</button>' +
            (p.status === "draft"
              ? '<button class="st-btn sm" data-act="publish" data-id="' + esc(p.id) + '">发布</button>'
              : '<button class="st-btn sm" data-act="unpublish" data-id="' + esc(p.id) + '">转草稿</button>') +
            '<button class="st-btn sm danger" data-act="del-post" data-id="' + esc(p.id) + '">删除</button>' +
          '</div></td>' +
        '</tr>';
      }).join("");

      var isDrafts = state.postsStatus === "draft";

      view.innerHTML =
        '<div class="st-head"><div><h1>' + (isDrafts ? "草稿箱" : "文章") + '</h1>' +
          '<p>' + (isDrafts ? "还没发布的内容，只有你自己看得到 · 草稿在这里筛选，不再单独占一个菜单" : "共 " + d.items.length + " 篇 · 草稿请用上方「草稿」筛选") + '</p></div>' +
          '<div class="st-actions"><button class="st-btn primary" data-act="new-post">新建文章</button></div></div>' +

        '<div class="st-toolbar">' +
          '<div class="st-seg">' +
            seg("all", "全部") + seg("published", "已发布") + seg("draft", "草稿") +
          '</div>' +
          '<input class="st-input" id="post-search" placeholder="搜标题 / 分类 / 标签" value="' + esc(state.postsQuery) + '">' +
        '</div>' +

        '<div class="st-card" style="padding:6px 14px">' +
          (d.items.length
            ? '<table class="st-table"><thead><tr><th>标题</th><th>分区</th><th>日期</th><th>状态</th><th>阅读</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
            : '<div class="st-empty">这里还没有内容</div>') +
        '</div>';

      var search = $("post-search");
      if (search) {
        var composing = false;
        var scheduleSearch = function () {
          clearTimeout(search._t);
          search._t = setTimeout(function () {
            renderPosts();
            var s2 = $("post-search");
            if (s2) {
              s2.focus();
              try { s2.setSelectionRange(s2.value.length, s2.value.length); } catch (e) {}
            }
          }, 260);
        };
        search.addEventListener("compositionstart", function () { composing = true; });
        search.addEventListener("compositionend", function () {
          composing = false;
          state.postsQuery = search.value;
          scheduleSearch();
        });
        search.addEventListener("input", function () {
          /* 中文输入法组合期间不要重渲染，否则候选还没上屏列表就刷新了 */
          if (composing) return;
          state.postsQuery = search.value;
          scheduleSearch();
        });
      }

      view.querySelectorAll(".st-seg button").forEach(function (b) {
        b.addEventListener("click", function () {
          state.postsStatus = b.getAttribute("data-status");
          state.view = "posts";
          setActive("posts");
          renderPosts();
        });
      });
    }).catch(function (e) { view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>'; });
  }

  function seg(key, label) {
    return '<button data-status="' + key + '" class="' + (state.postsStatus === key ? "on" : "") + '">' + label + '</button>';
  }

  /* ---------- 编辑器 ---------- */

  function blankPost() {
    return {
      id: "", section: "tech", title: "", excerpt: "", body: "", cat: "",
      tags: [], minutes: 5, pinned: false, status: "draft",
      cover: { glyph: "", tint: "purple", image: "" }
    };
  }

  function renderEditor() {
    var p = state.editing || blankPost();
    var cover = p.cover || {};

    view.innerHTML =
      '<div class="st-head"><div><h1>' + (p.id ? "编辑文章" : "写文章") + '</h1>' +
        '<p>' + (p.id ? "修改后记得保存" : "先写，再决定发布还是存草稿") + '</p></div>' +
        '<div class="st-actions">' +
          '<button class="st-btn" data-act="back">返回列表</button>' +
          '<button class="st-btn" data-act="save-draft">存草稿</button>' +
          '<button class="st-btn primary" data-act="save-publish">发布</button>' +
        '</div></div>' +

      '<div class="st-editor">' +
        '<div class="st-editor-main">' +
          '<input class="st-input" id="ed-title" placeholder="文章标题" value="' + esc(p.title) + '" style="font-size:16px;font-weight:500">' +

          '<div class="st-toolbar-edit">' +
            '<button data-md="h2" title="二级标题（进目录）">H2</button>' +
            '<button data-md="h3" title="三级标题">H3</button>' +
            '<button data-md="b" title="加粗 Ctrl/⌘+B"><b>B</b></button>' +
            '<button data-md="i" title="斜体 Ctrl/⌘+I"><i>I</i></button>' +
            '<button data-md="code" title="行内代码">code</button>' +
            '<button data-md="pre" title="代码块">代码块</button>' +
            '<button data-md="quote" title="引用">引用</button>' +
            '<button data-md="ul" title="无序列表">• 列表</button>' +
            '<button data-md="ol" title="有序列表">1. 列表</button>' +
            '<button data-md="link" title="链接 Ctrl/⌘+K">链接</button>' +
            '<button data-md="table" title="表格">表格</button>' +
            '<button data-md="hr" title="分割线">—</button>' +
            '<span class="sep"></span>' +
            '<button data-md="image" title="上传图片并插入 Markdown">插入图片</button>' +
            '<span class="st-md-modes" id="md-modes">' +
              '<button type="button" data-mdmode="edit">编辑</button>' +
              '<button type="button" data-mdmode="split" class="on">分栏</button>' +
              '<button type="button" data-mdmode="preview">预览</button>' +
              '<button type="button" data-act="preview" title="在新窗口完整预览">全屏</button>' +
            '</span>' +
          '</div>' +

          '<div class="st-md-work is-split" id="md-work">' +
            '<textarea class="st-area" id="ed-body" spellcheck="false" placeholder="用 Markdown 写正文…\n\n## 一个小标题\n\n- 一条列表\n- 另一条\n\n**加粗**、`行内代码`、[链接](https://…)">' + esc(p.body) + '</textarea>' +
            '<div class="st-preview st-md-preview" id="md-preview"></div>' +
          '</div>' +
          '<div class="st-md-status"><span id="md-count">0 字</span>' +
            '<span>Markdown · Ctrl/⌘+S 保存 · Ctrl/⌘+B 加粗 · Tab 缩进 · 回车自动续列表</span></div>' +
          '<div class="st-hint" style="font-size:11px;color:var(--text-3);line-height:1.7">' +
            '正文以 Markdown 存进数据库，前台按同一套规则渲染；<code>##</code> 标题会自动进文章目录，' +
            '图片建议用工具栏「插入图片」上传后再插入。</div>' +
        '</div>' +

        '<div class="st-editor-main">' +
          '<div class="st-card">' +
            '<h2>基本信息</h2>' +
            '<div class="st-field" style="margin-bottom:12px"><label>分区</label>' +
              '<select class="st-select" id="ed-section">' +
                '<option value="tech"' + (p.section === "tech" ? " selected" : "") + '>技术文章</option>' +
                '<option value="essay"' + (p.section === "essay" ? " selected" : "") + '>随笔</option>' +
              '</select></div>' +
            '<div class="st-field" style="margin-bottom:12px"><label>分类</label>' +
              '<input class="st-input" id="ed-cat" value="' + esc(p.cat) + '" placeholder="比如 JVM / 数据库" list="cat-list">' +
              '<datalist id="cat-list">' + state.terms.cats.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join("") + '</datalist>' +
            '</div>' +
            '<div class="st-field" style="margin-bottom:12px"><label>标签（逗号分隔）</label>' +
              '<input class="st-input" id="ed-tags" value="' + esc((p.tags || []).join(", ")) + '" placeholder="JVM, 线上问题">' +
              '<div class="term-suggest">' + (state.terms.tags || []).slice(0, 24).map(function (t) {
                return '<button class="st-btn sm" type="button" data-act="tag-pick" data-name="' + esc(t.name) + '">' + esc(t.name) + '</button>';
              }).join("") + '</div>' +
            '</div>' +
            '<div class="st-row" style="margin-bottom:12px">' +
              '<div class="st-field"><label>日期</label><input class="st-input" id="ed-date" type="date" value="' + esc(p.date || new Date().toISOString().slice(0, 10)) + '"></div>' +
              '<div class="st-field"><label>阅读时长</label><input class="st-input" id="ed-minutes" type="number" min="1" value="' + esc(p.minutes || 5) + '"></div>' +
            '</div>' +
            '<div class="st-field" style="margin-bottom:12px"><label>摘要</label>' +
              '<textarea class="st-area" id="ed-excerpt" rows="3" style="font-family:var(--font-sans);font-size:12.5px">' + esc(p.excerpt) + '</textarea>' +
            '</div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-2)">' +
              '<input type="checkbox" id="ed-pinned"' + (p.pinned ? " checked" : "") + '> 置顶到首页' +
            '</label>' +
          '</div>' +

          '<div class="st-card">' +
            '<h2>封面</h2>' +
            '<div class="st-cover-drop" id="cover-drop">' +
              (cover.image ? '<img src="' + esc(cover.image) + '" alt="封面预览">' : '<div style="padding:10px 0">还没有封面图</div>') +
              '<button class="st-btn sm" data-act="cover-upload" type="button">上传封面</button>' +
              (cover.image ? '<button class="st-btn sm danger" data-act="cover-clear" type="button">移除</button>' : '') +
            '</div>' +
            '<div class="st-row" style="margin-top:12px">' +
              '<div class="st-field"><label>色块字形</label><input class="st-input" id="ed-glyph" value="' + esc(cover.glyph || "") + '" placeholder="OutOfMemory"></div>' +
              '<div class="st-field"><label>配色</label>' +
                '<select class="st-select" id="ed-tint">' +
                  ["purple", "teal", "amber", "rose", "gray"].map(function (t) {
                    return '<option value="' + t + '"' + (cover.tint === t ? " selected" : "") + '>' + t + '</option>';
                  }).join("") +
                '</select></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var body = $("ed-body");
    view.querySelectorAll("[data-md]").forEach(function (btn) {
      btn.addEventListener("click", function () { wrapSelection(btn.getAttribute("data-md")); });
    });
    view.querySelectorAll("[data-mdmode]").forEach(function (btn) {
      btn.addEventListener("click", function () { mdSetMode(btn.getAttribute("data-mdmode")); });
    });
    body.addEventListener("input", mdPaintPreview);
    body.addEventListener("keydown", function (e) {
      var mod = e.metaKey || e.ctrlKey;
      var k = (e.key || "").toLowerCase();
      /* Ctrl/⌘+S 按文章当前真实状态保存：已发布文章仍是已发布，新文章 / 草稿才存草稿 */
      if (mod && k === "s") { e.preventDefault(); savePost(currentSaveStatus()); return; }
      if (mod && k === "b") { e.preventDefault(); wrapSelection("b"); return; }
      if (mod && k === "i") { e.preventDefault(); wrapSelection("i"); return; }
      if (mod && k === "k") { e.preventDefault(); wrapSelection("link"); return; }
      if (e.key === "Tab") { e.preventDefault(); insertAtCursor("  "); return; }
      if (e.key === "Enter" && !e.shiftKey && mdContinueList()) e.preventDefault();
    });
    mdPaintPreview();
  }

  /* 当前文章落盘时应保存的状态：已发布保持 published，新建 / 草稿为 draft */
  function currentSaveStatus() {
    var p = state.editing;
    if (p && p.id && p.status === "published") return "published";
    return "draft";
  }

  /* ---------- Markdown 写作模式 ---------- */

  function mdPaintPreview() {
    var ta = $("ed-body");
    var box = $("md-preview");
    var cnt = $("md-count");
    if (!ta) return;
    if (cnt) {
      cnt.textContent = ta.value.replace(/\s/g, "").length + " 字 · " +
        ta.value.split("\n").length + " 行";
    }
    if (!box) return;
    box.innerHTML = (window.KIMON && KIMON.mdToHtml)
      ? KIMON.mdToHtml(ta.value)
      : "<p>" + esc(ta.value).replace(/\n/g, "<br>") + "</p>";
    if (!ta.value.trim()) box.innerHTML = '<div class="st-empty">左边写点什么，这里会实时显示效果。</div>';
    /* studio.html 不加载 remote.js，预览里的图片地址统一用本文件 API 基址补全 */
    var apiBase = API;
    if (apiBase) {
      box.querySelectorAll("img[src]").forEach(function (img) {
        var v = img.getAttribute("src") || "";
        if (v.charAt(0) === "/" && v.slice(0, 2) !== "//") img.src = apiBase + v;
      });
    }
  }

  function mdSetMode(mode) {
    var work = $("md-work");
    if (!work) return;
    work.classList.remove("is-edit", "is-split", "is-preview");
    work.classList.add("is-" + mode);
    view.querySelectorAll("[data-mdmode]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-mdmode") === mode);
    });
    mdPaintPreview();
  }

  function mdContinueList() {
    var ta = $("ed-body");
    if (!ta || ta.selectionStart !== ta.selectionEnd) return false;
    var before = ta.value.slice(0, ta.selectionStart);
    var line = before.slice(before.lastIndexOf("\n") + 1);
    var m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!m) return false;
    if (!m[3].trim()) {
      var p = before.length - line.length;
      ta.value = before.slice(0, p) + ta.value.slice(ta.selectionStart);
      ta.setSelectionRange(p, p);
      return true;
    }
    var marker = /^\d+[.)]$/.test(m[2]) ? (parseInt(m[2], 10) + 1 + ". ") : (m[2] + " ");
    insertAtCursor("\n" + m[1] + marker);
    return true;
  }

  function currentCover() {
    var drop = $("cover-drop");
    var img = drop ? drop.querySelector("img") : null;
    return {
      image: img ? img.getAttribute("src") : "",
      glyph: ($("ed-glyph") || {}).value || "",
      tint: ($("ed-tint") || {}).value || "purple"
    };
  }

  function wrapSelection(kind) {
    var ta = $("ed-body");
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var sel = ta.value.slice(start, end);
    var out = "";

    if (kind === "h2") out = "## " + (sel || "小标题") + "\n";
    else if (kind === "h3") out = "### " + (sel || "小节") + "\n";
    else if (kind === "b") out = "**" + (sel || "加粗") + "**";
    else if (kind === "i") out = "*" + (sel || "斜体") + "*";
    else if (kind === "code") out = "`" + (sel || "code") + "`";
    else if (kind === "pre") out = "```\n" + (sel || "// code") + "\n```\n";
    else if (kind === "quote") out = "> " + (sel || "引用") + "\n";
    else if (kind === "ul") out = "- " + (sel || "条目") + "\n- 条目\n";
    else if (kind === "ol") out = "1. " + (sel || "条目") + "\n2. 条目\n";
    else if (kind === "hr") out = "\n---\n\n";
    else if (kind === "table") out = "| 项 | 说明 |\n| --- | --- |\n| 一 | " + (sel || "内容") + " |\n| 二 | 内容 |\n";
    else if (kind === "link") {
      UI.prompt("链接地址", "https://", { title: "插入链接", placeholder: "https://..." })
        .then(function (href) {
          if (!href) return;
          var link = "[" + (sel || href) + "](" + href + ")";
          ta.value = ta.value.slice(0, start) + link + ta.value.slice(end);
          var pos = start + link.length;
          ta.focus();
          ta.setSelectionRange(pos, pos);
          mdPaintPreview();
        });
      return;
    } else if (kind === "image") {
      pickFile("image", function (file) {
        uploadFile(file, "image").then(function (r) {
          insertAtCursor("![" + r.name + "](" + r.url + ")\n");
          markDirty();
          mdPaintPreview();
          toast("图片已上传，已插入 Markdown");
        }).catch(function (e) { toast(e.message); });
      });
      return;
    }

    ta.value = ta.value.slice(0, start) + out + ta.value.slice(end);
    var caret = start + out.length;
    ta.focus();
    ta.setSelectionRange(caret, caret);
    mdPaintPreview();
  }

  function insertAtCursor(text) {
    var ta = $("ed-body");
    var s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
    ta.focus();
    var pos = s + text.length;
    ta.setSelectionRange(pos, pos);
    if (typeof mdPaintPreview === "function") mdPaintPreview();
  }

  /* ---------- 上传前预检 + 浏览器端压缩 ---------- */
  var IMG_MAX_BYTES = 12 * 1024 * 1024;    /* 单张图片上限 12MB */
  var FILE_MAX_BYTES = 120 * 1024 * 1024;  /* 单个文件上限 120MB */
  var COMPRESS_MIN = 1024 * 1024;          /* 超过 1MB 才压缩 */

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  function fileExt(name) {
    var i = String(name || "").lastIndexOf(".");
    return i < 0 ? "" : String(name).slice(i + 1).toLowerCase();
  }

  /* 图片类型判定：SVG 明确拒绝（后端已禁止），GIF / SVG 不压缩 */
  function imageKind(file) {
    var t = String(file.type || "").toLowerCase();
    var e = fileExt(file.name);
    if (t === "image/svg+xml" || e === "svg") return "svg";
    if (t === "image/gif" || e === "gif") return "gif";
    if (t === "image/png" || e === "png") return "png";
    if (t === "image/webp" || e === "webp") return "webp";
    if (t === "image/jpeg" || e === "jpg" || e === "jpeg") return "jpeg";
    return "other";
  }

  function preflight(file, kind) {
    if (!file) return "没有选择文件";
    if (kind === "image" || kind === "avatar") {
      if (imageKind(file) === "svg") return "不支持 SVG 图片（后端已禁止），请用 PNG / JPG / WebP";
      if (file.size > IMG_MAX_BYTES) return "图片不能超过 12MB，当前 " + fmtSize(file.size);
      return "";
    }
    if (file.size > FILE_MAX_BYTES) return "文件不能超过 120MB，当前 " + fmtSize(file.size);
    return "";
  }

  /* canvas 压缩：普通图片最长边 1920、头像 512、质量 0.85；格式与扩展名保持不变。
     压缩后没有变小就保留原文件；GIF / SVG 不处理。 */
  function compressImage(file, maxEdge, quality) {
    return new Promise(function (resolve) {
      var kind = imageKind(file);
      if (kind === "gif" || kind === "svg" || kind === "other") { resolve(file); return; }
      if (file.size <= COMPRESS_MIN) { resolve(file); return; }

      var url = URL.createObjectURL(file);
      var img = new Image();
      function done(out) {
        try { URL.revokeObjectURL(url); } catch (e) {}
        resolve(out || file);
      }
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) { done(file); return; }
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          if (!ctx) { done(file); return; }
          /* JPEG 没有透明通道，垫白底避免透明区域变黑 */
          if (kind === "jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); }
          ctx.drawImage(img, 0, 0, cw, ch);
          var mime = kind === "png" ? "image/png" : kind === "webp" ? "image/webp" : "image/jpeg";
          var dataUrl = canvas.toDataURL(mime, quality);
          if (!dataUrl || dataUrl.indexOf("data:image") !== 0) { done(file); return; }
          var bin = atob(dataUrl.split(",")[1] || "");
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var blob = new Blob([bytes], { type: mime });
          if (!blob.size || blob.size >= file.size) { done(file); return; }
          var ext = kind === "png" ? "png" : kind === "webp" ? "webp" : "jpg";
          var base = String(file.name || "image").replace(/\.[^.]+$/, "");
          var name = (base || "image") + "." + ext;
          var out = null;
          try { out = new File([blob], name, { type: mime }); } catch (e) { out = null; }
          done(out || file);
        } catch (e) { done(file); }
      };
      img.onerror = function () { done(file); };
      img.src = url;
    });
  }

  function pickFile(kind, cb) {
    var input = document.createElement("input");
    input.type = "file";
    /* 明确列出图片类型，accept 里不再出现 SVG */
    input.accept = (kind === "image" || kind === "avatar")
      ? "image/png,image/jpeg,image/webp,image/gif,image/avif"
      : "";
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) cb(input.files[0]);
    });
    input.click();
  }

  /* 多选版：相册批量上传用，一次挑一堆图 */
  function pickFiles(kind, cb) {
    var input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = (kind === "image" || kind === "avatar")
      ? "image/png,image/jpeg,image/webp,image/gif,image/avif"
      : "";
    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (files.length) cb(files);
    });
    input.click();
  }

  function saveSiteAvatar(url) {
    var merged = Object.assign({}, state.site, { avatar: url });
    api("/api/admin/settings", { method: "PUT", body: { site: merged } })
      .then(function () {
        state.site = merged;
        toast(url ? "头像已更新" : "已改回首字母头像");
        if (state.view === "settings") render();
      })
      .catch(function (err) { toast(err.message); });
  }

  /* 全局单飞：同一时间只允许一个上传任务，避免重复点上传造成多次写入 */
  var uploading = false;
  /* 相册批量队列：一次只能跑一批，避免连点开出两组选择器 */
  var batchBusy = false;

  function uploadFile(file, kind, btn) {
    if (uploading) return Promise.reject(new Error("上一个文件还在上传，请稍候"));
    var err = preflight(file, kind);
    if (err) return Promise.reject(new Error(err));

    uploading = true;
    if (btn) {
      btn._upPrev = !!btn.disabled;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    }
    var maxEdge = kind === "avatar" ? 512 : 1920;

    var finish = function () {
      uploading = false;
      if (btn) {
        btn.disabled = !!btn._upPrev;
        delete btn._upPrev;
        btn.removeAttribute("aria-busy");
      }
    };

    return compressImage(file, maxEdge, 0.85).then(function (out) {
      var fd = new FormData();
      fd.append("kind", kind);
      try { fd.append("file", out, out.name || file.name || "upload"); }
      catch (e) { fd.append("file", out); }
      return api("/api/admin/upload", { method: "POST", body: fd });
    }).then(function (r) {
      finish();
      return r;
    }, function (e) {
      finish();
      throw e;
    });
  }

  function collectPost() {
    var tagsRaw = ($("ed-tags") || {}).value || "";
    return {
      title: ($("ed-title") || {}).value || "",
      section: ($("ed-section") || {}).value || "tech",
      cat: ($("ed-cat") || {}).value || "",
      tags: tagsRaw.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
      date: ($("ed-date") || {}).value || "",
      minutes: Number(($("ed-minutes") || {}).value) || 5,
      excerpt: ($("ed-excerpt") || {}).value || "",
      body: ($("ed-body") || {}).value || "",
      pinned: !!($("ed-pinned") && $("ed-pinned").checked),
      status: "draft",
      cover: currentCover()
    };
  }

  function savePost(status) {
    if (inflight["post-save"]) return;   /* 双击 / 连按 Ctrl+S 只提交一次 */
    var data = collectPost();
    if (!data.title.trim()) { toast("标题不能为空"); $("ed-title").focus(); return; }
    data.status = status;
    var id = state.editing && state.editing.id;
    if (!lock("post-save", null)) return;
    setPostSaving(true);

    var finish = function (err) {
      setPostSaving(false);
      unlock("post-save", null);
      if (err) toast(err.message);
    };

    var req = id
      ? api("/api/admin/posts/" + encodeURIComponent(id), { method: "PUT", body: data })
      : api("/api/admin/posts", { method: "POST", body: data });

    req.then(function (r) {
      state.editing = r.item;
      clearDirty();
      toast(status === "draft" ? "已存草稿" : "已发布");
      if (status === "published") {
        go("posts", { keepFilter: true });
      } else {
        renderEditor();
      }
      finish();
    }).catch(function (e) { finish(e); });
  }

  /* ---------- 评论 / 留言 ---------- */

  /* 免审核：留言 / 评论发布即显示，这里只做删除，不再有待审、通过、标记垃圾 */
  var CMT_PAGE = 30;
  var commentsState = { scope: "posts", items: [], total: 0, loading: false };

  function commentRow(c, isGuest) {
    return '<div class="st-comment">' +
      '<div class="top"><span class="who">' + esc(c.name) + '</span>' +
        (c.parentId ? '<span class="st-pill">回复</span>' : '') +
        '<span>' + fmtTime(c.createdAt) + '</span>' +
        (isGuest ? '' : '<span style="color:var(--text-3)">· ' + esc(c.target) + '</span>') +
      '</div>' +
      '<div class="body">' + esc(c.body) + '</div>' +
      '<div class="ops">' +
        '<button class="st-btn sm danger" data-act="c-del" data-id="' + esc(c.id) + '">删除</button>' +
      '</div>' +
    '</div>';
  }

  function paintComments(scope) {
    var isGuest = scope === "guestbook";
    var items = commentsState.items;
    var total = commentsState.total;
    var rows = items.length
      ? items.map(function (c) { return commentRow(c, isGuest); }).join("")
      : '<div class="st-empty">还没有内容</div>';
    var more = items.length < total
      ? '<div style="text-align:center;margin-top:14px">' +
          '<button class="st-btn" data-act="cmt-more" type="button">加载更多</button>' +
          '<div style="font-size:11px;color:var(--text-3);margin-top:6px">已显示 ' + items.length + ' / ' + total + ' 条</div>' +
        '</div>'
      : "";

    view.innerHTML =
      '<div class="st-head"><div><h1>' + (isGuest ? "留言" : "评论") + '</h1>' +
        '<p>' + (isGuest
          ? "访客留言发布后立即显示，不需要审核；删除后前台同步消失"
          : "文章评论支持楼中回复，发布后立即显示；删除顶层评论会连同它的回复一起删掉") + '</p></div></div>' +
      '<div class="st-toolbar"><div style="font-size:11.5px;color:var(--text-3)">共 ' + total + ' 条</div></div>' +
      '<div class="st-card">' + rows + '</div>' + more;
    view._scope = scope;
  }

  function loadCommentsPage(scope, offset, replace) {
    if (commentsState.loading) return;
    commentsState.loading = true;
    var qs = "?" + (scope === "guestbook" ? "guestbook=1" : "posts=1") +
      "&limit=" + CMT_PAGE + "&offset=" + offset;
    api("/api/admin/comments" + qs).then(function (d) {
      commentsState.loading = false;
      var items = d.items || [];
      commentsState.total = typeof d.total === "number"
        ? d.total
        : (replace ? items.length : commentsState.items.length + items.length);
      commentsState.items = replace ? items : commentsState.items.concat(items);
      paintComments(scope);
    }).catch(function (e) {
      commentsState.loading = false;
      if (replace) view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>';
      else toast(e.message);
    });
  }

  function renderComments(scope) {
    scope = scope === "guestbook" ? "guestbook" : "posts";
    if (commentsState.scope !== scope) {
      commentsState.scope = scope;
      commentsState.items = [];
      commentsState.total = 0;
    }
    commentsState.loading = false;
    loading();
    loadCommentsPage(scope, 0, true);
  }

  /* ---------- 资源 ---------- */

  function renderResources() {
    loading();
    api("/api/admin/resources").then(function (d) {
      var rows = d.items.map(function (r) {
        return '<tr>' +
          '<td><div class="t">' + esc(r.name) + '</div><div class="sub">' + esc(r.version || "") + ' · ' + esc(r.size || "未上传文件") + '</div></td>' +
          '<td style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-3)">' + r.downloads + '</td>' +
          '<td>' + (r.file ? '<span class="st-pill ok">可下载</span>' : '<span class="st-pill warn">待上传</span>') + '</td>' +
          '<td><div class="ops">' +
            '<button class="st-btn sm" data-act="res-edit" data-id="' + r.id + '">编辑</button>' +
            '<button class="st-btn sm danger" data-act="res-del" data-id="' + r.id + '">删除</button>' +
          '</div></td>' +
        '</tr>';
      }).join("");

      view.innerHTML =
        '<div class="st-head"><div><h1>资源</h1><p>可下载的脚本、模板与工具，上传后会出现在资源页</p></div>' +
          '<div class="st-actions"><button class="st-btn primary" data-act="res-new">新建资源</button></div></div>' +
        '<div class="st-card" style="padding:6px 14px">' +
          (d.items.length
            ? '<table class="st-table"><thead><tr><th>名称</th><th>下载</th><th>文件</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
            : '<div class="st-empty">还没有资源，点右上角新建</div>') +
        '</div>' +
        '<div id="res-editor"></div>';

      /* 深链：#resources/new 直接开空白表单，#resources/<id> 直接开编辑 */
      if (state.resOpenId) {
        var rid = state.resOpenId;
        state.resOpenId = null;
        if (rid === "new") {
          resourceForm(null);
        } else {
          var item = d.items.filter(function (x) { return String(x.id) === String(rid); })[0];
          if (item) resourceForm(item);
        }
      }
    }).catch(function (e) { view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>'; });
  }

  function resourceForm(item) {
    item = item || { name: "", version: "", size: "", lang: "", desc: "", file: "", icon: "FILE", tint: "purple", date: new Date().toISOString().slice(0, 10) };
    var box = document.getElementById("res-editor");
    if (!box) return;
    box.innerHTML =
      '<div class="st-card" style="margin-top:14px" id="res-form">' +
        '<h2>' + (item.id ? "编辑资源" : "新建资源") + '</h2>' +
        '<div class="st-row">' +
          '<div class="st-field"><label>名称</label><input class="st-input" id="r-name" value="' + esc(item.name) + '" placeholder="jvm-inspect"></div>' +
          '<div class="st-field"><label>版本</label><input class="st-input" id="r-version" value="' + esc(item.version) + '" placeholder="v1.0.0"></div>' +
        '</div>' +
        '<div class="st-row" style="margin-top:12px">' +
          '<div class="st-field"><label>语言 / 类型</label><input class="st-input" id="r-lang" value="' + esc(item.lang) + '" placeholder="Shell / Java"></div>' +
          '<div class="st-field"><label>图标文字</label><input class="st-input" id="r-icon" value="' + esc(item.icon) + '" placeholder="SH / JAR"></div>' +
        '</div>' +
        '<div class="st-field" style="margin-top:12px"><label>说明</label>' +
          '<textarea class="st-area" id="r-desc" rows="3" style="font-family:var(--font-sans);font-size:12.5px">' + esc(item.desc) + '</textarea></div>' +
        '<div class="st-field" style="margin-top:12px"><label>文件</label>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<input class="st-input" id="r-file" value="' + esc(item.file) + '" placeholder="/uploads/files/xxx.zip" style="flex:1;min-width:200px">' +
            '<button class="st-btn" data-act="res-upload" type="button">上传文件</button>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-3);margin-top:6px">上传后自动填好路径；文件大小由磁盘真实文件计算，不需要手填</div>' +
        '</div>' +
        '<div class="st-row" style="margin-top:14px;align-items:end">' +
          '<div class="st-field"><label>配色</label>' +
            '<select class="st-select" id="r-tint">' +
              ["purple", "teal", "amber", "rose", "gray"].map(function (t) {
                return '<option value="' + t + '"' + (item.tint === t ? " selected" : "") + '>' + t + '</option>';
              }).join("") +
            '</select></div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end">' +
            '<button class="st-btn" data-act="res-cancel" type="button">取消</button>' +
            '<button class="st-btn primary" data-act="res-save" data-id="' + (item.id || "") + '" type="button">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- 分类标签 ---------- */

  function renderTerms() {
    loading();
    api("/api/admin/terms").then(function (d) {
      state.terms = d;
      var block = function (title, kind, list, hint, ph) {
        var rows = list.length ? list.map(function (t) {
          return '<div class="st-list-row">' +
            '<span class="txt" style="color:var(--text)">' + esc(t.name) +
              (t.custom ? ' <span class="st-pill" style="margin-left:6px">自建 · 未使用</span>' : '') + '</span>' +
            '<span class="n">' + t.count + ' 篇</span>' +
            '<button class="st-btn sm" data-act="term-rename" data-kind="' + kind + '" data-name="' + esc(t.name) + '">改名</button>' +
            '<button class="st-btn sm danger" data-act="term-del" data-kind="' + kind + '" data-name="' + esc(t.name) + '">删除</button>' +
          '</div>';
        }).join("") : '<div class="st-empty">还没有' + title + '，在下面加一个吧</div>';

        return '<div class="st-card"><h2>' + title + '（' + list.length + '）</h2>' + rows +
          '<div class="term-add">' +
            '<input class="st-input term-new" id="term-new-' + kind + '" data-kind="' + kind + '" placeholder="' + esc(ph) + '" maxlength="30">' +
            '<button class="st-btn primary" data-act="term-add" data-kind="' + kind + '">添加</button>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-3);margin-top:10px">' + hint + '；新增项立刻出现在文章编辑器的候选里</div></div>';
      };

      view.innerHTML =
        '<div class="st-head"><div><h1>分类标签</h1><p>可以自己先建好分类和标签，写文章时直接选；改名会同步更新所有文章</p></div></div>' +
        '<div class="st-two">' +
          block("分类", "cat", d.cats, "分类是每篇文章一个，用来做筛选", "新分类名称，比如 数据库") +
          block("标签", "tag", d.tags, "标签可以有多个，用于交叉检索", "新标签名称，比如 JVM") +
        '</div>';

      view.querySelectorAll(".term-new").forEach(function (el) {
        el.addEventListener("keydown", function (e) {
          if (e.key !== "Enter") return;
          e.preventDefault();
          view.querySelector('[data-act="term-add"][data-kind="' + el.getAttribute("data-kind") + '"]').click();
        });
      });
    }).catch(function (e) { view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>'; });
  }

  /* ---------- 日记 ---------- */

  var diaryState = { books: [], bookId: "", editingEntry: null, pendingEntry: null };

  function renderDiary() {
    loading();
    api("/api/admin/diary").then(function (d) {
      diaryState.books = d.books || [];
      if (!diaryState.bookId || !diaryState.books.some(function (b) { return b.id === diaryState.bookId; })) {
        diaryState.bookId = diaryState.books.length ? diaryState.books[0].id : "";
      }
      paintDiary();
    }).catch(function (e) { view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>'; });
  }

  function paintDiary() {
    var book = diaryState.books.filter(function (b) { return b.id === diaryState.bookId; })[0];
    var chips = diaryState.books.map(function (b) {
      return '<button class="st-btn sm' + (b.id === diaryState.bookId ? " primary" : "") + '" data-act="d-book" data-id="' + esc(b.id) + '">' +
        esc(b.name) + " · " + (b.entries || []).length + '</button>';
    }).join(" ");

    if (!book) {
      view.innerHTML =
        '<div class="st-head"><div><h1>日记</h1><p>还没有日记本</p></div>' +
        '<div class="st-actions"><button class="st-btn primary" data-act="d-newbook">新建日记本</button></div></div>' +
        '<div class="st-card"><div class="st-empty">先建一个本子，比如「日常随记」</div></div>';
      return;
    }

    var rows = (book.entries || []).map(function (e) {
      return '<tr>' +
        '<td>' + (e.day ? '<span class="st-pill">第 ' + e.day + ' 天</span>' : '<span class="st-pill">—</span>') + '</td>' +
        '<td><div class="t">' + esc(e.title) + '</div><div class="sub">' + esc(e.date || "") + " · " + esc(catName(e.cat)) + '</div></td>' +
        '<td style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-3)">' + String(e.body || "").length + '</td>' +
        '<td><div class="ops">' +
          '<button class="st-btn sm" data-act="d-edit" data-id="' + esc(e.id) + '">编辑</button>' +
          '<button class="st-btn sm danger" data-act="d-del" data-id="' + esc(e.id) + '">删除</button>' +
        '</div></td>' +
      '</tr>';
    }).join("");

    view.innerHTML =
      '<div class="st-head"><div><h1>日记</h1><p>每本日记按时间倒序，前台按本子切换</p></div>' +
        '<div class="st-actions">' +
          '<button class="st-btn" data-act="d-newbook">新建日记本</button>' +
          '<button class="st-btn primary" data-act="d-newentry">写一篇</button>' +
        '</div></div>' +

      '<div class="st-toolbar">' + chips + '</div>' +

      '<div class="st-two">' +
        '<div class="st-card" style="padding:6px 14px">' +
          ((book.entries || []).length
            ? '<table class="st-table"><thead><tr><th>天数</th><th>条目</th><th>字数</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
            : '<div class="st-empty">这本还没有内容</div>') +
        '</div>' +

        '<div class="st-card">' +
          '<h2>本子信息</h2>' +
          '<div class="st-field" style="margin-bottom:10px"><label>名字</label><input class="st-input" id="d-name" value="' + esc(book.name) + '"></div>' +
          '<div class="st-field" style="margin-bottom:10px"><label>一句话说明</label><input class="st-input" id="d-desc" value="' + esc(book.desc || "") + '"></div>' +
          '<div class="st-row" style="margin-bottom:10px">' +
            '<div class="st-field"><label>配色</label><select class="st-select" id="d-accent">' +
              ["amber", "teal", "purple", "rose", "gray"].map(function (a) {
                return '<option value="' + a + '"' + (book.accent === a ? " selected" : "") + '>' + a + '</option>';
              }).join("") + '</select></div>' +
            '<div class="st-field"><label>条目数</label><input class="st-input" value="' + (book.entries || []).length + '" disabled></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;justify-content:space-between">' +
            '<button class="st-btn danger" data-act="d-delbook">删除这本</button>' +
            '<button class="st-btn primary" data-act="d-savebook">保存本子</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="d-entry-form"></div>';

    /* 深链带进来的条目：#diary/<bookId>/new 或 #diary/<bookId>/<entryId> */
    if (diaryState.pendingEntry) {
      var pid = diaryState.pendingEntry;
      diaryState.pendingEntry = null;
      if (pid === "new") {
        diaryState.editingEntry = null;
        entryForm(null);
      } else {
        var target = (book.entries || []).filter(function (e) { return String(e.id) === String(pid); })[0];
        if (target) { diaryState.editingEntry = target; entryForm(target); }
      }
    }
  }

  function catName(c) {
    return c === "tech" ? "技术" : c === "mind" ? "心态" : "日常";
  }

  function entryForm(entry) {
    var box = $("d-entry-form");
    if (!box) return;
    var e = entry || { day: "", date: new Date().toISOString().slice(0, 10), weekday: "", cat: "daily", title: "", body: "" };
    box.innerHTML =
      '<div class="st-card" style="margin-top:14px">' +
        '<h2>' + (entry ? "编辑条目" : "新条目") + '</h2>' +
        '<div class="st-row-3">' +
          '<div class="st-field"><label>日期</label><input class="st-input" id="e-date" type="date" value="' + esc(e.date || "") + '"></div>' +
          '<div class="st-field"><label>第几天（可空）</label><input class="st-input" id="e-day" type="number" min="1" value="' + esc(e.day == null ? "" : e.day) + '"></div>' +
          '<div class="st-field"><label>星期</label><input class="st-input" id="e-weekday" value="' + esc(e.weekday || "") + '" placeholder="周一"></div>' +
        '</div>' +
        '<div class="st-row" style="margin-top:12px">' +
          '<div class="st-field"><label>标题</label><input class="st-input" id="e-title" value="' + esc(e.title || "") + '"></div>' +
          '<div class="st-field"><label>分类</label><select class="st-select" id="e-cat">' +
            [["daily", "日常"], ["tech", "技术"], ["mind", "心态"]].map(function (c) {
              return '<option value="' + c[0] + '"' + (e.cat === c[0] ? " selected" : "") + '>' + c[1] + '</option>';
            }).join("") + '</select></div>' +
        '</div>' +
        '<div class="st-field" style="margin-top:12px"><label>正文</label>' +
          '<textarea class="st-area" id="e-body" rows="6" style="font-family:var(--font-sans);font-size:13px">' + esc(e.body || "") + '</textarea></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
          '<button class="st-btn" data-act="d-cancel">取消</button>' +
          '<button class="st-btn primary" data-act="d-saveentry" data-id="' + (entry ? esc(entry.id) : "") + '">保存</button>' +
        '</div>' +
      '</div>';
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- 相册：分组列表 → 进入分组 → 上传照片 两级管理 ---------- */
  var NONE = "__none__";
  var galleryState = { data: null, album: null };  // album: null=分组列表 | 分组名 | NONE=未分组

  function renderGalleryAdmin() {
    loading();
    api("/api/admin/gallery").then(function (d) {
      galleryState.data = d;
      if (!Array.isArray(d.albums)) d.albums = [];
      if (!Array.isArray(d.photos)) d.photos = [];
      // 分组被删掉时回到列表，避免停在一个已经不存在的分组里
      if (galleryState.album && galleryState.album !== NONE &&
          d.albums.indexOf(galleryState.album) < 0) galleryState.album = null;
      paintGallery();
    }).catch(function (e) { view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>'; });
  }

  /* 照片归属：正式分组名，或不属于任何分组的「未分组」 */
  function albumKey(photo) {
    var a = String(photo.album || "").trim();
    return a && galleryState.data.albums.indexOf(a) >= 0 ? a : NONE;
  }
  function albumName(key) { return key === NONE ? "未分组" : key; }
  function allIn(key) {
    return galleryState.data.photos.filter(function (photo) { return albumKey(photo) === key; });
  }
  function countIn(key) {
    return allIn(key).filter(function (photo) { return photo && photo.src; });
  }
  /* 把某个分组的照片列表写回全量数组，其他分组的照片顺序保持不变 */
  function commitPhotos(key, list) {
    var all = galleryState.data.photos, out = [], at = -1;
    all.forEach(function (photo) {
      if (albumKey(photo) === key) { if (at < 0) at = out.length; return; }
      out.push(photo);
    });
    if (at < 0) at = out.length;
    for (var i = 0; i < list.length; i++) out.splice(at + i, 0, list[i]);
    galleryState.data.photos = out;
  }
  /* 从 DOM 读回当前分组的照片（含还没上传的空行，保留编辑草稿） */
  function collectPhotos() {
    return Array.prototype.slice.call(view.querySelectorAll("[data-gi]")).map(function (r) {
      var get = function (sel) { var el = r.querySelector(sel); return el ? el.value.trim() : ""; };
      return {
        id: r.getAttribute("data-gid") || "",
        src: get(".ga-src"),
        title: get(".ga-title"),
        album: get(".ga-album"),
        date: get(".ga-date"),
        desc: get(".ga-desc"),
        pos: get(".ga-pos") || "center"
      };
    });
  }
  function syncPhotos() {
    var list = collectPhotos();
    commitPhotos(galleryState.album, list);
    return list;
  }
  function readMeta() {
    var t = $("ga-title"), n = $("ga-intro");
    if (t) galleryState.data.title = t.value.trim();
    if (n) galleryState.data.intro = n.value.trim();
  }
  function albumSelect(cur) {
    var opts = ['<option value=""' + (!cur ? " selected" : "") + '>未分组</option>'];
    galleryState.data.albums.forEach(function (a) {
      opts.push('<option value="' + esc(a) + '"' + (cur === a ? " selected" : "") + '>' + esc(a) + '</option>');
    });
    return '<select class="st-input ga-album">' + opts.join("") + '</select>';
  }
  function normalizeGallery(d) {
    galleryState.data = d;
    if (!Array.isArray(galleryState.data.albums)) galleryState.data.albums = [];
    if (!Array.isArray(galleryState.data.photos)) galleryState.data.photos = [];
    paintGallery();
  }
  /* 分组结构 / 相册信息的改动立即落盘；照片编辑走分组内的「保存」。
     这里不吞错误：失败要把 rejection 交给调用方，避免调用方在失败时也弹「已保存」。 */
  function saveGalleryStructure() {
    return api("/api/admin/gallery", { method: "PUT", body: galleryState.data })
      .then(normalizeGallery);
  }

  function paintGallery() {
    if (galleryState.album === null) return paintAlbumList();
    return paintAlbumPhotos();
  }

  /* 第一级：分组列表。这里看不到上传按钮，先选分组再进 */
  function paintAlbumList() {
    var d = galleryState.data;
    var cards = d.albums.map(function (a) {
      var list = countIn(a);
      var thumb = list.length
        ? '<img src="' + esc(assetUrl(list[0].src)) + '" alt="">'
        : '<span class="ga-album-blank">还没有照片</span>';
      return '<div class="ga-album-card">' +
        '<div class="ga-album-cover">' + thumb + '</div>' +
        '<div class="ga-album-info"><b>' + esc(a) + '</b><small>' + list.length + ' 张照片</small></div>' +
        '<div class="ga-album-ops">' +
          '<button class="st-btn sm primary" data-act="g-enter" data-album="' + esc(a) + '">进入上传</button>' +
          '<button class="st-btn sm" data-act="g-rename" data-album="' + esc(a) + '">改名</button>' +
          '<button class="st-btn sm danger" data-act="g-del-album" data-album="' + esc(a) + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join("");

    var none = countIn(NONE);
    var noneCard = '<div class="ga-album-card ga-album-none' + (none.length ? "" : " is-empty") + '">' +
      '<div class="ga-album-cover">' +
        (none.length ? '<img src="' + esc(assetUrl(none[0].src)) + '" alt="">' : '<span class="ga-album-blank">暂无散图</span>') +
      '</div>' +
      '<div class="ga-album-info"><b>未分组</b><small>' + none.length + ' 张 · 没选分组的照片都在这里</small></div>' +
      '<div class="ga-album-ops"><button class="st-btn sm" data-act="g-enter" data-album="' + NONE + '">进入查看</button></div>' +
    '</div>';

    view.innerHTML =
      '<div class="st-head"><div><h1>相册分组</h1><p>先选一个分组进去，再上传照片；分组会自动变成前台相册页的筛选按钮</p></div>' +
        '<div class="st-actions"><button class="st-btn primary" data-act="g-new-album">+ 新建分组</button></div></div>' +
      '<div class="st-card" style="margin-bottom:14px">' +
        '<div class="st-row">' +
          '<div class="st-field"><label>相册标题</label><input class="st-input" id="ga-title" value="' + esc(d.title || "") + '"></div>' +
          '<div class="st-field"><label>页面简介</label><input class="st-input" id="ga-intro" value="' + esc(d.intro || "") + '"></div>' +
        '</div>' +
        '<div class="st-actions" style="margin-top:12px"><button class="st-btn" data-act="g-save-meta">保存相册信息</button></div>' +
      '</div>' +
      '<div class="ga-albums">' + cards + noneCard + '</div>' +
      (d.albums.length ? "" : '<div class="st-empty" style="margin-top:12px">还没有分组，点右上角「新建分组」建一个，再进去传照片。</div>') +
      '<div class="st-card" style="margin-top:14px">' +
        '<div style="font-size:11.5px;color:var(--text-3);line-height:1.8">' +
          '新建 / 改名 / 删除分组会立即保存；删除分组不会删照片，组里的照片会自动移到「未分组」。<br>' +
          '进入分组后点缩略图上传或换图，「上移 / 下移」决定前台顺序，首页预览取全部照片的前 3 张。' +
        '</div>' +
      '</div>';
  }

  /* 第二级：某个分组内的照片，上传入口只在这里出现 */
  function paintAlbumPhotos() {
    var key = galleryState.album;
    var name = albumName(key);
    var curAlbum = key === NONE ? "" : key;
    var list = allIn(key);
    var rows = list.map(function (photo, i) {
      var thumb = photo.src
        ? '<img src="' + esc(assetUrl(photo.src)) + '" alt="">'
        : '<span class="ga-none">未上传</span>';
      return '<div class="st-card ga-row" data-gi="' + i + '" data-gid="' + esc(photo.id || "") + '" style="margin-bottom:12px">' +
        '<div class="ga-body">' +
          '<div class="ga-thumb" data-act="g-upload" data-i="' + i + '" title="点击上传 / 换图">' + thumb +
            '<span class="ga-thumb-tip">换图</span></div>' +
          '<div class="ga-fields">' +
            '<div class="st-row-3">' +
              '<div class="st-field"><label>标题</label><input class="st-input ga-title" value="' + esc(photo.title) + '" placeholder="照片标题"></div>' +
              '<div class="st-field"><label>所属分组</label>' + albumSelect(photo.album || curAlbum) + '</div>' +
              '<div class="st-field"><label>日期</label><input class="st-input ga-date" value="' + esc(photo.date) + '" placeholder="2026-10-18"></div>' +
            '</div>' +
            '<div class="st-row" style="margin-top:10px">' +
              '<div class="st-field"><label>一句话说明</label><input class="st-input ga-desc" value="' + esc(photo.desc) + '" placeholder="灯箱里显示"></div>' +
              '<div class="st-field" style="max-width:160px"><label>裁切位置</label><input class="st-input ga-pos" value="' + esc(photo.pos || "center") + '" placeholder="center"></div>' +
            '</div>' +
            '<div class="st-field" style="margin-top:10px"><label>图片地址</label><input class="st-input ga-src" value="' + esc(photo.src) + '" placeholder="/uploads/images/xxx.jpg"></div>' +
          '</div>' +
          '<div class="ga-ops">' +
            '<button class="st-btn sm" data-act="g-up" data-i="' + i + '" title="上移">↑</button>' +
            '<button class="st-btn sm" data-act="g-down" data-i="' + i + '" title="下移">↓</button>' +
            '<button class="st-btn sm danger" data-act="g-del" data-i="' + i + '" title="删除">删除</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join("");

    view.innerHTML =
      '<div class="st-head"><div>' +
        '<div class="ga-crumb"><button class="st-btn ghost sm" data-act="g-back">← 全部分组</button><span>/</span><b>' + esc(name) + '</b></div>' +
        '<h1 style="margin-top:8px">' + esc(name) + '</h1>' +
        '<p>这个分组里共 ' + list.length + ' 张照片，新上传的会自动归到「' + esc(name) + '」</p></div>' +
        '<div class="st-actions">' +
          '<button class="st-btn" data-act="g-batch" title="一次选多张照片，自动归到当前分组">批量上传</button>' +
          '<button class="st-btn" data-act="g-add">加一张</button>' +
          '<button class="st-btn primary" data-act="g-save">保存</button>' +
        '</div></div>' +
      (rows || '<div class="st-empty">这个分组还没有照片，点「批量上传」一次选几张，或「加一张」逐条填。</div>') +
      '<div class="st-card" style="margin-top:14px">' +
        '<div style="font-size:11.5px;color:var(--text-3);line-height:1.8">' +
          '「批量上传」可以一次选多张，标题先用文件名，传完再逐条改；点缩略图换单张图；「所属分组」可以把照片移到别的分组；改完记得点「保存」，前台会自动刷新。' +
        '</div>' +
      '</div>';
  }

  var notesState = { data: null, tab: "cheatsheets" };
  var NOTE_LABEL = { cheatsheets: "速查分组", links: "收藏链接" };

  function renderNotes() {
    loading();
    api("/api/admin/notes").then(function (d) {
      notesState.data = d;
      paintNotes();
    }).catch(function (e) { view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>'; });
  }

  /* 每条内容一张独立卡片：序号 + 删除按钮 + 自己的字段，不与相邻条目混排 */
  function noteCard(i, label, inner) {
    return '<div class="st-card st-note-card" data-g="' + i + '">' +
      '<div class="st-note-bar">' +
        '<span class="st-note-no">' + esc(label) + ' · ' + ("0" + (i + 1)).slice(-2) + '</span>' +
        '<button class="st-btn sm danger" data-act="n-del" data-i="' + i + '">删除</button>' +
      '</div>' + inner +
    '</div>';
  }

  function noteFields(tab, x) {
    if (tab === "cheatsheets") {
      return '<div class="st-field"><label>分组标题</label>' +
          '<input class="st-input nf-title" value="' + esc(x.title || "") + '" placeholder="分组标题" style="max-width:320px"></div>' +
        '<div class="st-field" style="margin-top:12px"><label>条目（一行一条，可用 &lt;code&gt;）</label>' +
          '<textarea class="st-area nf-items" rows="6" style="font-family:var(--font-mono);font-size:12px">' + esc((x.items || []).join("\n")) + '</textarea></div>';
    }
    return '<div class="st-row-3 st-note-fields">' +
      '<div class="st-field"><label>缩写</label><input class="st-input nf-a" value="' + esc(x.abbr || "") + '"></div>' +
      '<div class="st-field"><label>标题</label><input class="st-input nf-b" value="' + esc(x.title || "") + '"></div>' +
      '<div class="st-field"><label>配色</label><select class="st-select nf-tint">' + tintOptions(x.tint) + '</select></div>' +
      '<div class="st-field" style="grid-column:span 2"><label>说明</label><input class="st-input nf-c" value="' + esc(x.desc || "") + '"></div>' +
      '<div class="st-field"><label>链接</label><input class="st-input nf-d" value="' + esc(x.url || "") + '"></div>' +
    '</div>';
  }

  function paintNotes() {
    var d = notesState.data;
    var tabs = [["cheatsheets", "速查"], ["links", "链接"]];
    var tab = notesState.tab;
    var list = d[tab] || [];
    var label = NOTE_LABEL[tab] || "条目";
    var body = list.length
      ? list.map(function (x, i) { return noteCard(i, label, noteFields(tab, x)); }).join("")
      : '<div class="st-card st-empty" style="padding:34px 20px">这一组还没有内容，点右上角「加一条」新增。</div>';

    view.innerHTML =
      '<div class="st-head"><div><h1>笔记库</h1>' +
        '<p>速查、链接逐条独立编辑 · 删除立即入库，其余改动点「保存」</p></div>' +
        '<div class="st-actions">' +
          '<button class="st-btn" data-act="n-add">加一条</button>' +
          '<button class="st-btn primary" data-act="n-save">保存</button>' +
        '</div></div>' +
      '<div class="st-toolbar"><div class="st-seg">' +
        tabs.map(function (t) {
          return '<button data-ntab="' + t[0] + '" class="' + (tab === t[0] ? "on" : "") + '">' + t[1] + '</button>';
        }).join("") +
      '</div><span class="st-note-count">共 ' + list.length + ' 条</span></div>' + body;

    view.querySelectorAll("[data-ntab]").forEach(function (b) {
      b.addEventListener("click", function () {
        collectNotes();
        notesState.tab = b.getAttribute("data-ntab");
        paintNotes();
      });
    });
  }

  function tintOptions(cur) {
    return ["purple", "teal", "amber", "rose", "gray"].map(function (t) {
      return '<option value="' + t + '"' + (cur === t ? " selected" : "") + '>' + t + '</option>';
    }).join("");
  }

  function collectNotes() {
    var d = notesState.data;
    var tab = notesState.tab;
    var rows = Array.prototype.slice.call(view.querySelectorAll("[data-g]"));

    if (tab === "cheatsheets") {
      d[tab] = rows.map(function (r) {
        return {
          title: r.querySelector(".nf-title").value.trim(),
          items: r.querySelector(".nf-items").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean)
        };
      });
    } else {
      d[tab] = rows.map(function (r) {
        var get = function (sel) { var el = r.querySelector(sel); return el ? el.value.trim() : ""; };
        var tintEl = r.querySelector(".nf-tint");
        return {
          abbr: get(".nf-a"), title: get(".nf-b"), desc: get(".nf-c"),
          url: get(".nf-d"), tint: tintEl ? tintEl.value : "purple"
        };
      });
    }
    return d;
  }

  /* ---------- 账号 ---------- */

  function renderUsers() {
    loading();
    api("/api/admin/users").then(function (d) {
      state.users = d.items || [];
      var rows = d.items.map(function (u) {
        return '<tr>' +
          '<td><div class="t">' + esc(u.name) + '</div><div class="sub">' + esc((u.created_at || "").slice(0, 10)) + '</div></td>' +
          '<td>' + (u.role === "admin"
            ? '<span class="st-pill ok">管理员</span>'
            : '<span class="st-pill">访客 · 只能留言</span>') + '</td>' +
          '<td><div class="ops">' +
            '<button class="st-btn sm" data-act="u-pass" data-name="' + esc(u.name) + '">改密码</button>' +
            (u.role === "admin" ? "" : '<button class="st-btn sm danger" data-act="u-del" data-name="' + esc(u.name) + '">删除</button>') +
          '</div></td>' +
        '</tr>';
      }).join("");

      view.innerHTML =
        '<div class="st-head"><div><h1>账号</h1><p>管理员能改所有内容；访客账号不能进入管理台</p></div></div>' +

        '<div class="st-card" style="padding:6px 14px">' +
          '<table class="st-table"><thead><tr><th>账号</th><th>权限</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '</div>' +

        '<div class="st-card" style="margin-top:14px">' +
          '<h2>新建访客账号</h2>' +
          '<div class="st-row">' +
            '<div class="st-field"><label>账号</label><input class="st-input" id="u-name" placeholder="比如 zhangsan"></div>' +
            '<div class="st-field"><label>初始密码</label><input class="st-input" id="u-pass" placeholder="至少 6 位"></div>' +
          '</div>' +
          '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
            '<button class="st-btn primary" data-act="u-add">创建</button></div>' +
          '<div style="font-size:11.5px;color:var(--text-3);margin-top:12px;line-height:1.7">' +
            '留言与评论现在无需登录。访客账号权限受限、不能进入管理台，目前没有前台使用场景，可不创建。' +
          '</div>' +
        '</div>';
    }).catch(function (e) { view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>'; });
  }

  /* ---------- 设置 ---------- */

  function renderSettings() {
    loading();
    Promise.all([api("/api/admin/settings"), api("/api/admin/terms")]).then(function (res) {
      var s = res[0];
      state.site = s.site || {};
      state.terms = res[1];
      var site = state.site;

      view.innerHTML =
        '<div class="st-head"><div><h1>设置</h1><p>站点信息会同步到前台首页与页脚</p></div></div>' +

        '<div class="st-two">' +
          '<div class="st-card">' +
            '<h2>站点信息</h2>' +
            '<div class="st-row"><div class="st-field"><label>名字</label><input class="st-input" id="s-name" value="' + esc(site.name || "") + '"></div>' +
              '<div class="st-field"><label>副标题</label><input class="st-input" id="s-title" value="' + esc(site.title || "") + '"></div></div>' +
            '<div class="st-field" style="margin-top:12px"><label>简介（支持 &lt;em&gt;）</label>' +
              '<textarea class="st-area" id="s-bio" rows="4" style="font-family:var(--font-sans);font-size:12.5px">' + esc(site.bio || "") + '</textarea></div>' +
            '<div class="st-field" style="margin-top:12px"><label>头像</label>' +
              '<div style="display:flex;align-items:center;gap:12px">' +
                (site.avatar
                  ? '<img src="' + esc(assetUrl(site.avatar)) + '" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent)">'
                  : '<span style="width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-family:var(--font-mono);font-weight:700;font-size:20px;background:linear-gradient(145deg,var(--accent),var(--accent-hover));color:#fff">' +
                    esc((site.name || "K").trim().slice(0, 1).toUpperCase()) + '</span>') +
                '<button class="st-btn" data-act="av-upload">上传图片</button>' +
                '<button class="st-btn" data-act="av-clear">用名字首字母</button>' +
              '</div>' +
              '<div style="font-size:11px;color:var(--text-3);margin-top:6px;line-height:1.6">保存后立即同步到前台首页，前台不再提供就地换头像。</div>' +
            '</div>' +
            '<div class="st-field" style="margin-top:12px"><label>标签（逗号分隔）</label>' +
              '<input class="st-input" id="s-tags" value="' + esc((site.tags || []).join(", ")) + '"></div>' +
            '<div class="st-row" style="margin-top:12px">' +
              '<div class="st-field"><label>所在地</label><input class="st-input" id="s-location" value="' + esc(site.location || "") + '"></div>' +
              '<div class="st-field"><label>开站时间</label><input class="st-input" id="s-started" value="' + esc(site.started || "") + '" placeholder="2024-09"></div>' +
            '</div>' +
            '<div class="st-row" style="margin-top:12px">' +
              '<div class="st-field"><label>最近更新（自动）</label>' +
                '<input class="st-input" id="s-updated" value="' + esc(site.updated || "尚未记录") + '" readonly>' +
                '<div style="font-size:11px;color:var(--text-3);line-height:1.6">每次在后台改动内容后自动刷新，不需要手填</div></div>' +
              '<div class="st-field"><label>联系邮箱</label><input class="st-input" id="s-email" value="' + esc(site.email || "") + '"></div>' +
            '</div>' +
            '<div class="st-field" style="margin-top:12px"><label>GitHub 用户名 / 主页</label>' +
              '<input class="st-input" id="s-github" value="' + esc(site.github || "") + '" placeholder="例如 octocat 或 https://github.com/octocat">' +
              '<div class="gh-hint" id="s-gh-hint"></div>' +
              '<div style="font-size:11px;color:var(--text-3);line-height:1.6;margin-top:6px">只填用户名即可（也支持 @名字 或主页地址）。保存后同时用于页脚 GitHub 链接与首页开源项目自动统计；不要填某个仓库的地址。</div>' +
            '</div>' +
            '<div class="st-row" style="margin-top:12px">' +
              '<div class="st-field"><label>开源项目（自动）</label>' +
                '<div class="st-gh-preview" id="s-gh-preview">读取中…</div>' +
                '<div style="font-size:11px;color:var(--text-3);line-height:1.6">保存后点「重新读取」立即刷新；前台每 30 分钟自动同步一次公开仓库数量与名称，fork 别人的仓库不计入。</div>' +
                '<button class="st-btn sm" data-act="gh-refresh" style="margin-top:8px">重新读取</button></div>' +
              '<div class="st-field"><label>页脚说明</label><input class="st-input" id="s-footer" value="' + esc(site.footerNote || "") + '"></div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-3);margin-top:10px;line-height:1.7">累计访问由后端埋点自动统计，最近更新由后台改动自动记录，开源项目数量与名称根据 GitHub 用户名自动读取，都无需手填。</div>' +
            '<div style="display:flex;justify-content:flex-end;margin-top:16px">' +
              '<button class="st-btn primary" data-act="save-site">保存站点信息</button></div>' +
          '</div>' +

          '<div>' +
            '<div class="st-card">' +
              '<h2>账号</h2>' +
              '<div class="st-row">' +
                '<div class="st-field"><label>原密码</label><input class="st-input" id="p-old" type="password"></div>' +
                '<div class="st-field"><label>新密码</label><input class="st-input" id="p-new" type="password"></div>' +
              '</div>' +
              '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
                '<button class="st-btn" data-act="save-password">修改密码</button></div>' +
            '</div>' +

            '<div class="st-card" style="margin-top:14px">' +
              '<h2>数据</h2>' +
              '<div style="font-size:11.5px;color:var(--text-3);line-height:1.8;margin-bottom:12px">' +
                '所有内容存在本机 MySQL 的 kimon_blog 库；图片和文件在 uploads/。' +
                '换机器时拷走整个目录，并定期用下面的按钮导出 JSON 备份。' +
              '</div>' +
              '<div style="display:flex;gap:8px">' +
                '<a class="st-btn" href="' + API + '/api/admin/export" target="_blank">导出 JSON 备份</a>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      loadGithubPreview();
      paintGithubHint();
    }).catch(function (e) { view.innerHTML = '<div class="st-empty">' + esc(e.message) + '</div>'; });
  }

  /* 与后端 GithubService.normalize() 保持同一套识别规则：
     用户名 / @用户名 / 主页地址 / 仓库地址，统一取第一段路径当用户名。 */
  function githubUser(raw) {
    var s = String(raw || "").trim().replace(/^@+/, "");
    if (!s) return "";
    if (s.slice(0, 11).toLowerCase() === "github.com/") s = "https://" + s;
    if (/^https?:\/\//i.test(s)) {
      try { s = new URL(s).pathname; } catch (e) { return ""; }
    }
    s = s.replace(/^\/+/, "").split("/")[0].split("?")[0].split("#")[0].trim();
    if (!s || s.length > 39 || !/^[A-Za-z0-9-]+$/.test(s) || /^-|-$/.test(s)) return "";
    return s;
  }

  function paintGithubHint() {
    var el = $("s-gh-hint"), input = $("s-github");
    if (!el || !input) return;
    var raw = input.value.trim(), user = githubUser(raw);
    if (!raw) {
      el.className = "gh-hint";
      el.textContent = "留空时首页不显示开源项目区块。";
    } else if (!user) {
      el.className = "gh-hint bad";
      el.textContent = "识别不了，请只填用户名，或 https://github.com/用户名";
    } else {
      el.className = "gh-hint ok";
      el.innerHTML = '将识别为 <b>' + esc(user) + '</b> · <a href="https://github.com/' +
        esc(user) + '" target="_blank" rel="noopener">打开主页检查</a>';
    }
  }

  /* GitHub 公开仓库预览：只在这里读，不参与保存 */
  function loadGithubPreview(force) {
    var box = $("s-gh-preview");
    if (!box) return;
    box.textContent = force ? "正在重新读取…" : "读取中…";
    var path = force ? "/api/admin/github/refresh" : "/api/github";
    api(path, { method: force ? "POST" : "GET" }).then(function (d) {
      var el = $("s-gh-preview");
      if (!el) return;
      if (!d || !d.ok) { el.textContent = (d && d.message) || "暂时读不到 GitHub"; return; }
      var names = (d.repos || []).slice(0, 4).map(function (r) { return r.name; }).join("、");
      el.innerHTML = '<b>' + esc(d.count) + '</b> 个公开仓库' +
        (names ? '<span>' + esc(names) + ((d.repos || []).length > 4 ? " …" : "") + '</span>' : '');
      if (force) toast("已重新读取 GitHub");
    }).catch(function (e) {
      var el = $("s-gh-preview");
      if (el) el.textContent = e.message || "暂时读不到 GitHub";
    });
  }

  /* ---------- 事件委托 ---------- */

  /* 会写数据库的动作：点击后立即锁住按钮，请求 / 确认框结束再解锁 */
  var WRITE_ACTS = {
    "publish": 1, "unpublish": 1, "del-post": 1,
    "cover-upload": 1, "cover-clear": 1,
    "c-del": 1,
    "res-del": 1, "res-upload": 1, "res-save": 1,
    "d-newbook": 1, "d-savebook": 1, "d-delbook": 1, "d-saveentry": 1, "d-del": 1,
    "g-new-album": 1, "g-rename": 1, "g-del-album": 1, "g-save-meta": 1, "g-upload": 1, "g-save": 1,
    "n-del": 1, "n-save": 1,
    "u-add": 1, "u-pass": 1, "u-del": 1,
    "term-add": 1, "term-rename": 1, "term-del": 1,
    "save-site": 1, "av-upload": 1, "av-clear": 1, "save-password": 1
  };

  /* 这些视图里的表单改动记为「未保存」，切视图 / 关页面前要提示 */
  var DIRTY_VIEWS = { editor: 1, settings: 1, diary: 1, gallery: 1, notes: 1, resources: 1 };

  view.addEventListener("input", function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === "s-github") paintGithubHint();
    if (DIRTY_VIEWS[state.view] && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) markDirty();
  });

  /* 下拉框 / 复选框部分浏览器只发 change */
  view.addEventListener("change", function (e) {
    var t = e.target;
    if (t && DIRTY_VIEWS[state.view] && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) markDirty();
  });

  /* 关页 / 刷新前的未保存提示 */
  window.addEventListener("beforeunload", function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
    return "";
  });

  /* 编辑器里任何输入框获得焦点时 Ctrl/⌘+S 都能保存（正文 textarea 里也有一份处理） */
  document.addEventListener("keydown", function (e) {
    if (state.view !== "editor" || !state.user) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if ((e.key || "").toLowerCase() !== "s") return;
    e.preventDefault();
    savePost(currentSaveStatus());
  });

  view.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    var id = btn.getAttribute("data-id");

    if (WRITE_ACTS[act]) {
      if (btn._actLock) return;   /* 上一次操作还没结束，拒绝重复提交 */
      lockActionButton(btn);
      /* 前端校验直接返回、又没有弹窗时，尽快把按钮解锁 */
      setTimeout(function () {
        if (!writePending && !document.querySelector(".kd-backdrop")) releaseAllActions();
      }, 300);
    }

    if (act === "refresh") return renderOverview();
    if (act === "new-post") { state.editing = null; return go("editor"); }
    if (act === "back") { state.editing = null; return go("posts"); }
    if (act === "save-draft") return savePost("draft");
    if (act === "save-publish") return savePost("published");

    if (act === "edit") {
      api("/api/admin/posts/" + encodeURIComponent(id)).then(function (r) {
        state.editing = r.item;
        go("editor");
      }).catch(function (err) { toast(err.message); });
      return;
    }

    if (act === "publish" || act === "unpublish") {
      api("/api/admin/posts/" + encodeURIComponent(id)).then(function (r) {
        var item = r.item;
        item.status = act === "publish" ? "published" : "draft";
        return api("/api/admin/posts/" + encodeURIComponent(id), { method: "PUT", body: item });
      }).then(function () {
        toast(act === "publish" ? "已发布" : "已转为草稿");
        renderPosts();
      }).catch(function (err) { toast(err.message); });
      return;
    }

    if (act === "del-post") {
      UI.confirm("删除后不可恢复，确定？", { title: "删除文章", danger: true, okText: "删除" }).then(function (yes) {
        if (!yes) return;
        api("/api/admin/posts/" + encodeURIComponent(id), { method: "DELETE" }).then(function () {
          toast("已删除");
          renderPosts();
        }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "cover-upload") {
      pickFile("image", function (file) {
        uploadFile(file, "image", btn).then(function (r) {
          var drop = $("cover-drop");
          drop.querySelector("img") && drop.querySelector("img").remove();
          var img = document.createElement("img");
          img.src = assetUrl(r.url);
          drop.insertBefore(img, drop.firstChild);
          markDirty();
          toast("封面已上传，记得保存");
        }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "cover-clear") {
      var drop2 = $("cover-drop");
      var img2 = drop2.querySelector("img");
      if (img2) img2.remove();
      markDirty();
      toast("已移除封面，记得保存");
      return;
    }

    if (act === "preview") {
      var ta = $("ed-body");
      var win = window.open("", "_blank");
      if (!win) return;
      var rendered = (window.KIMON && KIMON.mdToHtml)
        ? KIMON.mdToHtml(ta.value)
        : "<p>" + esc(ta.value) + "</p>";
      /* studio.html 不加载 remote.js，预览统一用本文件解析出的 API 基址 */
      var apiBase = API;
      if (apiBase) {
        rendered = rendered.replace(/src="(\/[^"]+)"/g, 'src="' + apiBase + '$1"');
      }
      win.document.write('<!DOCTYPE html><meta charset="utf-8"><title>预览</title>' +
        '<style>body{max-width:720px;margin:40px auto;padding:0 20px;font:16px/1.9 system-ui,sans-serif;color:#1a1a1a}' +
        'img{max-width:100%;border-radius:8px}figure{margin:20px 0}figcaption{font-size:13px;color:#777;text-align:center}' +
        'pre{background:#f4f4f6;padding:14px;border-radius:8px;overflow:auto}code{font-family:monospace;font-size:13px}' +
        'blockquote{border-left:3px solid #4B45B8;margin:16px 0;padding:4px 16px;color:#555}' +
        'table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 10px}' +
        'hr{border:0;border-top:1px solid #ddd}</style>' +
        '<h1>' + esc(($("ed-title") || {}).value || "") + "</h1>" + rendered);
      win.document.close();
      return;
    }

    if (act === "cmt-more") {
      loadCommentsPage(view._scope === "guestbook" ? "guestbook" : "posts", commentsState.items.length, false);
      return;
    }

    if (act === "c-del") {
      UI.confirm("删除这条留言？", { title: "删除留言", danger: true, okText: "删除" }).then(function (yes) {
        if (!yes) return;
        api("/api/admin/comments/" + id, { method: "DELETE" })
          .then(function () { renderComments(view._scope === "guestbook" ? "guestbook" : "posts"); })
          .catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "res-new") return resourceForm(null);    if (act === "res-cancel") { var box = $("res-editor"); if (box) box.innerHTML = ""; return; }
    if (act === "res-edit") {
      api("/api/admin/resources").then(function (d) {
        var item = d.items.filter(function (x) { return String(x.id) === String(id); })[0];
        resourceForm(item);
      });
      return;
    }
    if (act === "res-del") {
      UI.confirm("删除这个资源？文件本身会留在磁盘上。", { title: "删除资源", danger: true, okText: "删除" }).then(function (yes) {
        if (!yes) return;
        api("/api/admin/resources/" + id, { method: "DELETE" })
          .then(function () { toast("已删除"); renderResources(); })
          .catch(function (err) { toast(err.message); });
      });
      return;
    }
    if (act === "res-upload") {
      pickFile("file", function (file) {
        uploadFile(file, "file", btn).then(function (r) {
          $("r-file").value = r.url;
          markDirty();
          toast("文件已上传：" + r.size + "（大小由文件自动计算）");
        }).catch(function (err) { toast(err.message); });
      });
      return;
    }
    if (act === "res-save") {
      var payload = {
        name: $("r-name").value,
        version: $("r-version").value,
        lang: $("r-lang").value,
        icon: $("r-icon").value || "FILE",
        desc: $("r-desc").value,
        file: $("r-file").value,
        tint: $("r-tint").value,
        size: ""
      };
      var req = id
        ? api("/api/admin/resources/" + id, { method: "PUT", body: payload })
        : api("/api/admin/resources", { method: "POST", body: payload });
      req.then(function () { clearDirty(); toast("已保存"); renderResources(); }).catch(function (err) { toast(err.message); });
      return;
    }

    /* ---------- 日记 ---------- */
    if (act === "d-book") {
      diaryState.bookId = id;
      diaryState.editingEntry = null;
      paintDiary();
      return;
    }

    if (act === "d-newbook") {
      UI.prompt("新日记本叫什么？", "日常随记", { title: "新建日记本", placeholder: "比如：日常随记" }).then(function (bname) {
        if (!bname) return;
        api("/api/admin/diary/books", { method: "POST", body: { name: bname, desc: "", accent: "teal" } })
          .then(function (r) {
            diaryState.bookId = r.id;
            toast("已创建");
            renderDiary();
          }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "d-savebook") {
      api("/api/admin/diary/books/" + encodeURIComponent(diaryState.bookId), {
        method: "PUT",
        body: {
          name: $("d-name").value,
          desc: $("d-desc").value,
          accent: $("d-accent").value
        }
      }).then(function () { clearDirty(); toast("已保存"); renderDiary(); }).catch(function (err) { toast(err.message); });
      return;
    }

    if (act === "d-delbook") {
      UI.confirm("删除这本日记？里面的条目也会一起删掉。", { title: "删除日记本", danger: true, okText: "删除" }).then(function (yes) {
        if (!yes) return;
        api("/api/admin/diary/books/" + encodeURIComponent(diaryState.bookId), { method: "DELETE" })
          .then(function () {
            diaryState.bookId = "";
            toast("已删除");
            renderDiary();
          }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "d-newentry") { diaryState.editingEntry = null; return entryForm(null); }
    if (act === "d-cancel") { var f = $("d-entry-form"); if (f) f.innerHTML = ""; return; }

    if (act === "d-edit") {
      var book = diaryState.books.filter(function (b) { return b.id === diaryState.bookId; })[0];
      var entry = (book.entries || []).filter(function (e) { return String(e.id) === String(id); })[0];
      diaryState.editingEntry = entry;
      entryForm(entry);
      return;
    }

    if (act === "d-saveentry") {
      var payload = {
        bookId: diaryState.bookId,
        date: $("e-date").value,
        day: $("e-day").value === "" ? null : Number($("e-day").value),
        weekday: $("e-weekday").value,
        cat: $("e-cat").value,
        title: $("e-title").value,
        body: $("e-body").value
      };
      if (!payload.title.trim()) { toast("标题不能为空"); return; }
      var reqEntry = id
        ? api("/api/admin/diary/entries/" + encodeURIComponent(id), { method: "PUT", body: payload })
        : api("/api/admin/diary/entries", { method: "POST", body: payload });
      reqEntry.then(function () {
        clearDirty();
        toast("已保存");
        diaryState.editingEntry = null;
        renderDiary();
      }).catch(function (err) { toast(err.message); });
      return;
    }

    if (act === "d-del") {
      UI.confirm("删除这条日记？", { title: "删除条目", danger: true, okText: "删除" }).then(function (yes) {
        if (!yes) return;
        api("/api/admin/diary/entries/" + encodeURIComponent(id), { method: "DELETE" })
          .then(function () { toast("已删除"); renderDiary(); })
          .catch(function (err) { toast(err.message); });
      });
      return;
    }

    /* ---------- 相册：分组管理 + 分组内上传 ---------- */
    if (act === "g-new-album") {
      readMeta();
      UI.prompt("新分组叫什么？", "", { title: "新建相册分组", placeholder: "例如：毕业旅行" }).then(function (name) {
        if (!name) return;
        name = String(name).trim();
        if (name === "未分组" || galleryState.data.albums.indexOf(name) >= 0) { toast("分组名重复了"); return; }
        galleryState.data.albums.push(name);
        saveGalleryStructure().then(function () {
          clearDirty();
          toast("分组已建立，点「进入上传」开始传图");
        }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "g-rename") {
      var oldName = btn.getAttribute("data-album");
      readMeta();
      UI.prompt("改成什么名字？", oldName, { title: "重命名分组", placeholder: "分组名" }).then(function (name) {
        if (!name || name === oldName) return;
        name = String(name).trim();
        if (name === "未分组" || galleryState.data.albums.indexOf(name) >= 0) { toast("分组名重复了"); return; }
        var at = galleryState.data.albums.indexOf(oldName);
        if (at < 0) return;
        galleryState.data.albums[at] = name;
        galleryState.data.photos.forEach(function (photo) { if (photo.album === oldName) photo.album = name; });
        if (galleryState.album === oldName) galleryState.album = name;
        saveGalleryStructure().then(function () {
          clearDirty();
          toast("已改名，照片也归到新分组了");
        }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "g-del-album") {
      var delName = btn.getAttribute("data-album");
      var belong = countIn(delName).length;
      UI.confirm("删除分组「" + delName + "」？里面的 " + belong + " 张照片不会删，会自动移到「未分组」。",
        { title: "删除分组", danger: true, okText: "删除分组" }).then(function (yes) {
        if (!yes) return;
        readMeta();
        galleryState.data.albums = galleryState.data.albums.filter(function (a) { return a !== delName; });
        galleryState.data.photos.forEach(function (photo) { if (photo.album === delName) photo.album = ""; });
        if (galleryState.album === delName) galleryState.album = null;
        saveGalleryStructure().then(function () {
          clearDirty();
          toast("已删除分组，照片已移到未分组");
        }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "g-enter") {
      var target = btn.getAttribute("data-album");
      readMeta();
      galleryState.album = target === NONE ? NONE : target;
      paintGallery();
      return;
    }

    if (act === "g-back") {
      syncPhotos();   // 把编辑中的照片留在内存里，回到列表再进来还在（落盘仍需点保存）
      galleryState.album = null;
      paintGallery();
      return;
    }

    if (act === "g-save-meta") {
      readMeta();
      saveGalleryStructure().then(function () {
        clearDirty();
        toast("相册信息已保存");
      }).catch(function (err) { toast(err.message); });
      return;
    }

    if (act === "g-batch") {
      if (batchBusy) { toast("上一批还在传，等它跑完"); return; }
      var batchAlbum = galleryState.album === NONE ? "" : galleryState.album;
      pickFiles("image", function (files) {
        batchUploadPhotos(files, batchAlbum, btn);
      });
      return;
    }

    if (act === "g-add") {
      var gList = syncPhotos();
      gList.push({ id: "", src: "", title: "", desc: "", album: galleryState.album === NONE ? "" : galleryState.album, date: "", pos: "center" });
      commitPhotos(galleryState.album, gList);
      markDirty();
      paintGallery();
      return;
    }

    if (act === "g-del") {
      var gDel = Number(btn.getAttribute("data-i"));
      var gList2 = syncPhotos();
      gList2.splice(gDel, 1);
      commitPhotos(galleryState.album, gList2);
      markDirty();
      paintGallery();
      return;
    }

    if (act === "g-up" || act === "g-down") {
      var gFrom = Number(btn.getAttribute("data-i"));
      var gList3 = syncPhotos();
      var gTo = act === "g-up" ? gFrom - 1 : gFrom + 1;
      if (gTo >= 0 && gTo < gList3.length) {
        var gTmp = gList3[gFrom]; gList3[gFrom] = gList3[gTo]; gList3[gTo] = gTmp;
        markDirty();
      }
      commitPhotos(galleryState.album, gList3);
      paintGallery();
      return;
    }

    if (act === "g-upload") {
      var gUp = Number(btn.getAttribute("data-i"));
      pickFile("image", function (file) {
        uploadFile(file, "image", btn).then(function (r) {
          var row = view.querySelector('[data-gi="' + gUp + '"]');
          if (!row) return;
          row.querySelector(".ga-src").value = r.url;
          row.querySelector(".ga-thumb").innerHTML =
            '<img src="' + esc(assetUrl(r.url)) + '" alt=""><span class="ga-thumb-tip">换图</span>';
          markDirty();
          toast("图片已上传，记得保存");
        }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    /* 批量上传：串行跑（uploadFile 有全局单飞保护，并发会被直接拒），
       每张成功就进当前分组末尾，全部结束后统一重绘一次，避免列表在眼前反复跳动。 */
    function batchUploadPhotos(files, album, btn) {
      syncPhotos();
      batchBusy = true;
      var total = files.length, ok = 0, bad = [];
      var label = btn ? btn.textContent : "";
      if (btn) btn.disabled = true;

      var step = function (i) {
        if (i >= total) {
          batchBusy = false;
          if (btn) { btn.textContent = label; btn.disabled = false; }
          if (ok) markDirty();
          paintGallery();
          toast(ok
            ? ("已上传 " + ok + " 张" + (bad.length ? "，" + bad.length + " 张失败" : "") + "，记得点「保存」")
            : ("都没传上去：" + (bad[0] || "未知错误")));
          return;
        }
        if (btn) btn.textContent = "上传 " + (i + 1) + "/" + total;
        uploadFile(files[i], "image").then(function (r) {
          galleryState.data.photos.push({
            id: "",
            src: r.url,
            title: guessTitle(files[i].name),
            desc: "",
            album: album,
            date: todayStr(),
            pos: "center"
          });
          ok++;
        }, function (err) {
          bad.push((files[i].name || "文件") + (err && err.message ? "：" + err.message : ""));
        }).then(function () { step(i + 1); });
      };
      step(0);
    }

    function guessTitle(name) {
      return String(name || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 80);
    }

    function todayStr() {
      var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    if (act === "g-save") {
      syncPhotos();
      galleryState.data.photos = galleryState.data.photos.filter(function (photo) { return photo && photo.src; });
      api("/api/admin/gallery", { method: "PUT", body: galleryState.data })
        .then(function (r) { clearDirty(); normalizeGallery(r); toast("已保存，前台会自动刷新"); })
        .catch(function (err) { toast(err.message); });
      return;
    }

    /* ---------- 笔记 ---------- */
    if (act === "n-add") {
      collectNotes();
      if (notesState.tab === "cheatsheets") notesState.data.cheatsheets.push({ title: "新分组", items: [] });
      else notesState.data.links.push({ abbr: "", title: "", desc: "", url: "", tint: "purple" });
      markDirty();
      paintNotes();
      return;
    }

    if (act === "n-del") {
      var idx = Number(btn.getAttribute("data-i"));
      var tabKey = notesState.tab;
      collectNotes();
      var removed = notesState.data[tabKey][idx];
      if (!removed) return;
      var name = String(removed.title || removed.abbr || "").trim();
      var what = NOTE_LABEL[tabKey] || "条目";
      UI.confirm("删除" + what + (name ? "「" + name + "」" : "第 " + (idx + 1) + " 条") + "？会立即写入数据库，前台同步移除。",
        { title: "删除" + what, danger: true, okText: "删除" }).then(function (yes) {
        if (!yes) return;
        notesState.data[tabKey].splice(idx, 1);
        api("/api/admin/notes", { method: "PUT", body: notesState.data })
          .then(function (r) {
            notesState.data = r;
            clearDirty();
            paintNotes();
            toast("已删除，前台刷新可见");
          })
          .catch(function (err) {
            notesState.data[tabKey].splice(idx, 0, removed);
            paintNotes();
            toast(err.message);
          });
      });
      return;
    }

    if (act === "n-save") {
      var data = collectNotes();
      api("/api/admin/notes", { method: "PUT", body: data })
        .then(function (r) { clearDirty(); notesState.data = r; paintNotes(); toast("已保存，前台刷新可见"); })
        .catch(function (err) { toast(err.message); });
      return;
    }

    /* ---------- 账号 ---------- */
    if (act === "u-add") {
      var uname = ($("u-name").value || "").trim();
      var upass = ($("u-pass").value || "");
      if (!uname) { toast("账号不能为空"); return; }
      if (upass.length < 6) { toast("访客密码至少 6 位"); return; }
      api("/api/admin/users", { method: "POST", body: { name: uname, password: upass } })
        .then(function () { toast("已创建访客账号"); renderUsers(); })
        .catch(function (err) { toast(err.message); });
      return;
    }

    if (act === "u-pass") {
      var passName = btn.getAttribute("data-name");
      /* 密码策略：管理员至少 10 位，访客至少 6 位 */
      var passUser = (state.users || []).filter(function (u) { return u.name === passName; })[0];
      var passMin = passUser && passUser.role === "admin" ? 10 : 6;
      UI.prompt("给「" + passName + "」设置新密码（至少 " + passMin + " 位）", "",
        { title: "修改密码", password: true, placeholder: "至少 " + passMin + " 位" }).then(function (np) {
        if (!np) return;
        if (String(np).length < passMin) { toast("密码至少 " + passMin + " 位"); return; }
        api("/api/admin/users/password", { method: "POST", body: { name: passName, next: np } })
          .then(function () { toast("密码已修改"); })
          .catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "u-del") {
      var delName = btn.getAttribute("data-name");
      UI.confirm("删除账号「" + delName + "」？", { title: "删除账号", danger: true, okText: "删除" }).then(function (yes) {
        if (!yes) return;
        api("/api/admin/users/" + encodeURIComponent(delName), { method: "DELETE" })
          .then(function () { toast("已删除"); renderUsers(); })
          .catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "tag-pick") {
      var pickEl = $("ed-tags");
      if (!pickEl) return;
      var picked = btn.getAttribute("data-name");
      var cur = pickEl.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (cur.indexOf(picked) < 0) cur.push(picked);
      pickEl.value = cur.join(", ");
      pickEl.focus();
      return;
    }

    if (act === "term-add") {
      var addKind = btn.getAttribute("data-kind");
      var addInput = $("term-new-" + addKind);
      var addName = addInput ? addInput.value.trim() : "";
      if (!addName) { toast("先填个名称"); if (addInput) addInput.focus(); return; }
      api("/api/admin/terms/add", { method: "POST", body: { kind: addKind, name: addName } })
        .then(function (r) {
          state.terms = r;
          toast("已添加「" + addName + "」，写文章时可以直接选");
          renderTerms();
        })
        .catch(function (err) { toast(err.message); });
      return;
    }

    if (act === "term-rename") {
      var kind = btn.getAttribute("data-kind");
      var from = btn.getAttribute("data-name");
      UI.prompt("改成什么？", from, { title: "重命名", placeholder: "新的名称" }).then(function (to) {
        if (!to || to === from) return;
        api("/api/admin/terms/rename", { method: "POST", body: { kind: kind, from: from, to: to } })
          .then(function () { toast("已改名"); renderTerms(); })
          .catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "term-del") {
      var k2 = btn.getAttribute("data-kind");
      var name2 = btn.getAttribute("data-name");
      UI.confirm("把「" + name2 + "」从所有文章上移除？", { title: "移除分类 / 标签", danger: true, okText: "移除" }).then(function (yes) {
        if (!yes) return;
        api("/api/admin/terms/delete", { method: "POST", body: { kind: k2, name: name2 } })
          .then(function () { toast("已移除"); renderTerms(); })
          .catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "gh-refresh") { loadGithubPreview(true); return; }

    if (act === "save-site") {
      var site = {
        name: $("s-name").value,
        title: $("s-title").value,
        bio: $("s-bio").value,
        tags: $("s-tags").value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
        location: $("s-location").value,
        started: $("s-started").value.trim(),
        email: $("s-email").value.trim(),
        github: $("s-github").value.trim(),
        footerNote: $("s-footer").value.trim()
      };
      var merged = Object.assign({}, state.site, site);
      api("/api/admin/settings", { method: "PUT", body: { site: merged } })
        .then(function () {
          /* 后端在写操作成功后才自动刷新 updated，所以再取一次设置，
             让只读框立刻显示刚生成的更新时间 */
          return api("/api/admin/settings");
        })
        .then(function (fresh) {
          state.site = fresh.site || merged;
          var box = $("s-updated");
          if (box) box.value = state.site.updated || "";
          clearDirty();
          loadGithubPreview();
          toast("已保存，更新时间已自动刷新");
        })
        .catch(function (err) { state.site = merged; toast(err.message); });
      return;
    }

    if (act === "av-upload") {
      pickFile("image", function (file) {
        /* 头像单独走 kind=avatar，前端压到最长边 512 */
        uploadFile(file, "avatar", btn).then(function (r) {
          saveSiteAvatar(r.url);
        }).catch(function (err) { toast(err.message); });
      });
      return;
    }

    if (act === "av-clear") {
      saveSiteAvatar("");
      return;
    }

    if (act === "save-password") {
      var newPass = $("p-new").value || "";
      if (newPass.length < 10) { toast("管理员密码至少 10 位"); return; }
      api("/api/admin/password", { method: "POST", body: { old: $("p-old").value, next: newPass } })
        .then(function () {
          toast("密码已修改");
          $("p-old").value = "";
          $("p-new").value = "";
        })
        .catch(function (err) { toast(err.message); });
      return;
    }
  });

  /* ---------- 启动 ---------- */

  /* 浏览器前进 / 后退或手改 hash 时同步视图（replaceState 不会触发 hashchange） */
  window.addEventListener("hashchange", function () {
    if (!state.user) return;
    var h = (location.hash || "").replace(/^#/, "");
    if (!h) return;
    applyHash();
  });

  function boot() {
    if (state.user && state.user.role !== "admin") {
      document.querySelector(".st-side").style.display = "none";
      view.innerHTML =
        '<div class="st-empty" style="padding-top:80px">' +
          '<div style="font-size:15px;color:var(--text);margin-bottom:8px">这是管理员后台</div>' +
          '你的账号（' + esc(state.user.name) + '）是访客权限，只能留言，改不了任何内容。<br><br>' +
          '<a class="st-btn" href="guestbook.html">去留言板</a>' +
          '<button class="st-btn" id="guest-out" style="margin-left:8px">换账号</button>' +
        '</div>';
      var out = document.getElementById("guest-out");
      if (out) out.addEventListener("click", function () {
        api("/api/logout", { method: "POST" }).then(function () {
          state.user = null;
          document.querySelector(".st-side").style.display = "";
          showGate(false);
        });
      });
      return;
    }

    api("/api/admin/terms").then(function (t) { state.terms = t; }).catch(function () {});
    applyHash();
  }

  api("/api/admin/state").then(function (s) {
    state.setupTokenRequired = !!(s && s.setupTokenRequired);
    if (s.needSetup) { showGate(true); return; }
    if (!s.user) { showGate(false); return; }
    state.user = s.user;
    hideGate();
    boot();
  }).catch(function (e) {
    /* 401/403 已由 api() 统一退回登录 gate，这里不能再跳离线段 */
    if (e && e.auth) return;
    /* 后台同样是同一套后端：连不上就整页跳到断连页，不显示半截管理台 */
    window.KIMON.goOffline("连接管理接口失败：" + (e && e.message ? e.message : "未知错误"));
  });
})();
