/* ============================================================
   Kimon's Blog - enhancements
   1. 全局搜索（⌘K / Ctrl+K）—— 索引从 /api/bootstrap 自动生成
   2. 回到顶部（带环形进度）
   3. 文章页：字号调节 + 代码复制
   ============================================================ */

(function () {
  "use strict";

  /* boot.js 判定后端连不上时已整页跳到 offline.html，这里不再渲染任何东西 */
  if (window.KIMON && window.KIMON.failed) return;

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================================================
     搜索索引 —— 自动从数据库下发的内容里读，加文章不用改这里
     ============================================================ */
  function buildIndex() {
    var out = [];

    (window.POSTS || []).forEach(function (p) {
      out.push({
        k: p.section === "essay" ? "随笔" : "文章",
        t: p.title,
        s: p.excerpt,
        u: "post.html?id=" + encodeURIComponent(p.id)
      });
    });

    (window.DIARY || []).forEach(function (book) {
      ((book && book.entries) || []).forEach(function (d) {
        out.push({
          k: book.name || "日记",
          t: (d.day ? "第 " + d.day + " 天：" : "") + d.title,
          s: d.body,
          u: "diary.html#" + encodeURIComponent(book.id)
        });
      });
    });

    ((window.NOTES || {}).cheatsheets || []).forEach(function (g) {
      if (!g) return;
      /* g.items 缺失时不能让整个索引构建中断，兜底成空数组 */
      out.push({
        k: "笔记",
        t: g.title,
        s: (g.items || []).join(" ").replace(/<[^>]+>/g, " "),
        u: "notes.html"
      });
    });

    (window.RESOURCES || []).forEach(function (r) {
      out.push({ k: "资源", t: r.name, s: r.desc, u: "resources.html" });
    });

    [
      { k: "页面", t: "首页", s: "个人简介 最新文章 精选置顶", u: "home.html" },
      { k: "页面", t: "技术文章", s: "后端 数据库 网络 逆向 分类标签检索", u: "tech.html" },
      { k: "页面", t: "随笔专栏", s: "生活 读书 通勤 租房", u: "essays.html" },
      { k: "页面", t: "笔记库 · 速查笔记", s: "命令 配置 资料链接", u: "notes.html" },
      { k: "页面", t: "资源下载", s: "脚本 模板 配置文件 开源", u: "resources.html" },
      { k: "页面", t: "留言板", s: "不用注册，想说什么都行", u: "guestbook.html" }
    ].forEach(function (x) { out.push(x); });

    return out;
  }

  var INDEX = buildIndex();

  /* 管理员在日记页登录后 window.DIARY 才会就位，打开搜索时重建索引 */
  function refreshIndex() {
    INDEX = buildIndex();
    var foot = overlay && overlay.querySelector(".sm-foot span:last-child");
    if (foot) foot.textContent = "共 " + INDEX.length + " 条索引";
  }

  /* ---------------- search modal ---------------- */
  var overlay, input, listEl, items = [], activeIdx = 0, built = false;

  function icon(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
  }

  function build() {
    if (built) return;
    built = true;

    overlay = document.createElement("div");
    overlay.className = "sm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "站内搜索");
    overlay.innerHTML =
      '<div class="sm-panel">' +
        '<div class="sm-field">' +
          icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>') +
          '<input class="sm-input" type="text" placeholder="搜索文章、随笔、日记、页面…" ' +
            'autocomplete="off" spellcheck="false" aria-label="搜索关键词">' +
          '<span class="sm-esc">ESC</span>' +
        "</div>" +
        '<div class="sm-list" role="listbox"></div>' +
        '<div class="sm-foot">' +
          "<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>" +
          "<span><kbd>Enter</kbd> 打开</span>" +
          '<span style="margin-left:auto">共 ' + INDEX.length + " 条索引</span>" +
        "</div>" +
      "</div>";

    document.body.appendChild(overlay);
    input = overlay.querySelector(".sm-input");
    listEl = overlay.querySelector(".sm-list");

    input.addEventListener("input", function () { render(input.value); });

    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (items[activeIdx]) window.location.href = items[activeIdx].u;
      }
    });

    render("");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    var i = String(text).toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, i)) +
      "<mark>" + escapeHtml(text.slice(i, i + q.length)) + "</mark>" +
      escapeHtml(text.slice(i + q.length));
  }

  function search(q) {
    var query = q.trim().toLowerCase();
    if (!query) return INDEX.slice(0, 6);

    var scored = [];
    INDEX.forEach(function (item) {
      var t = (item.t || "").toLowerCase();
      var s = (item.s || "").toLowerCase();
      var score = 0;
      if (t.indexOf(query) === 0) score = 100;
      else if (t.indexOf(query) > -1) score = 70;
      if (s.indexOf(query) > -1) score = Math.max(score, 40);
      if ((item.k || "").toLowerCase().indexOf(query) > -1) score = Math.max(score, 20);
      if (score > 0) scored.push({ item: item, score: score });
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 12).map(function (x) { return x.item; });
  }

  function render(q) {
    items = search(q);
    activeIdx = 0;

    if (!items.length) {
      listEl.innerHTML = '<div class="sm-empty">没有找到「' + escapeHtml(q) + "」，换个词试试。</div>";
      return;
    }

    listEl.innerHTML = items.map(function (it, i) {
      return '<div class="sm-item' + (i === 0 ? " active" : "") + '" role="option" data-i="' + i + '">' +
        '<span class="sm-kind">' + escapeHtml(it.k) + "</span>" +
        '<span class="sm-body">' +
          '<span class="sm-title">' + highlight(it.t, q) + "</span>" +
          '<span class="sm-sub">' + highlight(it.s, q) + "</span>" +
        "</span>" +
      "</div>";
    }).join("");

    listEl.querySelectorAll(".sm-item").forEach(function (el) {
      el.addEventListener("mouseenter", function () {
        setActive(parseInt(el.getAttribute("data-i"), 10));
      });
      el.addEventListener("click", function () {
        window.location.href = items[parseInt(el.getAttribute("data-i"), 10)].u;
      });
    });
  }

  function setActive(i) {
    var nodes = listEl.querySelectorAll(".sm-item");
    if (!nodes.length) return;
    activeIdx = (i + nodes.length) % nodes.length;
    nodes.forEach(function (n, idx) { n.classList.toggle("active", idx === activeIdx); });
    var el = nodes[activeIdx];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function move(step) { setActive(activeIdx + step); }

  function open() {
    build();
    refreshIndex();
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    input.value = "";
    render("");
    setTimeout(function () { input.focus(); }, 40);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("open");
    document.body.style.overflow = "";
  }

  var actions = document.querySelector(".header-actions");
  if (actions) {
    var btn = document.createElement("button");
    btn.className = "icon-btn";
    btn.setAttribute("aria-label", "搜索（Ctrl + K）");
    btn.innerHTML = icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>');
    btn.addEventListener("click", open);
    actions.insertBefore(btn, actions.firstChild);
  }

  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (overlay && overlay.classList.contains("open")) close();
      else open();
      return;
    }
    if (e.key === "Escape" && overlay && overlay.classList.contains("open")) { close(); return; }
    if (e.key === "/" && !typing && !(overlay && overlay.classList.contains("open"))) {
      e.preventDefault();
      open();
    }
  });

  /* ---------------- back to top ---------------- */
  var toTop = document.createElement("button");
  toTop.className = "to-top";
  toTop.setAttribute("aria-label", "回到顶部");
  toTop.innerHTML = icon('<path d="M12 19V6"/><path d="M5 12l7-7 7 7"/>')
    .replace("<svg ", '<svg class="arrow" ');
  document.body.appendChild(toTop);

  toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });

  var raf = false;
  function onScroll() {
    if (raf) return;
    raf = true;
    requestAnimationFrame(function () {
      raf = false;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var y = window.scrollY;
      var p = h > 0 ? Math.min(1, Math.max(0, y / h)) : 0;
      toTop.classList.toggle("show", y > 480);
      toTop.style.setProperty("--p", (p * 100).toFixed(1));
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------------- copy helper ---------------- */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallback(text); });
    } else {
      fallback(text);
    }
  }

  function fallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  /* ---------------- article tools ---------------- */
  var prose = document.querySelector(".prose");
  if (prose) {
    var info = document.querySelector(".article-info");
    var host = info && info.parentNode;

    var sizes = [
      { id: "s", label: "小" },
      { id: "m", label: "中" },
      { id: "l", label: "大" }
    ];

    var tools = document.createElement("div");
    tools.className = "art-tools";

    var label = document.createElement("span");
    label.className = "label";
    label.textContent = "正文字号";
    tools.appendChild(label);

    var saved = "m";
    try { saved = localStorage.getItem("kimon-prose-size") || "m"; } catch (e) {}

    sizes.forEach(function (s) {
      var b = document.createElement("button");
      b.className = "tool-btn" + (s.id === saved ? " on" : "");
      b.type = "button";
      b.textContent = s.label;
      b.addEventListener("click", function () {
        prose.setAttribute("data-size", s.id);
        tools.querySelectorAll(".tool-btn").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        try { localStorage.setItem("kimon-prose-size", s.id); } catch (e) {}
      });
      tools.appendChild(b);
    });

    var shareBtn = document.createElement("button");
    shareBtn.className = "tool-btn";
    shareBtn.type = "button";
    shareBtn.textContent = "复制链接";
    shareBtn.style.marginLeft = "auto";
    shareBtn.addEventListener("click", function () {
      copyText(window.location.href);
      shareBtn.textContent = "已复制";
      setTimeout(function () { shareBtn.textContent = "复制链接"; }, 1600);
    });
    tools.appendChild(shareBtn);

    if (host) host.appendChild(tools);
    prose.setAttribute("data-size", saved);

    /* code copy */
    prose.querySelectorAll("pre").forEach(function (pre) {
      var code = pre.querySelector("code") || pre;
      var b = document.createElement("button");
      b.className = "copy-btn";
      b.type = "button";
      b.textContent = "复制";
      b.addEventListener("click", function () {
        copyText(code.innerText);
        b.textContent = "已复制";
        b.classList.add("done");
        setTimeout(function () {
          b.textContent = "复制";
          b.classList.remove("done");
        }, 1600);
      });
      pre.appendChild(b);
    });
  }
})();
