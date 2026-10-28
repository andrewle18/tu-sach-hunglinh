/* Chuyển sang EPUB: chạy hoàn toàn trong trình duyệt, file không rời khỏi máy người dùng.
   Đầu vào: DOCX, MD, TXT, HTML, FB2, PDF (có chữ). Đầu ra: EPUB 3 kèm mục lục EPUB 2 cho máy đọc cũ. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var XHTML_NS = "http://www.w3.org/1999/xhtml";
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "assets/vendor/pdf.worker.min.js";

  var state = { files: [], meta: { title: "", author: "", lang: "vi" }, metaTouched: {}, book: null, titleEdits: {}, cover: null };

  /* ---------------- tiện ích ---------------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name); return m ? m[1].toLowerCase() : ""; }
  function baseName(name) { return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim(); }
  function stripAccents(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D"); }
  function slugify(s) { return stripAccents(s).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "sach"; }
  function wordCount(s) { return (String(s).match(/[^\s]+/g) || []).length; }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.from(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  var statusEl = null;
  function status(msg) { if (statusEl) statusEl.textContent = msg || ""; }
  function decodeText(ab) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(ab).replace(/^﻿/, ""); }
    catch (e) {
      try { return new TextDecoder("windows-1258").decode(ab); } catch (e2) { return new TextDecoder("windows-1252").decode(ab); }
    }
  }
  function textEsc(s) { return esc(s).replace(/ /g, " "); }

  /* ---------------- đọc từng định dạng → HTML ---------------- */
  var READERS = {
    docx: async function (file) {
      var ab = await file.arrayBuffer();
      var meta = {};
      try {
        var z = await JSZip.loadAsync(ab), core = z.file("docProps/core.xml");
        if (core) {
          var x = new DOMParser().parseFromString(await core.async("string"), "application/xml");
          var t = x.getElementsByTagNameNS("*", "title")[0], c = x.getElementsByTagNameNS("*", "creator")[0];
          if (t && t.textContent.trim()) meta.title = t.textContent.trim();
          if (c && c.textContent.trim()) meta.author = c.textContent.trim();
        }
      } catch (e) {}
      var res = await mammoth.convertToHtml({ arrayBuffer: ab }, {
        styleMap: ["p[style-name='Title'] => h1.doc-title:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh",
                   "p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Intense Quote'] => blockquote > p:fresh"]
      });
      return { html: res.value, meta: meta };
    },
    md: async function (file) {
      var t = decodeText(await file.arrayBuffer());
      var meta = {};
      var fm = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(t);
      if (fm) {
        var tm = /^title:\s*(.+)$/m.exec(fm[1]), am = /^author:\s*(.+)$/m.exec(fm[1]);
        if (tm) meta.title = tm[1].replace(/^["']|["']$/g, "").trim();
        if (am) meta.author = am[1].replace(/^["']|["']$/g, "").trim();
        t = t.slice(fm[0].length);
      }
      return { html: marked.parse(t), meta: meta };
    },
    txt: async function (file) {
      var t = decodeText(await file.arrayBuffer()).replace(/\r\n?/g, "\n");
      var lines = t.split("\n"), blanks = lines.filter(function (l) { return !l.trim(); }).length;
      var paras;
      if (blanks > lines.length / 12) {
        paras = [];
        t.split(/\n\s*\n/).forEach(function (block) {
          var buf = [];
          block.split("\n").map(function (l) { return l.trim(); }).filter(Boolean).forEach(function (l) {
            // dòng "Chương 1…" dính liền đoạn văn phía trên: tách ra thành đoạn riêng
            if (l.length <= 120 && (PART_RE.test(l) || CHAP_RE.test(l) || FRONT_RE.test(l))) { if (buf.length) paras.push(buf.join(" ")); paras.push(l); buf = []; }
            else buf.push(l);
          });
          if (buf.length) paras.push(buf.join(" "));
        });
      } else {
        paras = lines.map(function (l) { return l.trim(); });
      }
      return { html: paras.filter(Boolean).map(function (p) { return "<p>" + textEsc(p) + "</p>"; }).join("\n"), meta: {} };
    },
    html: async function (file) {
      var doc = new DOMParser().parseFromString(decodeText(await file.arrayBuffer()), "text/html");
      var meta = {};
      if (doc.title) meta.title = doc.title.trim();
      var a = doc.querySelector('meta[name="author"]'); if (a && a.content) meta.author = a.content.trim();
      return { html: doc.body ? doc.body.innerHTML : "", meta: meta };
    },
    fb2: async function (file) {
      var x = new DOMParser().parseFromString(decodeText(await file.arrayBuffer()), "application/xml");
      if (x.querySelector("parsererror")) throw new Error("File FB2 bị lỗi cấu trúc.");
      var q = function (el, name) { return Array.prototype.filter.call(el.children, function (c) { return c.localName === name; }); };
      var meta = {};
      var ti = x.getElementsByTagNameNS("*", "title-info")[0];
      if (ti) {
        var bt = ti.getElementsByTagNameNS("*", "book-title")[0]; if (bt) meta.title = bt.textContent.trim();
        var au = ti.getElementsByTagNameNS("*", "author")[0];
        if (au) meta.author = ["first-name", "middle-name", "last-name"].map(function (n) { var e = au.getElementsByTagNameNS("*", n)[0]; return e ? e.textContent.trim() : ""; }).filter(Boolean).join(" ");
      }
      var bins = {};
      Array.prototype.forEach.call(x.getElementsByTagNameNS("*", "binary"), function (b) { bins[b.getAttribute("id")] = "data:" + (b.getAttribute("content-type") || "image/jpeg") + ";base64," + b.textContent.replace(/\s+/g, ""); });
      function inline(el) {
        var out = "";
        el.childNodes.forEach(function (n) {
          if (n.nodeType === 3) { out += textEsc(n.nodeValue); return; }
          if (n.nodeType !== 1) return;
          var tag = { emphasis: "em", strong: "strong", strikethrough: "s", sub: "sub", sup: "sup", code: "code" }[n.localName];
          if (tag) out += "<" + tag + ">" + inline(n) + "</" + tag + ">";
          else if (n.localName === "a") { var h = n.getAttributeNS("http://www.w3.org/1999/xlink", "href") || n.getAttribute("l:href") || ""; out += h.charAt(0) === "#" ? '<a href="' + esc(h) + '">' + inline(n) + "</a>" : inline(n); }
          else out += inline(n);
        });
        return out;
      }
      function block(el, depth) {
        var out = "";
        Array.prototype.forEach.call(el.children, function (c) {
          var n = c.localName, id = c.getAttribute("id"), idA = id ? ' id="' + esc(id) + '"' : "";
          if (n === "title") { var lv = Math.min(3, depth); out += "<h" + lv + idA + ">" + q(c, "p").map(inline).join(" ") + "</h" + lv + ">"; }
          else if (n === "section") out += block(c, depth + 1);
          else if (n === "p") out += "<p" + idA + ">" + inline(c) + "</p>";
          else if (n === "subtitle") out += "<h" + Math.min(4, depth + 1) + ">" + inline(c) + "</h" + Math.min(4, depth + 1) + ">";
          else if (n === "epigraph" || n === "cite") out += "<blockquote>" + block(c, depth) + "</blockquote>";
          else if (n === "poem") out += '<div class="poem">' + block(c, depth) + "</div>";
          else if (n === "stanza") out += "<p>" + q(c, "v").map(inline).join("<br/>") + "</p>";
          else if (n === "text-author") out += '<p class="right"><em>' + inline(c) + "</em></p>";
          else if (n === "image") { var h = (c.getAttributeNS("http://www.w3.org/1999/xlink", "href") || c.getAttribute("l:href") || "").replace(/^#/, ""); if (bins[h]) out += '<figure><img src="' + bins[h] + '" alt=""/></figure>'; }
          else if (n === "empty-line") out += "";
          else if (n === "table") out += "<table>" + block(c, depth) + "</table>";
          else if (n === "tr") out += "<tr>" + Array.prototype.map.call(c.children, function (td) { return "<" + (td.localName === "th" ? "th" : "td") + ">" + inline(td) + "</" + (td.localName === "th" ? "th" : "td") + ">"; }).join("") + "</tr>";
        });
        return out;
      }
      var html = "";
      Array.prototype.forEach.call(x.getElementsByTagNameNS("*", "body"), function (b) {
        if (b.getAttribute("name") === "notes") html += "<h1>Chú thích</h1>";
        html += block(b, 1);
      });
      return { html: html, meta: meta };
    },
    pdf: async function (file, onProgress) {
      if (!window.pdfjsLib) throw new Error("Chưa tải được bộ đọc PDF.");
      var pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      var meta = {};
      try { var info = (await pdf.getMetadata()).info || {}; if (info.Title && !/^(untitled|microsoft word)/i.test(info.Title)) meta.title = info.Title.trim(); if (info.Author) meta.author = info.Author.trim(); } catch (e) {}
      var pages = [], chars = 0;
      for (var p = 1; p <= pdf.numPages; p++) {
        if (onProgress) onProgress("Đang đọc trang " + p + "/" + pdf.numPages + " của " + file.name);
        var page = await pdf.getPage(p), tc = await page.getTextContent();
        var items = tc.items.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
          var h = Math.abs(it.transform[3]) || Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
          return { s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: h };
        });
        items.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });
        var lines = [];
        items.forEach(function (it) {
          var L = lines[lines.length - 1];
          if (L && Math.abs(L.y - it.y) < Math.max(2, it.h * 0.45)) {
            var gap = it.x - L.xe;
            L.t += (gap > it.h * 0.15 && !/\s$/.test(L.t) && !/^\s/.test(it.s) ? " " : "") + it.s;
            L.xe = it.x + it.w; L.h = Math.max(L.h, it.h);
          } else lines.push({ t: it.s, y: it.y, x: it.x, xe: it.x + it.w, h: it.h, page: p });
        });
        lines.forEach(function (l) { l.t = l.t.replace(/\s+/g, " ").trim(); chars += l.t.length; });
        pages.push(lines.filter(function (l) { return l.t; }));
      }
      if (chars < 40 * pdf.numPages) throw new Error("PDF “" + file.name + "” gần như không có chữ, có thể là bản scan ảnh. Trang này chưa nhận dạng được chữ từ ảnh.");
      // bỏ các trang mục lục in sẵn (nhiều dòng kết thúc bằng số trang)
      pages = pages.map(function (ls, pi) {
        if (pi > Math.max(12, pages.length * 0.15) && pi < pages.length - 8) return ls;
        var withNum = ls.filter(function (l) { return /\S\s+\d{1,4}$/.test(l.t) && l.t.length < 160; }).length;
        return (withNum >= 5 && withNum >= ls.length * 0.4) ? [] : ls;
      });
      // bỏ đầu trang, chân trang lặp lại và số trang
      var key = function (t) { return t.replace(/\d+/g, "#").toLowerCase(); };
      var freq = {};
      pages.forEach(function (ls) { ls.slice(0, 2).concat(ls.slice(-2)).forEach(function (l) { var k = key(l.t); freq[k] = (freq[k] || 0) + 1; }); });
      var limit = Math.max(3, pages.length * 0.4);
      var all = [];
      pages.forEach(function (ls) {
        ls.forEach(function (l, i) {
          var edge = i < 2 || i >= ls.length - 2;
          if (/^[-–—\s]*(trang\s*)?\d{1,4}[-–—\s]*$/i.test(l.t)) return;
          if (/(\.\s?){4,}\s*\d{1,4}\s*$/.test(l.t) || /\s\.{2,}\s*\d{1,4}$/.test(l.t)) return;
          if (edge && freq[key(l.t)] >= limit) return;
          all.push(l);
        });
      });
      if (!all.length) return { html: "", meta: meta };
      var sizes = all.map(function (l) { return l.h; }).sort(function (a, b) { return a - b; });
      var med = sizes[Math.floor(sizes.length / 2)] || 10;
      var lens = all.filter(function (l) { return Math.abs(l.h - med) < 0.5; }).map(function (l) { return l.xe - l.x; }).sort(function (a, b) { return a - b; });
      var fullW = lens[Math.floor(lens.length * 0.8)] || 400;
      var lefts = all.filter(function (l) { return Math.abs(l.h - med) < 0.5; }).map(function (l) { return l.x; }).sort(function (a, b) { return a - b; });
      var leftM = lefts[Math.floor(lefts.length * 0.1)] || 0;
      var out = [], para = null;
      function flush() { if (para) { out.push("<p>" + textEsc(para) + "</p>"); para = null; } }
      for (var i = 0; i < all.length; i++) {
        var l = all[i], prev = all[i - 1];
        if (l.h >= med * 1.12 && l.t.length <= 120 && !/^\d+$/.test(l.t)) {
          flush();
          var lv = l.h >= med * 1.6 ? 1 : l.h >= med * 1.25 ? 2 : 3;
          var nxt = all[i + 1];
          // tiêu đề xuống hai dòng
          while (nxt && Math.abs(nxt.h - l.h) < 0.5 && nxt.page === l.page && (l.y - nxt.y) < l.h * 2 && (l.t + nxt.t).length < 160) { l = { t: l.t + " " + nxt.t, h: l.h, page: l.page, y: nxt.y }; i++; nxt = all[i + 1]; }
          out.push("<h" + lv + ">" + textEsc(l.t) + "</h" + lv + ">");
          continue;
        }
        var newPara = !para;
        if (para && prev) {
          var samePage = prev.page === l.page, gap = prev.y - l.y;
          var prevShort = (prev.xe - prev.x) < fullW * 0.8 && /[.!?:…"”»)]$/.test(prev.t);
          var c0 = l.t.charAt(0);
          var lonely = (prev.xe - prev.x) < fullW * 0.6 && !/[,;]$/.test(prev.t) && c0 === c0.toUpperCase() && c0 !== c0.toLowerCase() && para === prev.t;
          var indented = l.x - leftM > med * 1.2 && Math.abs(l.h - med) < 0.5;
          if (samePage && gap > prev.h * 1.9) newPara = true;
          else if (prevShort || lonely) newPara = true;
          else if (indented && /[.!?:…"”»)]$/.test(prev.t)) newPara = true;
          else if (!samePage && /[.!?…"”»]$/.test(prev.t) && indented) newPara = true;
        }
        if (newPara) { flush(); para = l.t; }
        else if (/[A-Za-zÀ-ỹ]-$/.test(para) && /^[a-zà-ỹ]/.test(l.t)) para = para.slice(0, -1) + l.t;
        else para += " " + l.t;
      }
      flush();
      return { html: out.join("\n"), meta: meta };
    }
  };
  READERS.markdown = READERS.md; READERS.htm = READERS.html; READERS.xhtml = READERS.html; READERS.text = READERS.txt;

  /* ---------------- chuẩn hoá HTML ---------------- */
  var NUM = "(?:\\d+|thứ\\s+\\S+|một|hai|ba|bốn|tư|năm|sáu|bảy|tám|chín|mười(?:\\s+\\S+)?|[ivxlcdm]+)";
  // "Phần I. Tên", "PHẦN MỘT: …", "Chương 3 Con chim non" là tiêu đề; "Phần thứ bảy không bao giờ đến" thì không.
  function headRe(words) {
    var re = new RegExp("^\\s*(" + words + ")\\s+" + NUM, "i");
    return { test: function (t) {
      var m = re.exec(t); if (!m) return false;
      var rest = t.slice(m[0].length);
      if (!rest.trim()) return true;
      if (/^\s*[.:·\-–—)]/.test(rest)) return true;
      var c = rest.replace(/^\s+["“«(']?/, "").charAt(0);
      return /^\s/.test(rest) && c && c === c.toUpperCase() && c !== c.toLowerCase();
    } };
  }
  var PART_RE = headRe("phần|quyển|tập|part|book");
  var CHAP_RE = headRe("chương|chuong|chapter|hồi|bài|tiết");
  var FRONT_RE = /^\s*(lời (nói đầu|mở đầu|giới thiệu|tựa|bạt|cảm ơn|cám ơn|kết|dẫn|tác giả|người dịch)|mở đầu|dẫn nhập|tựa|phần kết|kết luận|vĩ thanh|phụ lục(\s+\S+)?|tài liệu tham khảo|thư mục|chú thích|preface|introduction|prologue|epilogue|foreword|afterword|acknowledg(e)?ments|appendix(\s+\S+)?|bibliography|notes)\s*[.:]?\s*$/i;
  var ALLOWED = "p,h1,h2,h3,h4,h5,h6,em,strong,b,i,u,s,sub,sup,a,img,ul,ol,li,blockquote,pre,code,br,hr,table,thead,tbody,tfoot,tr,th,td,caption,figure,figcaption,span,div,section,dl,dt,dd,small,mark,q,cite,abbr".split(",");
  var DROP = ["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "noscript", "svg", "canvas", "video", "audio", "link", "meta", "head", "title", "nav"];
  var ATTRS = { id: 1, class: 1, href: 1, src: 1, alt: 1, title: 1, colspan: 1, rowspan: 1, lang: 1 };

  function clean(root) {
    DROP.forEach(function (t) { root.querySelectorAll(t).forEach(function (e) { e.remove(); }); });
    root.querySelectorAll("*").forEach(function (el) {
      Array.from(el.attributes).forEach(function (a) { if (!ATTRS[a.name]) el.removeAttribute(a.name); });
    });
    Array.from(root.querySelectorAll("*")).reverse().forEach(function (el) {
      var t = el.localName;
      if (ALLOWED.indexOf(t) < 0) { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); }
      else if (t === "span" && !el.attributes.length) { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); }
    });
    root.querySelectorAll("a").forEach(function (a) { var h = a.getAttribute("href"); if (h && /^\s*javascript:/i.test(h)) a.removeAttribute("href"); });
    root.querySelectorAll("p").forEach(function (p) { if (!p.textContent.trim() && !p.querySelector("img")) p.remove(); });
  }
  function flatten(root) {
    var changed = true;
    while (changed) {
      changed = false;
      Array.from(root.children).forEach(function (el) {
        if (/^(div|section)$/.test(el.localName) && el.querySelector("h1,h2,h3")) {
          while (el.firstChild) root.insertBefore(el.firstChild, el); el.remove(); changed = true;
        }
      });
    }
  }
  function retag(el, tag) {
    var n = el.ownerDocument.createElement(tag);
    if (el.id) n.id = el.id;
    while (el.firstChild) n.appendChild(el.firstChild);
    el.replaceWith(n); return n;
  }
  // Nhận tiêu đề "Phần…", "Chương…", "Lời nói đầu"… trong các đoạn văn thường.
  function detectHeadings(root) {
    var parts = 0;
    Array.from(root.children).forEach(function (el) {
      if (el.localName !== "p") return;
      var t = el.textContent.replace(/\s+/g, " ").trim();
      if (!t || t.length > 120) return;
      if (PART_RE.test(t)) { el.dataset.kind = "part"; parts++; }
      else if (CHAP_RE.test(t)) el.dataset.kind = "chap";
      else if (FRONT_RE.test(t)) el.dataset.kind = "front";
    });
    // Tiêu đề chương thường tách làm hai dòng: "Chương 1" rồi dòng tên chương.
    root.querySelectorAll("p[data-kind]").forEach(function (el) {
      var nx = el.nextElementSibling;
      if (nx && nx.localName === "p" && !nx.dataset.kind && /^\s*\S+\s+\S+\s*[.:]?\s*$/.test(el.textContent) && nx.textContent.trim().length <= 90 && !/[.!?…]$/.test(nx.textContent.trim())) {
        el.appendChild(el.ownerDocument.createTextNode(". " + nx.textContent.trim())); nx.remove();
      }
    });
    root.querySelectorAll("p[data-kind]").forEach(function (el) {
      var k = el.dataset.kind;
      retag(el, k === "part" ? "h1" : (parts ? "h2" : "h1"));
    });
  }

  /* ---------------- dựng cuốn sách ---------------- */
  async function buildBook(onProgress) {
    var doc = document.implementation.createHTMLDocument("x");
    var root = doc.createElement("div"); doc.body.appendChild(root);
    var autoMeta = {}, warnings = [];
    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i], r = READERS[ext(f.name)];
      if (!r) { warnings.push("Bỏ qua “" + f.name + "”: định dạng chưa hỗ trợ."); continue; }
      onProgress && onProgress("Đang đọc " + f.name + "…");
      var res = await r(f, onProgress);
      if (res.meta) Object.keys(res.meta).forEach(function (k) { if (/\uFFFD/.test(res.meta[k] || "")) delete res.meta[k]; });
      var part = doc.createElement("div");
      part.innerHTML = res.html;
      clean(part); flatten(part);
      part.querySelectorAll("h1.doc-title").forEach(function (h) {
        var t = h.textContent.replace(/\s+/g, " ").trim();
        if (i === 0 && t && !/\uFFFD/.test(t) && !(res.meta && res.meta.title)) { res.meta = res.meta || {}; res.meta.title = t; }
        h.remove();
      });
      if (i === 0) autoMeta = res.meta || {};
      detectHeadings(part);
      if (state.files.length > 1 && !part.querySelector("h1,h2")) {
        var h = doc.createElement("h1"); h.textContent = (res.meta && res.meta.title) || baseName(f.name); part.insertBefore(h, part.firstChild);
      }
      while (part.firstChild) root.appendChild(part.firstChild);
    }
    flatten(root);
    // Tiêu đề sách lặp lại ở đầu (Title trong Word) thì bỏ, để không thành một chương rỗng.
    var first = root.firstElementChild;
    var title = state.meta.title || autoMeta.title || (state.files[0] ? baseName(state.files[0].name) : "Sách mới");
    var cands = [title, autoMeta.title, state.files[0] ? baseName(state.files[0].name) : ""].filter(Boolean).map(function (t) { return t.trim().toLowerCase(); });
    if (first && /^h[12]$/.test(first.localName) && cands.indexOf(first.textContent.replace(/\s+/g, " ").trim().toLowerCase()) >= 0) {
      first.remove();
      var sub = root.firstElementChild;
      if (sub && sub.localName === "p" && sub.className === "subtitle") sub.remove();
    }

    // Chỉ một tiêu đề cấp 1 nằm ngay đầu, còn lại là cấp 2: đó là tên sách, không phải chương.
    var onlyH1 = root.querySelectorAll(":scope > h1");
    if (onlyH1.length === 1 && root.firstElementChild === onlyH1[0] && root.querySelectorAll(":scope > h2").length >= 2) {
      var tt = onlyH1[0].textContent.replace(/\s+/g, " ").trim();
      if (!autoMeta.title && tt && !/\uFFFD/.test(tt)) autoMeta.title = tt;
      onlyH1[0].remove();
    }
    // chọn cấp chia chương
    var h1s = root.querySelectorAll(":scope > h1").length, h2s = root.querySelectorAll(":scope > h2").length;
    var partsMode = Array.from(root.querySelectorAll(":scope > h1")).some(function (h) { return PART_RE.test(h.textContent.trim()); }) && h2s > 0;
    var splitAt = partsMode ? ["h1", "h2"] : h1s ? ["h1"] : h2s ? ["h2"] : [];
    var subLevel = partsMode ? null : (h1s ? "h2" : h2s ? "h3" : null);

    // id hợp lệ, duy nhất
    var used = {}, idMap = {};
    root.querySelectorAll("[id]").forEach(function (el) {
      var old = el.id, nid = old.replace(/[^A-Za-z0-9_.-]/g, "_");
      if (!/^[A-Za-z_]/.test(nid)) nid = "id_" + nid;
      var base = nid, k = 1; while (used[nid]) nid = base + "_" + (k++);
      used[nid] = 1; idMap[old] = nid; el.id = nid;
    });
    var hid = 0;
    function ensureId(el) { if (!el.id) { var n; do { n = "h" + (++hid); } while (used[n]); used[n] = 1; el.id = n; } return el.id; }

    var chapters = [], cur = null;
    function start(title, el, kind) { cur = { title: title, el: el, kind: kind, nodes: [], subs: [] }; chapters.push(cur); }
    Array.from(root.childNodes).forEach(function (n) {
      var tag = n.nodeType === 1 ? n.localName : "";
      if (splitAt.indexOf(tag) >= 0) {
        var kind = partsMode && tag === "h1" ? "part" : "chapter";
        start(n.textContent.replace(/\s+/g, " ").trim() || "Không tên", n, kind);
        ensureId(n); cur.nodes.push(n); return;
      }
      if (!cur) {
        if (n.nodeType === 3 && !n.nodeValue.trim()) return;
        start("Đầu sách", null, "front");
      }
      if (subLevel && tag === subLevel) cur.subs.push({ title: n.textContent.replace(/\s+/g, " ").trim(), id: ensureId(n) });
      cur.nodes.push(n);
    });
    // Phần mở đầu chỉ có vài chữ (tên sách, tên tác giả) thì bỏ.
    if (chapters.length > 1 && chapters[0].kind === "front") {
      var txt = chapters[0].nodes.map(function (n) { return n.textContent; }).join(" ");
      if (wordCount(txt) < 25 && !chapters[0].nodes.some(function (n) { return n.nodeType === 1 && n.querySelector && (n.localName === "img" || n.querySelector("img")); })) chapters.shift();
    }
    chapters = chapters.filter(function (c) { return !(/^\s*(mục lục|muc luc|contents|table of contents)\s*$/i.test(c.title) && wordCount(c.nodes.map(function (n) { return n.textContent; }).join(" ")) < 3000); });
    if (!chapters.length) start(title, null, "chapter");
    chapters.forEach(function (c, i) {
      c.file = "ch" + String(i + 1).padStart(3, "0") + ".xhtml";
      c.words = wordCount(c.nodes.map(function (n) { return n.textContent; }).join(" "));
    });
    if (!splitAt.length) warnings.push("Không tìm thấy tiêu đề chương nào, cả sách sẽ là một chương. Mẹo: trong Word, đặt kiểu Heading 1 cho tên chương; trong văn bản thường, để tên chương trên một dòng riêng bắt đầu bằng “Chương 1”.");
    var big = chapters.filter(function (c) { return c.words > 40000; });
    if (big.length) warnings.push("Có " + big.length + " chương rất dài (trên 40.000 chữ). Một số máy đọc mở chậm với chương dài như vậy.");
    return { doc: doc, chapters: chapters, idMap: idMap, autoMeta: autoMeta, warnings: warnings, partsMode: partsMode };
  }

  /* ---------------- xuất EPUB ---------------- */
  function dataUriToBytes(uri) {
    var m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri); if (!m) return null;
    var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { type: m[1].toLowerCase(), bytes: u8 };
  }
  var IMG_EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };

  function xhtmlPage(title, bodyInner, lang, bodyType) {
    return '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' + lang + '" xml:lang="' + lang + '">\n<head>\n<meta charset="utf-8"/>\n<title>' + esc(title) + '</title>\n<link rel="stylesheet" type="text/css" href="style.css"/>\n</head>\n<body' + (bodyType ? ' epub:type="' + bodyType + '"' : "") + ">\n" + bodyInner + "\n</body>\n</html>\n";
  }

  async function makeEpub(book) {
    var meta = state.meta, lang = meta.lang || "vi";
    var title = meta.title || book.autoMeta.title || (state.files[0] ? baseName(state.files[0].name) : "Sách mới"), author = meta.author || book.autoMeta.author || "";
    var zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n');
    var manifest = [], spine = [], ser = new XMLSerializer(), imgN = 0, images = {};
    var idFile = {};
    book.chapters.forEach(function (c) { c.nodes.forEach(function (n) { if (n.nodeType === 1) { if (n.id) idFile[n.id] = c.file; n.querySelectorAll && n.querySelectorAll("[id]").forEach(function (e) { idFile[e.id] = c.file; }); } }); });

    // bìa
    var coverBlob = await getCoverBlob(title, author);
    var coverExt = coverBlob.type === "image/png" ? "png" : "jpg";
    zip.file("OEBPS/images/cover." + coverExt, coverBlob);
    manifest.push('<item id="cover-img" href="images/cover.' + coverExt + '" media-type="' + coverBlob.type + '" properties="cover-image"/>');
    zip.file("OEBPS/cover.xhtml", xhtmlPage("Bìa", '<section epub:type="cover" class="cover"><img src="images/cover.' + coverExt + '" alt="' + esc(title) + '"/></section>', lang));
    manifest.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="cover" linear="yes"/>');

    // trang tên sách
    zip.file("OEBPS/title.xhtml", xhtmlPage(title, '<section epub:type="titlepage" class="titlepage"><h1 class="book-title">' + esc(title) + "</h1>" + (author ? '<p class="book-author">' + esc(author) + "</p>" : "") + "</section>", lang));
    manifest.push('<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="titlepage"/>');

    for (var ci = 0; ci < book.chapters.length; ci++) {
      var c = book.chapters[ci];
      var edited = state.titleEdits[ci];
      if (edited && c.el) { c.el.textContent = edited; c.title = edited; }
      var box = book.doc.createElement("div");
      c.nodes.forEach(function (n) { box.appendChild(n); });
      if (!c.el) { var hh = book.doc.createElement("h1"); hh.textContent = edited || c.title; hh.className = "front-title"; box.insertBefore(hh, box.firstChild); }
      box.querySelectorAll("img").forEach(function (img) {
        var src = img.getAttribute("src") || "";
        if (/^data:/i.test(src)) {
          var d = dataUriToBytes(src), ex = d && IMG_EXT[d.type];
          if (!ex) { img.remove(); return; }
          var key = src.length + ":" + src.slice(-40);
          if (!images[key]) { imgN++; images[key] = { name: "images/img" + imgN + "." + ex, type: d.type === "image/jpg" ? "image/jpeg" : d.type }; zip.file("OEBPS/" + images[key].name, d.bytes); manifest.push('<item id="img' + imgN + '" href="' + images[key].name + '" media-type="' + images[key].type + '"/>'); }
          img.setAttribute("src", images[key].name);
        } else img.replaceWith(book.doc.createTextNode(img.getAttribute("alt") || ""));
        if (!img.hasAttribute("alt")) img.setAttribute("alt", "");
      });
      box.querySelectorAll("a[href]").forEach(function (a) {
        var h = a.getAttribute("href");
        if (h.charAt(0) === "#") {
          var id = book.idMap[h.slice(1)] || h.slice(1), f = idFile[id];
          if (f) a.setAttribute("href", (f === c.file ? "" : f) + "#" + id); else a.removeAttribute("href");
        } else if (!/^(https?:|mailto:)/i.test(h)) a.removeAttribute("href");
      });
      var inner = Array.from(box.childNodes).map(function (n) { return ser.serializeToString(n); }).join("\n").replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, "");
      var type = c.kind === "part" ? "part" : c.kind === "front" ? "frontmatter" : "chapter";
      zip.file("OEBPS/" + c.file, xhtmlPage(c.title, '<section epub:type="' + type + '" class="' + type + '">\n' + inner + "\n</section>", lang, type === "frontmatter" ? "frontmatter" : "bodymatter"));
      manifest.push('<item id="c' + (ci + 1) + '" href="' + c.file + '" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="c' + (ci + 1) + '"/>');
      if (ci % 10 === 0) { status("Đang đóng gói chương " + (ci + 1) + "/" + book.chapters.length + "…"); await new Promise(function (r) { setTimeout(r, 0); }); }
    }

    // mục lục
    var navTree = [], curPart = null;
    book.chapters.forEach(function (c, ci) {
      var e = { title: state.titleEdits[ci] || c.title, href: c.file, kids: (c.subs || []).map(function (s) { return { title: s.title, href: c.file + "#" + s.id, kids: [] }; }) };
      if (c.kind === "part") { curPart = e; navTree.push(e); }
      else if (curPart && book.partsMode && c.kind !== "front") curPart.kids.push(e);
      else { if (c.kind === "front") curPart = null; navTree.push(e); }
    });
    function navOl(list) { return "<ol>\n" + list.map(function (e) { return '<li><a href="' + esc(e.href) + '">' + esc(e.title) + "</a>" + (e.kids.length ? navOl(e.kids) : "") + "</li>"; }).join("\n") + "\n</ol>"; }
    zip.file("OEBPS/nav.xhtml", xhtmlPage("Mục lục", '<nav epub:type="toc" id="toc"><h1>Mục lục</h1>\n' + navOl(navTree) + '\n</nav>\n<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="cover" href="cover.xhtml">Bìa</a></li><li><a epub:type="bodymatter" href="' + (book.chapters[0] ? book.chapters[0].file : "title.xhtml") + '">Bắt đầu đọc</a></li></ol></nav>', lang));
    manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
    var po = 0, depth = 1;
    function ncxPoints(list, d) { depth = Math.max(depth, d); return list.map(function (e) { po++; return '<navPoint id="np' + po + '" playOrder="' + po + '"><navLabel><text>' + esc(e.title) + '</text></navLabel><content src="' + esc(e.href) + '"/>' + (e.kids.length ? ncxPoints(e.kids, d + 1) : "") + "</navPoint>"; }).join("\n"); }
    var uid = "urn:uuid:" + uuid();
    var points = ncxPoints(navTree, 1);
    zip.file("OEBPS/toc.ncx", '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="' + uid + '"/><meta name="dtb:depth" content="' + depth + '"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>' + esc(title) + "</text></docTitle><navMap>\n" + points + "\n</navMap></ncx>\n");
    manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');

    // kiểu chữ
    var fontCss = "";
    if (false) {
      var fonts = [["DejaVuSerif.ttf", "normal", "normal"], ["DejaVuSerif-Bold.ttf", "bold", "normal"], ["DejaVuSerif-Italic.ttf", "normal", "italic"], ["DejaVuSerif-BoldItalic.ttf", "bold", "italic"]];
      for (var fi = 0; fi < fonts.length; fi++) {
        status("Đang nhúng font chữ…");
        var resp = await fetch("assets/fonts/" + fonts[fi][0]);
        if (!resp.ok) throw new Error("Không tải được font " + fonts[fi][0]);
        zip.file("OEBPS/fonts/" + fonts[fi][0], await resp.arrayBuffer());
        manifest.push('<item id="font' + fi + '" href="fonts/' + fonts[fi][0] + '" media-type="font/ttf"/>');
        fontCss += '@font-face{font-family:"DejaVu Serif";font-weight:' + fonts[fi][1] + ";font-style:" + fonts[fi][2] + ';src:url("fonts/' + fonts[fi][0] + '");}\n';
      }
    }
    zip.file("OEBPS/style.css", fontCss + 'body{font-family:' + (fontCss ? '"DejaVu Serif",' : "") + 'serif;line-height:1.55;margin:0 4%;}\n' +
      "p{margin:0 0 .75em;text-align:justify;text-indent:0;}\nh1,h2,h3,h4{line-height:1.25;page-break-after:avoid;break-after:avoid;}\nh1{font-size:1.6em;text-align:center;margin:2em 0 1em;}\nh2{font-size:1.3em;margin:1.6em 0 .7em;}\nh3{font-size:1.12em;margin:1.3em 0 .5em;}\n" +
      "section.part h1{margin-top:30%;font-size:1.8em;}\nblockquote{margin:1em 1.5em;font-style:italic;}\nimg{max-width:100%;height:auto;}\nfigure{margin:1em 0;text-align:center;}\nfigcaption{font-size:.88em;font-style:italic;}\n" +
      "table{border-collapse:collapse;margin:1em 0;}\nth,td{border:1px solid #999;padding:.3em .5em;vertical-align:top;}\n.cover{text-align:center;margin:0;padding:0;}\n.cover img{height:100%;max-height:100vh;}\n" +
      ".titlepage{text-align:center;margin-top:30%;}\n.book-title{font-size:2em;}\n.book-author{font-size:1.2em;font-style:italic;text-align:center;}\n.subtitle{font-style:italic;text-align:center;}\n.right{text-align:right;}\n.poem p{text-align:left;margin-left:2em;}\n");
    manifest.push('<item id="css" href="style.css" media-type="text/css"/>');

    var modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    zip.file("OEBPS/content.opf", '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' + lang + '">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
      '<dc:identifier id="bookid">' + uid + "</dc:identifier>\n<dc:title>" + esc(title) + "</dc:title>\n" + (author ? "<dc:creator>" + esc(author) + "</dc:creator>\n" : "") +
      "<dc:language>" + lang + '</dc:language>\n<meta property="dcterms:modified">' + modified + '</meta>\n<meta name="cover" content="cover-img"/>\n<meta name="generator" content="Tủ sách Hùng Linh · Chuyển sang EPUB"/>\n</metadata>\n<manifest>\n' +
      manifest.join("\n") + '\n</manifest>\n<spine toc="ncx">\n' + spine.join("\n") + '\n</spine>\n<guide><reference type="cover" title="Bìa" href="cover.xhtml"/></guide>\n</package>\n');
    status("Đang nén file EPUB…");
    var blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return { blob: blob, name: slugify(title) + ".epub" };
  }

  /* ---------------- bìa ---------------- */
  var PALETTES = [["#1d2b4a", "#0e1424", "#e8d9b0"], ["#3b1f2b", "#170c12", "#f0d7c4"], ["#1f3a33", "#0b1714", "#dfe9d8"], ["#2b2b2b", "#0d0d0d", "#e9e4d8"], ["#4a3320", "#1b1209", "#f3e3c7"], ["#24304f", "#3b1d3d", "#f2e6d8"]];
  function wrapLines(ctx, text, maxW) {
    var words = text.split(/\s+/), lines = [], line = "";
    words.forEach(function (w) { var t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line); return lines;
  }
  async function drawCover(title, author) {
    var cv = $("coverCanvas"), ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    var hash = 0; for (var i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
    var pal = PALETTES[hash % PALETTES.length];
    try { await document.fonts.load('700 120px "Literata"'); await document.fonts.load('italic 400 60px "Literata"'); } catch (e) {}
    var g = ctx.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = pal[2]; ctx.globalAlpha = .35; ctx.lineWidth = 3; ctx.strokeRect(70, 70, W - 140, H - 140); ctx.globalAlpha = 1;
    ctx.fillStyle = pal[2]; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    var size = 150, lines;
    do { ctx.font = '700 ' + size + 'px "Literata", "Noto Serif", Georgia, serif'; lines = wrapLines(ctx, title.toUpperCase(), W - 280); size -= 8; } while ((lines.length > 5 || lines.some(function (l) { return ctx.measureText(l).width > W - 280; })) && size > 60);
    size += 8;
    var lh = size * 1.18, top = H * 0.36 - (lines.length - 1) * lh / 2;
    lines.forEach(function (l, k) { ctx.fillText(l, W / 2, top + k * lh); });
    var yy = top + (lines.length - 1) * lh + size * 0.9;
    ctx.globalAlpha = .7; ctx.fillRect(W / 2 - 90, yy, 180, 4); ctx.globalAlpha = 1;
    if (author) { ctx.font = 'italic 400 64px "Literata", "Noto Serif", Georgia, serif'; wrapLines(ctx, author, W - 300).slice(0, 2).forEach(function (l, k) { ctx.fillText(l, W / 2, H - 260 + k * 80); }); }
  }
  async function getCoverBlob(title, author) {
    if (state.cover) {
      var t = state.cover.type;
      if (t === "image/jpeg" || t === "image/png") return state.cover;
      var img = await createImageBitmap(state.cover), c = document.createElement("canvas");
      c.width = img.width; c.height = img.height; c.getContext("2d").drawImage(img, 0, 0);
      return await new Promise(function (r) { c.toBlob(r, "image/jpeg", 0.9); });
    }
    await drawCover(title, author);
    return await new Promise(function (r) { $("coverCanvas").toBlob(r, "image/jpeg", 0.9); });
  }

  /* ---------------- giao diện: chọn file → tự chuyển → tải ---------------- */
  var ACCEPT = ["docx", "md", "markdown", "txt", "text", "html", "htm", "xhtml", "fb2", "pdf"];
  var DL = '<svg viewBox="0 0 24 24"><path d="M12 3v13m0 0 5-5m-5 5-5-5M5 21h14"/></svg>';
  var queue = Promise.resolve();

  function row(name) {
    var li = document.createElement("li");
    li.className = "cv-row busy";
    li.innerHTML = '<div class="cv-thumb"><span class="spin"></span></div><div class="cv-info"><b>' + esc(baseName(name)) + '</b><small>Đang chuyển…</small></div><div class="cv-act"></div>';
    $("results").appendChild(li);
    return li;
  }

  async function convertOne(file, li) {
    var info = li.querySelector("small");
    statusEl = info;
    state.files = [file]; state.meta = { title: "", author: "", lang: "vi" }; state.titleEdits = {}; state.cover = null;
    try {
      var book = await buildBook(status);
      var title = book.autoMeta.title || baseName(file.name);
      var out = await makeEpub(book);
      var url = URL.createObjectURL(out.blob);
      var cover = $("coverCanvas").toDataURL("image/jpeg", 0.6);
      li.className = "cv-row done";
      li.querySelector(".cv-thumb").innerHTML = '<img src="' + cover + '" alt="">';
      li.querySelector("b").textContent = title;
      info.textContent = book.chapters.length + " chương · " + fmtSize(out.blob.size);
      li.querySelector(".cv-act").innerHTML = '<a class="cv-dl" href="' + url + '" download="' + esc(out.name) + '" aria-label="Tải ' + esc(out.name) + '">' + DL + '<span>EPUB</span></a>';
    } catch (err) {
      console.error(err);
      li.className = "cv-row fail";
      li.querySelector(".cv-thumb").innerHTML = "!";
      info.textContent = err.message || "Không chuyển được file này.";
    }
    statusEl = null;
  }

  function addFiles(list) {
    Array.from(list).forEach(function (f) {
      var li = row(f.name);
      if (ACCEPT.indexOf(ext(f.name)) < 0) {
        li.className = "cv-row fail"; li.querySelector(".cv-thumb").innerHTML = "!";
        li.querySelector("small").textContent = /\.doc$/i.test(f.name) ? "File .doc cũ: mở bằng Word và lưu lại thành .docx" : "Định dạng chưa hỗ trợ";
        return;
      }
      queue = queue.then(function () { return convertOne(f, li); });
    });
  }

  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  $("pick").addEventListener("change", function () { addFiles(this.files); this.value = ""; });

  window.__convert = { buildBook: buildBook, makeEpub: makeEpub, state: state, addFiles: addFiles };
})();
