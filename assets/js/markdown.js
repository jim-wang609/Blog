/* ============================================================
   Kimon's Blog - 轻量 Markdown 渲染（零依赖，前后台共用）

   文章正文在数据库里存 Markdown；前台文章页与后台编辑器的实时预览
   都用这里的 mdToHtml 渲染。原始 HTML 一律转义，避免正文注入脚本。
   支持：标题、段落、粗体/斜体/删除线、行内代码、围栏代码块、
   引用、有序/无序列表、链接、图片（独立成行时带图注）、表格、分割线。
   ============================================================ */
(function () {
  "use strict";

  var K = (window.KIMON = window.KIMON || {});

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* 只放行安全协议和站内相对路径，挡住 javascript: / data: 之类 */
  function safeUrl(u) {
    u = String(u || "").trim();
    if (/^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(u)) return u;
    if (/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.~/-]*)?(?:[?#][^\s]*)?$/.test(u)) return u;
    return "";
  }

  function inline(text) {
    var codes = [];
    var s = esc(text);

    /* 先把行内代码摘出来占位，避免里面的 * _ [ 被当作语法 */
    s = s.replace(/`([^`\n]+)`/g, function (m, c) {
      codes.push("<code>" + c + "</code>");
      return "\u0001" + (codes.length - 1) + "\u0001";
    });

    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, alt, url) {
      var u = safeUrl(url);
      return u ? '<img src="' + u + '" alt="' + alt + '">' : alt;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, label, url) {
      var u = safeUrl(url);
      return u ? '<a href="' + u + '" target="_blank" rel="noopener">' + label + "</a>" : label;
    });

    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

    return s.replace(/\u0001(\d+)\u0001/g, function (m, i) { return codes[Number(i)]; });
  }

  function isBlockStart(l) {
    return /^\s{0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```)/.test(l) ||
           /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  }

  function mdToHtml(src) {
    var lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
    var out = [], i = 0, n = lines.length;

    while (i < n) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }

      var fence = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
      if (fence) {
        var buf = [], j = i + 1;
        while (j < n && !/^\s*```\s*$/.test(lines[j])) { buf.push(lines[j]); j++; }
        var cls = fence[1] ? ' class="lang-' + esc(fence[1]) + '"' : "";
        out.push("<pre><code" + cls + ">" + esc(buf.join("\n")) + "</code></pre>");
        i = j + 1;
        continue;
      }

      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        out.push("<hr>"); i++; continue;
      }

      var h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) {
        var lv = h[1].length;
        out.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">");
        i++; continue;
      }

      var img = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
      if (img) {
        var iu = safeUrl(img[2]);
        out.push(iu
          ? '<figure><img src="' + iu + '" alt="' + esc(img[1]) + '">' +
            (img[1] ? "<figcaption>" + esc(img[1]) + "</figcaption>" : "") + "</figure>"
          : "<p>" + inline(line) + "</p>");
        i++; continue;
      }

      if (/^\s{0,3}>\s?/.test(line)) {
        var quote = [];
        while (i < n && /^\s{0,3}>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
          i++;
        }
        out.push("<blockquote>" + inline(quote.join("\n")).replace(/\n/g, "<br>") + "</blockquote>");
        continue;
      }

      if (/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
        var ordered = /^\s{0,3}\d+[.)]\s+/.test(line);
        var items = [];
        while (i < n && /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[i])) {
          items.push(lines[i].replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/, ""));
          i++;
        }
        var tag = ordered ? "ol" : "ul";
        out.push("<" + tag + ">" + items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</" + tag + ">");
        continue;
      }

      /* 表头 + |---|---| 分隔行 */
      if (line.indexOf("|") >= 0 && i + 1 < n &&
          lines[i + 1].indexOf("-") >= 0 && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        var cells = function (l) {
          return l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|")
            .map(function (s) { return s.trim(); });
        };
        var head = cells(line);
        i += 2;
        var rows = [];
        while (i < n && lines[i].indexOf("|") >= 0 && lines[i].trim()) {
          rows.push(cells(lines[i])); i++;
        }
        out.push('<table><thead><tr>' + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" + rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table>");
        continue;
      }

      var para = [];
      while (i < n && lines[i].trim() && !isBlockStart(lines[i])) {
        para.push(lines[i]); i++;
      }
      if (!para.length) { para.push(lines[i]); i++; }
      out.push("<p>" + para.map(inline).join("<br>") + "</p>");
    }

    return out.join("\n");
  }

  K.mdToHtml = mdToHtml;
  K.mdEscape = esc;
})();
