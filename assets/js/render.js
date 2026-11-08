/* ============================================================
   渲染引擎 —— 把 /api/bootstrap（数据库）返回的内容画成页面
   页面通过 <body data-page="home"> 指定要渲染哪一块
   ============================================================ */

(function () {
  "use strict";

  /* boot.js 判定后端连不上时已整页跳到 offline.html，这里不再渲染任何东西 */
  if (window.KIMON && window.KIMON.failed) return;

  var S = window.SITE || {};
  var POSTS = (window.POSTS || []).slice();
  var DIARY = window.DIARY || [];
  var NOTES = window.NOTES || { cheatsheets: [], links: [] };
  var RESOURCES = window.RESOURCES || [];
  var GALLERY = window.GALLERY || { title: "", intro: "", photos: [] };

  var CAT_LABEL = { daily: "日常", tech: "技术", mind: "心态" };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function byId(id) { return document.getElementById(id); }

  /* 允许极少量行内标签（em / strong / code / br）的富文本：
     先整体转义，再把白名单标签还原，属性一律不放行。 */
  function richText(s) {
    var out = esc(s);
    out = out.replace(/&lt;(\/?)(em|strong|code|b|i)&gt;/gi, function (m, close, tag) {
      tag = tag.toLowerCase();
      if (tag === "b") tag = "strong";
      if (tag === "i") tag = "em";
      return "<" + close + tag + ">";
    });
    out = out.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
    return out;
  }

  /* 链接协议白名单：挡住 javascript: / data: 之类 */
  function safeUrl(u) {
    u = String(u || "").trim();
    if (/^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(u)) return u;
    if (/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.~/-]*)?(?:[?#][^\s]*)?$/.test(u)) return u;
    return "";
  }

  /* object-position 只接受安全字符，避免把任意 CSS 拼进 style */
  function posValue(v) {
    v = String(v == null ? "" : v).trim();
    return /^[A-Za-z0-9 %.\-]+$/.test(v) ? v : "center";
  }

  /* ---------- 动态 SEO ---------- */
  function siteBase() {
    var base = String(window.KIMON_SITE_URL || "").replace(/\/+$/, "");
    return base || location.origin;
  }

  function applyMeta(o) {
    o = o || {};
    var title = o.title || document.title;
    /* 描述元信息用纯文本：去掉简介里允许的行内标签，别把标签当正文喂给搜索引擎 */
    var desc = (o.description == null ? "" : String(o.description))
      .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    var url = siteBase() + location.pathname + location.search;

    document.title = title;

    function meta(attr, name, content) {
      if (content == null || content === "") return;
      var el = document.querySelector("meta[" + attr + '="' + name + '"]');
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    }

    if (desc) meta("name", "description", desc);

    var canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", url);

    meta("property", "og:title", title);
    meta("property", "og:description", desc);
    meta("property", "og:url", url);
    meta("property", "og:type", o.type || "website");
    meta("name", "twitter:card", "summary");
  }

  function fill(id, html) {
    var n = byId(id);
    if (n) n.innerHTML = html;
    return n;
  }

  /* 空数据兜底：任何列表区块没内容，都给一张说明卡，不留空白也不报错 */
  var EMPTY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v13H4z"/><path d="M4 7l2-4h12l2 4M9 12h6"/></svg>';
  function blank(title, hint) {
    return '<div class="empty-box"><span class="es-icon">' + EMPTY_ICON + '</span>' +
      '<b>' + esc(title) + '</b>' +
      (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
  }
  function paintList(id, arr, mapper, title, hint) {
    return fill(id, arr.length ? arr.map(mapper).join('') : blank(title, hint));
  }

  function initial(name) { return String(name || "J").trim().slice(0, 1).toUpperCase(); }

  function cover(c, cls) {
    c = c || {};
    /* tint 会拼进 class 名，只接受小写字母 / 数字 / 连字符 */
    var tint = /^[a-z0-9_-]+$/i.test(String(c.tint || "")) ? String(c.tint) : "purple";
    var hasImg = !!c.image;
    return '<div class="cover cv-' + tint + (hasImg ? " has-img" : "") + (cls ? " " + cls : "") + '">' +
      (hasImg ? '<img src="' + esc(c.image) + '" alt="" loading="lazy" decoding="async">' : "") +
      (c.glyph ? '<span class="cover-glyph">' + esc(c.glyph) + "</span>" : "") +
      "</div>";
  }

  function postUrl(p) { return "post.html?id=" + encodeURIComponent(p.id); }

  function sorted(list) {
    return list.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  /* 分组只认库里的字段：后台文章表单里的 group 优先，否则用真实分类名。
     旧版按分类名关键字硬猜成 6 个固定组，后台改分类名/新增分类后前台会对不上。 */
  function groupOf(p) {
    if (p.group) return p.group;
    return (p.cat || "").trim() || "未分类";
  }

  /* ---------- site-wide ---------- */
  function applySite() {
    document.querySelectorAll(".brand").forEach(function (b) {
      b.innerHTML = '<span class="brand-mark">' + esc(initial(S.name)) + "</span>" +
        esc(S.name);
    });

    document.querySelectorAll("[data-site='name']").forEach(function (n) { n.textContent = S.name; });
    document.querySelectorAll("[data-site='location']").forEach(function (n) { n.textContent = S.location; });

    /* 联系方式全部从站点信息渲染，避免页脚留下 href="#" 的死链 */
    document.querySelectorAll("[data-site='email']").forEach(function (n) {
      n.textContent = S.email || "";
      if (n.tagName === "A") n.href = S.email ? "mailto:" + S.email : "#";
    });
    document.querySelectorAll("[data-site='github']").forEach(function (n) {
      var g = String(S.github || "").replace(/^@/, "").trim();
      if (!g) { n.hidden = true; return; }
      n.hidden = false;
      n.href = /^https?:\/\//i.test(g) ? g : "https://github.com/" + g;
    });
    paintAvatar(S.avatar || "");

    /* 标题与描述里写死了站名，后台改名后一并同步 */
    if (S.name && S.name !== "Kimon") {
      document.title = document.title.split("Kimon").join(S.name);
      document.querySelectorAll('meta[name="description"]').forEach(function (m) {
        m.content = m.content.split("Kimon").join(S.name);
      });
    }

    var footNote = document.querySelector("[data-site='footer-note']");
    if (footNote) footNote.textContent = S.footerNote;
  }

  /* ---------- home ---------- */
  function renderHome() {
    var t = S.title || "";
    var idx = t.indexOf("，");
    var line1 = idx > -1 ? t.slice(0, idx + 1) : t;
    var line2 = idx > -1 ? t.slice(idx + 1) : "";

    fill("hero-title", esc(line1) + (line2 ? "<br>" + esc(line2) : ""));
    /* 简介允许 em / strong / code / br，其余标签会被转义掉 */
    fill("hero-bio", richText(S.bio || ""));
    fill("hero-tags", (S.tags || []).map(function (x, i) {
      return '<span class="tag' + (i === 0 ? " is-accent" : "") + '">' + esc(x) + "</span>";
    }).join(""));

    var PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';

    fill("hero-meta",
      '<span>' + PIN + esc(S.location || "") + '</span>' +
      '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>更新于 ' + esc(S.updated || "—") + "</span>" +
      '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 19V5a2 2 0 012-2h12v18H6a2 2 0 00-2 2z"/></svg>第 ' + esc((new Date().getFullYear() - parseInt((S.started || "2024").slice(0, 4), 10)) + 1) + " 年</span>"
    );

    /* 右侧原本是 Site stats 数字卡，已按需求换成相册预览 */
    renderGalleryTeaser();

    var desc = sorted(POSTS);
    var pinned = desc.filter(function (p) { return p.pinned; });
    var featured = pinned.concat(desc.filter(function (p) { return !p.pinned; })).slice(0, 4);

    if (featured.length) {
      var main = featured[0];
      var html =
        '<a class="featured-main" href="' + postUrl(main) + '">' +
          '<span class="pin-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z"/></svg>置顶 · ' + esc(main.cat) + "</span>" +
          cover(main.cover) +
          '<div class="post-body">' +
            '<div class="post-cat">' + esc(main.cat) + "</div>" +
            "<h3>" + esc(main.title) + "</h3>" +
            '<p class="post-excerpt">' + esc(main.excerpt) + "</p>" +
            '<div class="post-meta"><span>' + esc(main.date) + '</span><span class="dot"></span><span>' +
              esc(main.minutes) + " 分钟阅读</span></div>" +
          "</div>" +
        "</a>" +
        '<div class="featured-side">' +
          featured.slice(1).map(function (p) {
            return '<a class="mini-card" href="' + postUrl(p) + '">' + cover(p.cover) +
              '<div><h4>' + esc(p.title) + "</h4>" +
              '<div class="post-meta" style="margin-top:6px"><span>' + esc(p.cat || groupOf(p)) +
              '</span><span class="dot"></span><span>' + esc(p.date) + "</span></div></div></a>";
          }).join("") +
        "</div>";
      fill("featured-grid", html);
    } else {
      fill("featured-grid", blank("还没有文章", "去后台「文章」里发布第一篇，这里会自动出现。"));
    }

    paintList("latest-grid", desc.slice(0, 6), function (p) {
      return '<a class="post-card" href="' + postUrl(p) + '">' + cover(p.cover) +
        '<div class="post-body"><div class="post-cat">' + esc(p.cat) + "</div>" +
        "<h3>" + esc(p.title) + "</h3>" +
        '<p class="post-excerpt">' + esc(p.excerpt) + "</p>" +
        '<div class="post-meta"><span>' + esc(p.date) + '</span><span class="dot"></span><span>' +
        esc(p.minutes) + " 分钟</span></div></div></a>";
    }, "还没有文章", "去后台「文章」里发布第一篇，这里会按时间倒序列出最近 6 篇。");

    paintList("home-notes", (NOTES.cheatsheets || []).slice(-2).reverse(), function (g, i) {
      return '<div class="note-card"><header><h3>' + esc(g.title) + "</h3></header><ul>" +
        (g.items || []).slice(0, 3).map(function (it) { return "<li>" + richText(it) + "</li>"; }).join("") +
        "</ul></div>";
    }, "还没有碎片笔记", "在后台「笔记」里加一条速查，这里会显示最近两条。");
  }

  /* ---------- tech archive ---------- */
  function renderArchive() {
    var desc = sorted(POSTS.filter(function (p) { return p.section !== "essay"; }));
    var years = {};
    desc.forEach(function (p) {
      var y = p.date.slice(0, 4);
      (years[y] = years[y] || []).push(p);
    });

    var html = Object.keys(years).sort().reverse().map(function (y) {
      return '<div class="year-group" data-year-group>' +
        '<div class="year-label"><h2>' + y + '</h2><span class="count">' + years[y].length + " 篇</span></div>" +
        years[y].map(function (p) {
          return '<a class="arch-item" href="' + postUrl(p) + '" data-item data-cat="' + esc(groupOf(p)) +
            '" data-tags="' + esc((p.tags || []).join(" ")) + '">' +
            '<span class="d">' + esc(p.date.slice(5)) + "</span>" +
            '<span class="t">' + esc(p.title) + "</span>" +
            '<span class="c">' + esc(p.cat) + "</span></a>";
        }).join("") +
        "</div>";
    }).join("");

    fill("archive-timeline", desc.length
      ? html
      : blank("还没有技术文章", "去后台发布一篇技术文章，归档时间线会自动按年份排好。"));

    if (!desc.length) {
      var bar0 = document.querySelector("[data-archive] .filter-bar");
      if (bar0) bar0.querySelectorAll("[data-filter]").forEach(function (b) {
        if (b.getAttribute("data-filter") !== "all") b.remove();
      });
    }

    /* 分类筛选按钮由库里的文章实时生成，不再写死在 HTML 里 */
    var catCount = {};
    desc.forEach(function (p) {
      var c = groupOf(p);
      catCount[c] = (catCount[c] || 0) + 1;
    });
    var cats = Object.keys(catCount).sort(function (a, b) {
      return catCount[b] - catCount[a] || a.localeCompare(b);
    });
    var bar = document.querySelector("[data-archive] .filter-bar");
    if (bar) {
      var allChip = bar.querySelector('[data-filter="all"]');
      bar.querySelectorAll("[data-filter]").forEach(function (b) {
        if (b !== allChip) b.remove();
      });
      var searchWrap = bar.querySelector(".search-wrap");
      cats.forEach(function (c) {
        var btn = document.createElement("button");
        btn.className = "chip";
        btn.type = "button";
        btn.setAttribute("data-filter", c);
        btn.textContent = c;
        if (searchWrap) bar.insertBefore(btn, searchWrap);
        else bar.appendChild(btn);
      });
    }

    var counts = {};
    POSTS.forEach(function (p) {
      if (p.section === "essay") return;
      (p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var topTags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 10);
    fill("tagcloud", topTags.map(function (t) {
      return '<button data-tag="' + esc(t) + '">' + esc(t) + '<span class="count">' + counts[t] + "</span></button>";
    }).join(""));

  }

  /* ---------- essays ---------- */
  function renderEssays() {
    var list = sorted(POSTS.filter(function (p) { return p.section === "essay"; }));

    /* 列表页不再展示标签（分类 / tags 都不显示），标签只在文章详情页出现 */
    paintList("essay-list", list, function (p) {
      return '<a class="row-item is-plain" href="' + postUrl(p) + '">' +
        '<span class="row-date">' + esc(p.date) + "</span>" +
        "<div><div class=\"row-title\">" + esc(p.title) + "</div>" +
        '<div class="row-desc">' + esc(p.excerpt) + "</div></div></a>";
    }, "还没有随笔", "去后台「文章」里把分区选成随笔并发布，这里就会列出来。");

    /* 「复盘与总结」原区块已下线：库里没有带总结/复盘标签的随笔，
       当时靠 list.slice(0,2) 随手抓两篇凑数，没有来源依据。 */
  }

  function tintClass(tint) {
    var map = { purple: "qi-purple", teal: "qi-teal", amber: "qi-amber", rose: "qi-rose", gray: "qi-gray" };
    return map[tint] || "qi-purple";
  }

  /* ---------- diary ---------- */
  var diaryState = { book: "", cat: "all" };

  function accentClass(a) {
    var map = { amber: "qi-amber", teal: "qi-teal", purple: "qi-purple", rose: "qi-rose", gray: "qi-gray" };
    return map[a] || "qi-amber";
  }

  function renderDiary() {
    var books = window.DIARY || [];
    var tabsEl = byId("diary-books");
    if (!books.length || !tabsEl) {
      var tl = byId("diary-timeline");
      if (tl && tabsEl) tl.innerHTML = '<div class="empty-state show">还没有日记，去后台写第一篇吧。</div>';
      return;
    }

    var hash = (location.hash || "").replace("#", "");
    if (hash && books.some(function (b) { return b.id === hash; })) diaryState.book = hash;
    if (!diaryState.book || !books.some(function (b) { return b.id === diaryState.book; })) {
      diaryState.book = books[0].id;
    }

    var book = books.filter(function (b) { return b.id === diaryState.book; })[0];

    tabsEl.innerHTML = books.map(function (b) {
      return '<button class="book-chip' + (b.id === diaryState.book ? " on" : "") +
        '" data-book="' + esc(b.id) + '" type="button">' +
        '<span class="book-dot ' + accentClass(b.accent) + '"></span>' +
        esc(b.name) +
        '<span class="book-n">' + (b.entries || []).length + "</span>" +
      "</button>";
    }).join("");

    tabsEl.querySelectorAll("[data-book]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        diaryState.book = btn.getAttribute("data-book");
        diaryState.cat = "all";
        try { history.replaceState(null, "", "#" + diaryState.book); } catch (e) {}
        renderDiary();
      });
    });

    var descEl = byId("diary-desc");
    if (descEl) descEl.textContent = book.desc || "";

    var entries = (book.entries || []).slice().sort(function (a, b) {
      return a.date < b.date ? 1 : -1;
    });

    var chips = byId("diary-filters");
    if (chips) {
      var opts = [["all", "全部"]].concat(Object.keys(CAT_LABEL).map(function (k) {
        return [k, CAT_LABEL[k]];
      }));

      chips.innerHTML = opts.map(function (o) {
        return '<button class="chip' + (diaryState.cat === o[0] ? " active" : "") +
          '" data-cat="' + o[0] + '" type="button">' + o[1] + "</button>";
      }).join("");

      chips.querySelectorAll("[data-cat]").forEach(function (b) {
        b.addEventListener("click", function () {
          diaryState.cat = b.getAttribute("data-cat");
          renderDiary();
        });
      });
    }

    var shown = diaryState.cat === "all"
      ? entries
      : entries.filter(function (e) { return e.cat === diaryState.cat; });

    fill("diary-timeline", shown.map(function (d, i) {
      return '<article class="diary-item' + (i === 0 ? " is-first" : "") + '">' +
        '<div class="diary-card">' +
          '<div class="diary-head">' +
            (d.day ? '<span class="diary-day">第 ' + esc(d.day) + " 天</span>" : "") +
            '<span class="diary-date">' + esc(d.date) +
              (d.weekday ? " · " + esc(d.weekday) : "") + "</span>" +
            '<span class="diary-cat">' + esc(CAT_LABEL[d.cat] || d.cat) + "</span>" +
          "</div>" +
          "<h3>" + esc(d.title) + "</h3>" +
          '<p class="diary-body">' + esc(d.body) + "</p>" +
        "</div></article>";
    }).join("") || '<div class="empty-state show">这本子在这个分类下还没有内容。</div>');

    /* 日记内容由登录态异步渲染，补一次动效绑定 */
    if (window.KIMON && window.KIMON.enhanceMotion) {
      var tlEl = byId("diary-timeline");
      if (tlEl) window.KIMON.enhanceMotion(tlEl);
    }
  }

  /* 地址栏 hash 变化时切换日记本：浏览器前进 / 后退或手改 hash 都保持一致；
     点击日记本按钮走 replaceState（不触发 hashchange），仍由按钮自己重渲染。 */
  window.addEventListener("hashchange", function () {
    if (document.body.getAttribute("data-page") !== "diary") return;
    var hash = (location.hash || "").replace("#", "");
    try { hash = decodeURIComponent(hash); } catch (e) {}
    if (!hash || hash === diaryState.book) return;
    var books = window.DIARY || [];
    if (!books.some(function (b) { return b.id === hash; })) return;
    diaryState.book = hash;
    diaryState.cat = "all";
    renderDiary();
  });

  /* ---------- notes ---------- */
  function renderNotes() {
    paintList("cheatsheets", NOTES.cheatsheets || [], function (g, i) {
      return '<div class="note-card"><header><h3>' + esc(g.title) + "</h3></header><ul>" +
        (g.items || []).map(function (it) { return "<li>" + richText(it) + "</li>"; }).join("") +
        "</ul></div>";
    }, "还没有速查笔记", "在后台「笔记 → 速查」里加一组常用命令或配置。");

    paintList("links", NOTES.links || [], function (l) {
      /* 链接地址先过协议白名单，非法地址降级成不可点的卡片 */
      var url = safeUrl(l.url);
      var tag = url ? "a" : "div";
      var attr = url
        ? ' class="link-card" href="' + esc(url) + '" target="_blank" rel="noopener"'
        : ' class="link-card"';
      return "<" + tag + attr + ">" +
        '<span class="link-fav ' + tintClass(l.tint) + '">' + esc(l.abbr) + "</span>" +
        '<span class="link-text"><b>' + esc(l.title) + "</b><small>" + esc(l.desc) + "</small></span>" +
        '<span class="link-arrow">→</span></' + tag + ">";
    }, "还没有收藏链接", "在后台「笔记 → 链接」里加几条常看的链接，每条会单独成一张卡。");

  }

  /* ---------- resources ---------- */
  function renderResources() {
    var total = RESOURCES.reduce(function (n, r) { return n + (r.downloads || 0); }, 0);
    var cnt = byId("res-count");
    if (cnt) cnt.textContent = RESOURCES.length
      ? RESOURCES.length + " 个文件，累计下载 " + total.toLocaleString() + " 次。"
      : "还没有上传资源。";

    paintList("resources-grid", RESOURCES, function (r) {
      /* 大小由后端按磁盘上的真实文件算出；没文件就不显示假 size / 假日期 / 假下载按钮 */
      var meta = [r.version, r.size, r.lang].filter(Boolean).join(" · ") || "文件待上传";
      var dl = r.hasFile && r.downloadUrl
        ? '<a class="res-dl" href="' + esc(r.downloadUrl) + '" download>下载<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M4 21h16"/></svg></a>'
        : '<span class="res-pending">待上传</span>';
      return '<div class="res-card">' +
        '<div class="res-top">' +
        '<div class="res-icon ' + tintClass(r.tint) + '">' + esc(r.icon) + "</div>" +
        "<div><h3>" + esc(r.name) + "</h3>" +
        '<div class="res-ver">' + esc(meta) + "</div></div></div>" +
        '<p class="res-desc">' + esc(r.desc) + "</p>" +
        '<div class="res-foot"><div class="res-stats"><span>↓ ' + esc(r.downloads || 0) +
        "</span><span>·</span><span>" + (r.hasFile ? esc(r.date || "") : "待上传") + "</span></div>" + dl + "</div></div>";
    }, "还没有资源", "去后台「资源」里上传第一个文件，这里就会出现下载卡片。");
  }

  /* ---------- single post ---------- */
  function renderPost() {
    var root = byId("post-head");
    if (!root) return;

    var id = "";
    try { id = new URLSearchParams(location.search).get("id") || ""; } catch (e) {}
    var exact = POSTS.filter(function (p) { return p.id === id; })[0];
    var siteName = S.name || "Kimon";

    /* id 对不上任何文章就明确显示空态，不能静默拿最新一篇顶上 */
    if (!id || !exact) {
      fill("post-head", blank("这篇文章不在了", "可能已删除，或链接里的 id 不对；回技术页看看别的文章吧。"));
      var cmtBox = byId("comments");
      if (cmtBox) cmtBox.hidden = true;
      var tocBox = byId("post-toc");
      if (tocBox) { tocBox.hidden = true; tocBox.innerHTML = ""; }
      applyMeta({
        title: "文章不存在 · " + siteName + "'s Blog",
        description: "文章不存在或已删除",
        type: "article"
      });
      return;
    }

    var post = exact;
    var desc = sorted(POSTS);
    applyMeta({
      title: post.title + " · " + siteName + "'s Blog",
      description: post.excerpt || "",
      type: "article"
    });

    /* 文章页同时服务技术 / 随笔两个分区，导航高亮要跟着文章走，
       不能像以前那样写死「技术」。 */
    var navTarget = post.section === "essay" ? "essays.html" : "tech.html";
    document.querySelectorAll(".nav a[href]").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === navTarget);
    });

    var meta = byId("post-head");
    if (meta) {
      meta.innerHTML =
        '<a class="post-cat" href="' + (post.section === "essay" ? "essays.html" : "tech.html") +
        '" style="font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase">' +
        esc(post.cat) + "</a>" +
        "<h1>" + esc(post.title) + "</h1>" +
        '<p class="article-desc">' + esc(post.excerpt) + "</p>" +
        '<div class="article-info"><span>' + esc(post.date) + '</span><span class="dot"></span><span>' +
        esc(post.minutes) + " 分钟阅读</span><span class=\"dot\"></span><span>" + esc(S.name) + "</span></div>";
    }

    var prose = byId("post-body");
    if (prose) {
      /* 正文以 Markdown 存库；这里统一渲染，原始 HTML 会被转义，不会注入脚本 */
      var toHtml = (window.KIMON && window.KIMON.mdToHtml) ||
        function (s) { return "<p>" + esc(s).replace(/\n/g, "<br>") + "</p>"; };
      prose.innerHTML = post.body && post.body.trim()
        ? toHtml(post.body)
        : "<p>" + esc(post.excerpt) + "</p>\n<p>（这篇的完整正文还在整理中。）</p>";

      /* 正文存的是 /uploads/... 相对路径，前后端分离部署时补上后端域名 */
      var apiBase = (window.KIMON && window.KIMON.api) || "";
      if (apiBase) {
        prose.querySelectorAll("img[src], a[href], video[src], source[src]").forEach(function (el) {
          var attr = el.hasAttribute("src") ? "src" : "href";
          var val = el.getAttribute(attr) || "";
          if (val.charAt(0) === "/" && val.slice(0, 2) !== "//") {
            el.setAttribute(attr, apiBase + val);
          }
        });
      }

      var heads = prose.querySelectorAll("h2");
      var toc = byId("post-toc");
      if (toc) {
        toc.hidden = !heads.length;
        toc.innerHTML = heads.length
          ? "<h4>本文目录</h4>" + Array.prototype.map.call(heads, function (h, i) {
              h.id = "s" + (i + 1);
              return '<a href="#s' + (i + 1) + '">' + esc(h.textContent) + "</a>";
            }).join("")
          : "";
      }
    }

    var tagWrap = byId("post-tags");
    if (tagWrap) {
      tagWrap.innerHTML = (post.tags || []).map(function (t) {
        return '<span class="tag">' + esc(t) + "</span>";
      }).join("");
    }

    var idx = desc.indexOf(post);
    var newer = desc[idx - 1];
    var older = desc[idx + 1];
    var pager = byId("post-pager");
    if (pager) {
      pager.innerHTML =
        (newer ? '<a href="' + postUrl(newer) + '"><span class="dir">← 上一篇</span><span class="ttl">' +
          esc(newer.title) + "</span></a>" : "<span></span>") +
        (older ? '<a href="' + postUrl(older) + '" style="text-align:right"><span class="dir">下一篇 →</span>' +
          '<span class="ttl">' + esc(older.title) + "</span></a>" : "<span></span>");
    }

    /* 相关阅读只认「标签重合」这一个依据：有几个共同标签就排前面。
       没有共同标签就整块隐藏，不再随手拿最近几篇凑数。 */
    var mine = post.tags || [];
    var related = desc.filter(function (p) { return p.id !== post.id && (p.tags || []).some(function (t) { return mine.indexOf(t) > -1; }); })
      .map(function (p) {
        var score = (p.tags || []).filter(function (t) { return mine.indexOf(t) > -1; }).length;
        return { post: p, score: score };
      })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 3)
      .map(function (x) { return x.post; });

    var relCard = byId("post-related-card");
    var rel = byId("post-related");
    if (relCard) relCard.hidden = !related.length;
    if (rel) {
      rel.innerHTML = related.map(function (p) {
        return '<a href="' + postUrl(p) + '" style="font-size:12.5px;line-height:1.6;color:var(--text-2)">' +
          esc(p.title) + "</a>";
      }).join("");
    }

    var crumb = byId("post-crumb");
    if (crumb) crumb.textContent = post.cat;

    /* 后台在线时挂上评论区，并登记一次阅读 */
    var cmt = byId("comments");
    if (cmt && window.KIMON && KIMON.remote && KIMON.mountPostComments) {
      cmt.hidden = false;
      KIMON.mountPostComments(cmt, post.id);
    }
    if (exact && window.KIMON && KIMON.view) KIMON.view(post.id);
  }

  /* ---------- avatar display ---------- */

  function paintAvatar(src) {
    document.querySelectorAll(".avatar").forEach(function (a) {
      var letter = a.querySelector(".avatar-letter");
      var img = a.querySelector(".avatar-img");

      /* 用真正的 img 铺满容器，避免 background 被描边挤出一圈白边 */
      if (src) {
        if (!img) {
          img = document.createElement("img");
          img.className = "avatar-img";
          img.alt = "";
          img.decoding = "async";
          a.insertBefore(img, a.firstChild);
        }
        img.src = src;
        a.classList.add("has-photo");
      } else {
        if (img) img.remove();
        a.style.backgroundImage = "";
        a.classList.remove("has-photo");
        if (letter) letter.textContent = initial(S.name);
        else a.textContent = initial(S.name);
      }
    });
  }

  /* ---------- diary gate：日记仅站长登录后可见 ---------- */
  function initDiaryPage() {
    var K = window.KIMON || {};
    var gate = byId("diary-gate");
    var lock = byId("diary-lock");
    var content = byId("diary-content");

    /* 没有门禁结构的老页面直接渲染（兜底） */
    if (!gate || !lock || !content) { renderDiary(); return; }

    var LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/>' +
      '<path d="M8 10.5V7.5a4 4 0 018 0v3"/><circle cx="12" cy="15.5" r="1.4"/></svg>';

    function head(sub) {
      return '<div class="dl-icon">' + LOCK_ICON + "</div>" +
        "<h2>日记仅站长本人可见</h2>" +
        '<p class="dl-sub">' + sub + "</p>";
    }

    function open(books) {
      window.DIARY = books || [];
      gate.hidden = true;
      content.hidden = false;
      renderDiary();
    }

    function load() {
      lock.innerHTML = head("正在读取…");
      K.request("/api/admin/diary").then(function (r) {
        open(r.books || []);
      }).catch(function (err) {
        lock.innerHTML = head("日记加载失败：" + esc(err.message || "未知错误")) +
          '<div class="dl-actions"><button type="button" class="btn btn-primary" id="dl-retry">重试</button></div>';
        var retry = byId("dl-retry");
        if (retry) retry.addEventListener("click", load);
      });
    }

    function showLogin(msg) {
      lock.innerHTML = head("这里是私人区域，访客请移步别的页面；站长登录后继续。") +
        '<div class="dl-form">' +
          '<input class="field" id="dl-name" placeholder="账号" autocomplete="username">' +
          '<input class="field" id="dl-pass" type="password" placeholder="密码" autocomplete="current-password">' +
          '<button type="button" class="btn btn-primary" id="dl-go">登录查看</button>' +
          '<div class="dl-msg">' + (msg || "") + "</div>" +
        "</div>";

      var msgEl = lock.querySelector(".dl-msg");
      var go = function () {
        var n = byId("dl-name").value.trim();
        var p = byId("dl-pass").value;
        if (!n || !p) { msgEl.textContent = "账号和密码都要填"; return; }
        msgEl.textContent = "登录中…";
        K.login(n, p).then(function () {
          if (K.isAdmin()) { load(); }
          else { showGuest(); }
        }).catch(function (err) { msgEl.textContent = err.message; });
      };
      byId("dl-go").addEventListener("click", go);
      [byId("dl-name"), byId("dl-pass")].forEach(function (i) {
        i.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
      });
      byId("dl-name").focus();
    }

    function showGuest() {
      var u = K.auth.user || {};
      lock.innerHTML = head("当前登录的是访客账号（" + esc(u.name || "") + "），只能留言，看不了日记。") +
        '<div class="dl-actions">' +
          '<a class="btn btn-primary" href="guestbook.html">去留言板</a>' +
          '<button type="button" class="dl-link" id="dl-out">退出登录</button>' +
        "</div>";
      byId("dl-out").addEventListener("click", function () {
        K.logout().then(function () { showLogin(); });
      });
    }

    if (!K.remote) {
      /* 极端兜底：正常路径下 remote.js 已经整页跳到 offline.html */
      lock.innerHTML = head("连不上后端，无法验证身份。") +
        '<div class="dl-actions"><a class="btn btn-primary" href="offline.html">查看连接状态</a></div>';
      return;
    }

    lock.innerHTML = head("正在确认身份…");
    K.auth.ready.then(function () {
      if (K.isAdmin()) load();
      else if (K.auth.user) showGuest();
      else showLogin();
    });
  }

  /* ---------- gallery ----------
     首页右侧预览与相册页共用同一份 GALLERY（来自 /api/bootstrap） */
  function galleryPhotos() {
    return (GALLERY.photos || []).filter(function (p) { return p && p.src; });
  }

  /* 随机洗牌（不动机上原数组：首页随机、相册页仍按后台顺序） */
  function shuffleCopy(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function gtCell(p, i) {
    return '<a class="gt-cell gt-' + i + '" href="gallery.html" aria-label="' + esc(p.title || "查看相册") + '">' +
      '<img src="' + esc(p.src) + '" alt="' + esc(p.title || "") + '" loading="lazy" decoding="async" style="object-position:' + esc(posValue(p.pos)) + '">' +
      (i === 0 ? '<span class="gt-cap">' + esc(p.title || "") + "</span>" : "") +
      "</a>";
  }

  /* 首页预览：随机抽 3 张，并且每隔几秒随机换掉其中一格，慢慢把整个相册轮一遍 */
  var gtTimer = null;
  var gtShown = [];

  function stopGtLoop() {
    if (gtTimer) { clearInterval(gtTimer); gtTimer = null; }
  }

  function startGtLoop(photos) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || photos.length <= 3) return;

    gtTimer = setInterval(function () {
      /* 标签页切到后台时不动，回来继续，省电也避免无谓解码 */
      if (document.hidden) return;
      var mosaic = byId("gt-mosaic");
      if (!mosaic) { stopGtLoop(); return; }

      var pool = photos.filter(function (p) { return gtShown.indexOf(p) < 0; });
      if (!pool.length) return;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      var slot = Math.floor(Math.random() * Math.min(3, gtShown.length));
      var cell = mosaic.querySelector(".gt-" + slot);
      var img = cell && cell.querySelector("img");
      if (!img) return;

      /* 先解码再换，避免换上去的瞬间空白闪一下 */
      var pre = new Image();
      pre.onload = function () {
        img.style.opacity = "0";
        setTimeout(function () {
          img.src = pick.src;
          img.alt = pick.title || "";
          img.style.objectPosition = posValue(pick.pos);
          var cap = cell.querySelector(".gt-cap");
          if (cap) cap.textContent = pick.title || "";
          img.style.opacity = "1";
          gtShown[slot] = pick;
        }, 260);
      };
      pre.src = pick.src;
    }, 5200);
  }

  function renderGalleryTeaser() {
    if (!byId("gallery-teaser")) return;
    stopGtLoop();

    var photos = galleryPhotos();
    fill("gt-title", esc(GALLERY.title || "相册"));
    fill("gt-intro", esc(GALLERY.intro || ""));
    fill("gt-count", photos.length ? photos.length + " 张照片" : "相册还是空的");

    if (!photos.length) {
      fill("gt-mosaic", '<div class="gt-blank">还没有照片<br><small>去后台上传第一张吧</small></div>');
      return;
    }

    gtShown = shuffleCopy(photos).slice(0, 3);
    fill("gt-mosaic", gtShown.map(gtCell).join(""));
    startGtLoop(photos);
  }

  function renderGallery() {
    var photos = galleryPhotos();
    fill("gallery-title", esc(GALLERY.title || "相册"));
    fill("gallery-intro", esc(GALLERY.intro || ""));

    /* 分组以后台维护的 GALLERY.albums 为准：新建的空分组、改名、删除都会立刻反映；
       万一拿到旧数据没有 albums，再按照片里出现过的名字兜底生成 */
    var albums = (GALLERY.albums || []).filter(function (a, i, arr) {
      return a && arr.indexOf(a) === i;
    });
    if (!albums.length) {
      photos.forEach(function (p) {
        var a = String(p.album || "").trim();
        if (a && albums.indexOf(a) < 0) albums.push(a);
      });
    }
    function albumOf(p) {
      var a = String(p.album || "").trim();
      return a && albums.indexOf(a) >= 0 ? a : "未分组";
    }
    if (photos.some(function (p) { return albumOf(p) === "未分组"; }) && albums.indexOf("未分组") < 0) {
      albums.push("未分组");
    }

    var active = "all";
    var shown = photos.slice();

    function paintFilters() {
      fill("gallery-filters",
        '<button class="chip' + (active === "all" ? " active" : "") + '" data-galbum="all">全部 <i>' + photos.length + "</i></button>" +
        albums.map(function (a) {
          var n = photos.filter(function (p) { return albumOf(p) === a; }).length;
          return '<button class="chip' + (active === a ? " active" : "") + '" data-galbum="' + esc(a) + '">' +
            esc(a) + " <i>" + n + "</i></button>";
        }).join(""));
    }

    function paintGrid() {
      var grid = byId("gallery-grid");
      var empty = byId("gallery-empty");
      if (!grid) return;
      shown = active === "all" ? photos.slice() : photos.filter(function (p) {
        return albumOf(p) === active;
      });
      grid.innerHTML = shown.map(function (p, i) {
        return '<button class="gallery-card" type="button" data-gi="' + i + '" aria-label="' + esc(p.title || "查看照片") + '">' +
          '<img src="' + esc(p.src) + '" alt="' + esc(p.title || "") + '" loading="lazy" decoding="async" style="object-position:' + esc(posValue(p.pos)) + '">' +
          '<span class="gc-info"><b>' + esc(p.title || "无题") + "</b>" +
            "<small>" + esc([p.album, p.date].filter(Boolean).join(" · ")) + "</small></span>" +
          "</button>";
      }).join("");
      if (window.KIMON && window.KIMON.enhanceMotion) window.KIMON.enhanceMotion(grid);
      if (empty) {
        empty.hidden = shown.length > 0;
        empty.textContent = photos.length ? "这个分组里还没有照片。" : "相册还是空的，去后台上传第一张照片吧。";
      }
    }

    paintFilters();
    paintGrid();

    var fbar = byId("gallery-filters");
    if (fbar) fbar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-galbum]");
      if (!b) return;
      active = b.getAttribute("data-galbum");
      paintFilters();
      paintGrid();
    });

    /* ---------- 灯箱 ---------- */
    var lb = byId("gallery-lightbox");
    if (!lb) return;
    var idx = 0;

    function showAt(i) {
      var list = shown;
      if (!list.length) return;
      idx = (i + list.length) % list.length;
      var p = list[idx];
      var img = byId("lb-img");
      img.src = p.src;
      img.alt = p.title || "";
      img.style.objectPosition = posValue(p.pos);
      byId("lb-title").textContent = p.title || "无题";
      byId("lb-album").textContent = p.album || "";
      byId("lb-desc").textContent = p.desc || "";
      byId("lb-count").textContent = (idx + 1) + " / " + list.length + (p.date ? " · " + p.date : "");
      lb.hidden = false;
      document.body.classList.add("lb-open");
    }

    function closeLb() {
      lb.hidden = true;
      document.body.classList.remove("lb-open");
      byId("lb-img").removeAttribute("src");
    }

    var grid = byId("gallery-grid");
    if (grid) grid.addEventListener("click", function (e) {
      var card = e.target.closest("[data-gi]");
      if (card) showAt(Number(card.getAttribute("data-gi")) || 0);
    });

    lb.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-lb]");
      if (btn) {
        var act = btn.getAttribute("data-lb");
        if (act === "close") closeLb();
        else if (act === "prev") showAt(idx - 1);
        else if (act === "next") showAt(idx + 1);
      } else if (e.target === lb) {
        closeLb();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (lb.hidden) return;
      if (e.key === "Escape") closeLb();
      else if (e.key === "ArrowLeft") showAt(idx - 1);
      else if (e.key === "ArrowRight") showAt(idx + 1);
    });
  }

  /* ---------- 开源项目（GitHub 自动同步） ---------- */
  function renderGithub() {
    var box = byId("github-projects");
    if (!box) return;
    var K = window.KIMON || {};
    fetch((K.api || "") + "/api/github", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) {
        if (!d || !d.ok || !d.count) { box.hidden = true; return; }
        fill("gh-count", esc(d.count) + " 个");
        fill("gh-list", (d.repos || []).slice(0, 6).map(function (r) {
          return '<a class="gh-card glass" href="' + esc(r.url) + '" target="_blank" rel="noopener">' +
            '<div class="gh-top"><span class="gh-name">' + esc(r.name) + "</span>" +
            (r.stars ? '<span class="gh-star">★ ' + esc(r.stars) + "</span>" : "") + "</div>" +
            '<p class="gh-desc">' + esc(r.desc || "还没写简介") + "</p>" +
            '<div class="gh-foot"><span>' + esc(r.lang || "—") + "</span>" +
            "<span>" + esc(String(r.pushedAt || "").slice(0, 10)) + "</span></div>" +
          "</a>";
        }).join(""));
        var more = byId("gh-more");
        if (more) more.href = d.url || "#";
        box.hidden = false;
        if (window.KIMON && window.KIMON.enhanceMotion) window.KIMON.enhanceMotion(box);
      })
      .catch(function () { box.hidden = true; });
  }

  /* ---------- boot ---------- */
  applySite();

  var page = document.body.getAttribute("data-page");
  var siteName = S.name || "Kimon";
  var baseTitle = siteName + "'s Blog";
  try {
    if (page === "home") {
      renderHome(); renderGithub();
      applyMeta({ title: baseTitle, description: S.bio || S.title || "" });
    } else if (page === "archive") {
      renderArchive();
      applyMeta({ title: "技术文章 · " + baseTitle, description: "按年份与分类归档的技术文章。" });
    } else if (page === "essays") {
      renderEssays();
      applyMeta({ title: "随笔 · " + baseTitle, description: "生活与阅读的随笔专栏。" });
    } else if (page === "diary") {
      initDiaryPage();
      applyMeta({ title: "日记 · " + baseTitle, description: "站长的私人日记。" });
    } else if (page === "notes") {
      renderNotes();
      applyMeta({ title: "笔记库 · " + baseTitle, description: "常用命令、配置与收藏链接。" });
    } else if (page === "resources") {
      renderResources();
      applyMeta({ title: "资源 · " + baseTitle, description: "可下载的脚本、模板与工具。" });
    } else if (page === "gallery") {
      renderGallery();
      applyMeta({
        title: (GALLERY.title || "相册") + " · " + baseTitle,
        description: GALLERY.intro || "照片与生活记录。"
      });
    } else if (page === "post") {
      renderPost();
    }

  } catch (err) {
    if (window.console) console.error("[render]", err);
  }
})();
