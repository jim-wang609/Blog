/* ============================================================
   Kimon's Blog - interactions & motion
   ============================================================ */

(function () {
  "use strict";

  /* boot.js 判定后端连不上时已整页跳到 offline.html，这里不再渲染任何东西 */
  if (window.KIMON && window.KIMON.failed) return;

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- theme ---------- */
  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function syncThemeIcons() {
    var dark = currentTheme() === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-label", dark ? "切换到浅色模式" : "切换到深色模式");
      var sun = btn.querySelector("[data-icon=sun]");
      var moon = btn.querySelector("[data-icon=moon]");
      if (sun) sun.style.display = dark ? "none" : "block";
      if (moon) moon.style.display = dark ? "block" : "none";
    });
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("kimon-theme", next); } catch (e) {}
      syncThemeIcons();
      if (!reduceMotion) spawnRipple(btn);
    });
  });
  syncThemeIcons();

  function spawnRipple(el) {
    var r = document.createElement("span");
    var rect = el.getBoundingClientRect();
    /* 固定尺寸 + transform scale，避免逐帧改 width/height/margin 反复触发布局 */
    r.style.cssText =
      "position:absolute;left:50%;top:50%;width:90px;height:90px;margin:-45px 0 0 -45px;" +
      "border-radius:50%;background:radial-gradient(circle,var(--accent-soft),transparent 70%);" +
      "pointer-events:none;transform:scale(.1);opacity:1;will-change:transform,opacity;" +
      "animation:rippleOut .6s cubic-bezier(.22,1,.36,1) forwards;";
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.appendChild(r);
    setTimeout(function () { r.remove(); }, 650);
  }

  if (!document.getElementById("ripple-kf")) {
    var st = document.createElement("style");
    st.id = "ripple-kf";
    st.textContent =
      "@keyframes rippleOut{to{transform:scale(1);opacity:0}}";
    document.head.appendChild(st);
  }

  /* ---------- mobile nav ---------- */
  var navToggle = document.querySelector("[data-nav-toggle]");
  var nav = document.querySelector(".nav");
  if (navToggle && nav) {
    if (!nav.id) nav.id = "site-nav";
    navToggle.setAttribute("aria-controls", nav.id);
    navToggle.setAttribute("aria-expanded", "false");

    function navOpen() { return nav.classList.contains("open"); }
    function setNav(open) {
      nav.classList.toggle("open", open);
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      /* 打开后把焦点送进菜单，键盘 / 读屏用户不用再摸一遍 */
      if (open) {
        var first = nav.querySelector("a");
        if (first) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
      }
    }

    navToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      setNav(!navOpen());
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") setNav(false);
    });
    /* Esc 关闭并把焦点还给菜单按钮；点菜单外同样收起 */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && navOpen()) {
        setNav(false);
        try { navToggle.focus({ preventScroll: true }); } catch (e2) { navToggle.focus(); }
      }
    });
    document.addEventListener("click", function (e) {
      if (!navOpen()) return;
      if (nav.contains(e.target) || navToggle.contains(e.target)) return;
      setNav(false);
    });
  }

  /* ---------- header scroll state ---------- */
  var header = document.querySelector(".site-header");
  if (header) {
    var headerTicking = false;
    var onHeader = function () {
      if (headerTicking) return;
      headerTicking = true;
      requestAnimationFrame(function () {
        headerTicking = false;
        header.classList.toggle("scrolled", window.scrollY > 12);
      });
    };
    window.addEventListener("scroll", onHeader, { passive: true });
    onHeader();
  }

  /* ---------- footer year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- ambient parallax ---------- */
  var ambient = document.querySelector(".ambient");
  if (ambient && !reduceMotion) {
    var mx = 0, my = 0, tx = 0, ty = 0, ticking = false;

    document.addEventListener("mousemove", function (e) {
      mx = (e.clientX / window.innerWidth - 0.5) * 2;
      my = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!ticking) { ticking = true; requestAnimationFrame(loop); }
    }, { passive: true });

    function loop() {
      tx += (mx * 26 - tx) * 0.08;
      ty += (my * 22 - ty) * 0.08;
      ambient.style.setProperty("--px", tx.toFixed(2) + "px");
      ambient.style.setProperty("--py", ty.toFixed(2) + "px");
      if (Math.abs(mx * 26 - tx) > 0.4 || Math.abs(my * 22 - ty) > 0.4) {
        requestAnimationFrame(loop);
      } else {
        ticking = false;
      }
    }
  }

  /* ---------- glass specular sheen + scroll reveal ----------
     动态渲染出来的卡片（评论、留言、GitHub 项目等）也要套同一套动效，
     所以统一收成 enhanceMotion(root)，由各模块在渲染完成后调用。 */
  var SHEEN = [
    ".post-card", ".quick-item", ".res-card", ".note-card", ".mini-card",
    ".featured-main", ".gallery-teaser", ".gallery-card", ".side-card", ".gb-item", ".pager a",
    ".btn", ".pin-badge", ".link-card", ".diary-card", ".gh-card", ".gb-note",
    ".gb-form .field", ".search-input"
  ].join(",");

  var REVEAL = [
    ".section-head", ".post-card", ".quick-item", ".res-card", ".note-card",
    ".mini-card", ".featured-main", ".gallery-teaser", ".gallery-card", ".side-card", ".row-item",
    ".arch-item", ".link-card", ".note-card", ".pager a", ".notice",
    ".article-head", ".guestbook-grid > *", ".diary-item", ".gb-note"
  ].join(",");

  var canHover = window.matchMedia("(hover: hover)").matches;
  var revealIO = null;
  if (!reduceMotion && "IntersectionObserver" in window) {
    revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealIO.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  }

  function bindSheen(el) {
    if (reduceMotion || !canHover || el._kimonSheen) return;
    el._kimonSheen = true;
    el.classList.add("sheen");
    el.addEventListener("mousemove", function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty("--mx", (e.clientX - r.left) + "px");
      el.style.setProperty("--my", (e.clientY - r.top) + "px");
    }, { passive: true });
  }

  function bindReveal(el, delay) {
    if (reduceMotion || !revealIO || el._kimonReveal) return;
    el._kimonReveal = true;
    el.classList.add("reveal");
    if (delay) el.style.transitionDelay = delay + "ms";
    revealIO.observe(el);
  }

  /* staggered=true 时按同级顺序加一点出现延迟，只用于首屏整批绑定 */
  function enhanceMotion(root, staggered) {
    root = root || document;
    if (reduceMotion) return;
    var els = Array.prototype.slice.call(root.querySelectorAll(SHEEN));
    els.forEach(bindSheen);

    els = Array.prototype.slice.call(root.querySelectorAll(REVEAL));
    var counters = staggered ? new Map() : null;
    els.forEach(function (el) {
      if (el._kimonReveal) return;
      var delay = 0;
      if (counters) {
        var parent = el.parentElement;
        var n = counters.get(parent) || 0;
        counters.set(parent, n + 1);
        delay = Math.min(n, 6) * 65;
      }
      bindReveal(el, delay);
    });
  }

  var KAPI = window.KIMON || (window.KIMON = {});
  KAPI.enhanceMotion = function (root) { enhanceMotion(root || document, false); };

  enhanceMotion(document, true);

  window.addEventListener("load", function () {
    enhanceMotion(document, false);
    if (!revealIO) return;
    /* 首屏已经可见的元素直接进场，避免等滚动才出现 */
    var visible = Array.prototype.slice.call(document.querySelectorAll(REVEAL)).filter(function (el) {
      return el.classList.contains("reveal") && !el.classList.contains("in");
    });
    visible.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) el.classList.add("in");
    });
  });

  /* ---------- archive filter + search ---------- */
  var archiveRoot = document.querySelector("[data-archive]");
  if (archiveRoot) {
    var items = Array.prototype.slice.call(archiveRoot.querySelectorAll("[data-item]"));
    var chips = Array.prototype.slice.call(document.querySelectorAll("[data-filter]"));
    var search = document.querySelector("[data-search]");
    var empty = document.querySelector("[data-empty]");
    var tagButtons = Array.prototype.slice.call(document.querySelectorAll("[data-tag]"));
    var activeCat = "all";

    function applyFilter() {
      var q = (search && search.value.trim().toLowerCase()) || "";
      var visible = 0;

      items.forEach(function (el) {
        var cat = el.getAttribute("data-cat") || "";
        var tags = el.getAttribute("data-tags") || "";
        var text = (el.textContent || "").toLowerCase();
        /* 点标签时 activeCat 是 "tag:xxx"，不能再拿它跟分类名比，否则一条都不显示 */
        var isTag = activeCat.indexOf("tag:") === 0;
        var okCat = isTag || activeCat === "all" || cat === activeCat;
        /* 标签用精确匹配：按空格拆开后逐个比对，避免 "java" 命中 "javascript" */
        var tagName = isTag ? activeCat.slice(4) : "";
        var okTag = !isTag || tags.split(/\s+/).indexOf(tagName) > -1;
        var okText = q === "" || text.indexOf(q) > -1;
        var show = okCat && okTag && okText;
        el.style.display = show ? "" : "none";
        if (show) visible++;
      });

      archiveRoot.querySelectorAll("[data-year-group]").forEach(function (group) {
        var any = group.querySelectorAll('[data-item]:not([style*="display: none"])').length;
        group.style.display = any ? "" : "none";
      });

      if (empty) empty.classList.toggle("show", visible === 0);
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        activeCat = chip.getAttribute("data-filter");
        chips.forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        tagButtons.forEach(function (t) { t.classList.remove("active"); });
        applyFilter();
      });
    });

    tagButtons.forEach(function (tag) {
      tag.addEventListener("click", function () {
        activeCat = "tag:" + tag.getAttribute("data-tag");
        chips.forEach(function (c) { c.classList.remove("active"); });
        tagButtons.forEach(function (t) { t.classList.remove("active"); });
        tag.classList.add("active");
        applyFilter();
      });
    });

    if (search) search.addEventListener("input", applyFilter);
  }

  /* ---------- reading progress ----------
     用合成层的 scaleX，不再逐帧改 width；scroll 回调统一 rAF 节流 */
  var progress = document.querySelector("[data-progress]");
  if (progress) {
    var progressTicking = false;
    var updateProgress = function () {
      if (progressTicking) return;
      progressTicking = true;
      requestAnimationFrame(function () {
        progressTicking = false;
        var h = document.documentElement.scrollHeight - window.innerHeight;
        var pct = h > 0 ? window.scrollY / h : 0;
        progress.style.transform = "scaleX(" + Math.min(1, Math.max(0, pct)).toFixed(4) + ")";
      });
    };
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress, { passive: true });
    updateProgress();
  }

  /* ---------- toc active ----------
     标题位置只在加载 / 尺寸变化时测一次，滚动时只做数值比较，避免每帧读布局 */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll("[data-toc] a"));
  if (tocLinks.length) {
    var headings = tocLinks
      .map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); })
      .filter(Boolean);
    var tocOffsets = [];

    function measureToc() {
      tocOffsets = headings.map(function (h) {
        return h.getBoundingClientRect().top + window.scrollY;
      });
    }

    var tocTicking = false;
    var onTocScroll = function () {
      if (tocTicking) return;
      tocTicking = true;
      requestAnimationFrame(function () {
        tocTicking = false;
        var offset = window.scrollY + 130;
        var idx = 0;
        for (var i = 0; i < tocOffsets.length; i++) {
          if (tocOffsets[i] <= offset) idx = i;
        }
        var current = headings[idx];
        tocLinks.forEach(function (a) {
          a.classList.toggle("active", !!current && a.getAttribute("href") === "#" + current.id);
        });
      });
    };

    window.addEventListener("scroll", onTocScroll, { passive: true });
    window.addEventListener("resize", function () { measureToc(); onTocScroll(); }, { passive: true });
    window.addEventListener("load", measureToc);
    measureToc();
    onTocScroll();
  }

  /* ---------- guestbook ----------
     留言只走后端：连不上时 remote.js 已整页跳到 offline.html，
     这里不再有任何本地演示留言 / 假种子数据。 */
  var gb = document.querySelector("[data-guestbook]");
  var K = window.KIMON || {};
  if (gb && K.remote && K.mountGuestbook) {
    K.mountGuestbook(gb);
    /* 便签是挂载后渲染出来的，补一次动效绑定 */
    if (K.enhanceMotion) K.enhanceMotion(gb);
  }

})();
