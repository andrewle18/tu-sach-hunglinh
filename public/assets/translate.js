/* Dịch file tiếng Anh sang tiếng Việt qua DeepL (qua Worker của site, có mật khẩu).
   EPUB, MD, TXT: tách từng đoạn để dịch rồi đóng gói lại, giữ nguyên định dạng.
   DOCX, PDF, HTML, PPTX: gửi nguyên file cho DeepL dịch và trả về đúng định dạng. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var PASS = "tr-pass";
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ext(n) { var m = /\.([a-z0-9]+)$/i.exec(n); return m ? m[1].toLowerCase() : ""; }
  function base(n) { return n.replace(/\.[^.]+$/, ""); }
  function fmtN(n) { return Number(n || 0).toLocaleString("vi-VN"); }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var ERR = {
    bad_password: "Sai mật khẩu.", too_many_attempts: "Nhập sai quá nhiều lần, thử lại sau 10 phút.",
    not_configured: "Công cụ dịch chưa được cài đặt xong (thiếu key DeepL hoặc mật khẩu trên Cloudflare).",
    quota_exceeded: "Đã hết hạn mức ký tự DeepL của tháng này.", bad_api_key: "Key DeepL không hợp lệ.",
    busy: "DeepL đang bận, thử lại sau ít phút.", deepl_error: "DeepL báo lỗi.", batch_too_large: "Đoạn văn quá dài."
  };

  /* ---------------- gọi API ---------------- */
  async function api(path, body, raw) {
    var opt = { method: "POST", headers: { "x-pass": LS.get(PASS) || "" } };
    if (body instanceof FormData) opt.body = body;
    else { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body || {}); }
    for (var attempt = 0; attempt < 4; attempt++) {
      var r = await fetch(path, opt);
      if (raw && r.ok) return r;
      var d = {};
      try { d = await r.json(); } catch (e) { d = { ok: false, error: "network" }; }
      if (d.ok) return d;
      if (d.error === "bad_password") { lock(); }
      if ((d.error === "busy" || r.status === 429 && d.error !== "too_many_attempts") && attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
      var e = new Error((ERR[d.error] || "Lỗi: " + (d.error || r.status)) + (d.detail ? " (" + d.detail + ")" : ""));
      e.code = d.error; throw e;
    }
  }

  /* ---------------- khoá bằng mật khẩu ---------------- */
  function showUsage(u) {
    $("usage").textContent = u && u.character_limit ? "Đã dùng " + fmtN(u.character_count) + " / " + fmtN(u.character_limit) + " ký tự tháng này" : "";
  }
  function lock() { LS.del(PASS); $("gate").hidden = false; $("work").hidden = true; }
  async function unlock(pass) {
    LS.set(PASS, pass);
    $("gateMsg").textContent = "Đang kiểm tra…";
    try {
      var d = await api("/api/tr/check");
      $("gate").hidden = true; $("work").hidden = false; $("gateMsg").textContent = "";
      showUsage(d.usage);
    } catch (e) { LS.del(PASS); $("gate").hidden = false; $("work").hidden = true; $("gateMsg").textContent = e.message; }
  }
  $("gateForm").addEventListener("submit", function (e) { e.preventDefault(); var v = $("pass").value; if (v) unlock(v); });

  /* ---------------- dịch theo lô ---------------- */
  // items: [{text, html}] -> mảng bản dịch cùng thứ tự. Gộp trùng, chia lô <= 40 đoạn / 25.000 ký tự.
  async function translateAll(items, onProgress) {
    var uniq = {}, list = [];
    items.forEach(function (it) { var k = (it.html ? "h:" : "t:") + it.text; if (!(k in uniq)) { uniq[k] = list.length; list.push(it); } });
    var out = new Array(list.length), total = list.reduce(function (n, it) { return n + it.text.length; }, 0) || 1, done = 0;
    var i = 0;
    while (i < list.length) {
      var html = !!list[i].html, batch = [], size = 0;
      while (i < list.length && batch.length < 40 && !!list[i].html === html && (size + list[i].text.length <= 25000 || !batch.length)) {
        batch.push(i); size += list[i].text.length; i++;
      }
      var res = await api("/api/tr/text", { texts: batch.map(function (k) { return list[k].text; }), html: html, source: "EN" });
      batch.forEach(function (k, j) { out[k] = res.translations[j]; });
      done += size; onProgress && onProgress(done / total);
    }
    return items.map(function (it) { return out[uniq[(it.html ? "h:" : "t:") + it.text]]; });
  }

  /* ---------------- EPUB ---------------- */
  var BLOCKS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dt", "dd", "th", "td", "caption", "figcaption", "blockquote", "div", "aside", "section", "td"];
  var SKIP = ["pre", "code", "script", "style", "svg", "math"];
  var ENT = { nbsp: 160, mdash: 8212, ndash: 8211, hellip: 8230, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, copy: 169, reg: 174, trade: 8482, laquo: 171, raquo: 187, middot: 183, bull: 8226, deg: 176, times: 215, eacute: 233, egrave: 232, agrave: 224, ccedil: 231, ouml: 246, uuml: 252, auml: 228, shy: 173, thinsp: 8201, ensp: 8194, emsp: 8195, zwnj: 8204, zwj: 8205 };
  function fixEntities(s) { return s.replace(/&([a-zA-Z]+);/g, function (m, n) { return /^(amp|lt|gt|quot|apos)$/.test(n) ? m : ENT[n] ? "&#" + ENT[n] + ";" : m; }); }
  var ser = new XMLSerializer();
  function innerXml(el) { return Array.from(el.childNodes).map(function (n) { return ser.serializeToString(n); }).join("").replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, ""); }
  function hasLetters(s) { return /[A-Za-z]{2}/.test(s); }

  function collectBlocks(doc) {
    var body = doc.getElementsByTagNameNS("*", "body")[0] || doc.documentElement;
    var out = [];
    (function walk(el) {
      Array.from(el.children).forEach(function (c) {
        var t = c.localName.toLowerCase();
        if (SKIP.indexOf(t) >= 0) return;
        if (BLOCKS.indexOf(t) >= 0) {
          var hasBlockChild = Array.from(c.children).some(function (k) { return BLOCKS.indexOf(k.localName.toLowerCase()) >= 0; });
          if (!hasBlockChild) { if (hasLetters(c.textContent)) out.push(c); return; }
          // phần chữ trôi nổi trong một khối có khối con thì bỏ qua, chỉ đi tiếp vào trong
        }
        walk(c);
      });
    })(body);
    return out;
  }
  function setTranslated(el, translated) {
    var tmp = document.implementation.createHTMLDocument("x");
    tmp.body.innerHTML = translated;
    var xml = Array.from(tmp.body.childNodes).map(function (n) { return ser.serializeToString(n); }).join("");
    var frag = new DOMParser().parseFromString('<div xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' + xml + "</div>", "application/xhtml+xml");
    if (frag.getElementsByTagName("parsererror").length) { el.textContent = tmp.body.textContent; return; }
    while (el.firstChild) el.removeChild(el.firstChild);
    Array.from(frag.documentElement.childNodes).forEach(function (n) { el.appendChild(el.ownerDocument.importNode(n, true)); });
  }

  async function trEpub(file, prog) {
    var zip = await JSZip.loadAsync(file);
    var cont = await zip.file("META-INF/container.xml").async("string");
    var opfPath = (/full-path="([^"]+)"/.exec(cont) || [])[1];
    if (!opfPath || !zip.file(opfPath)) throw new Error("EPUB thiếu file mô tả (OPF).");
    var dir = opfPath.indexOf("/") >= 0 ? opfPath.replace(/[^/]+$/, "") : "";
    var opfDoc = new DOMParser().parseFromString(await zip.file(opfPath).async("string"), "application/xml");
    var items = Array.from(opfDoc.getElementsByTagNameNS("*", "item"));
    var docs = [], xhtmlPaths = items.filter(function (it) { return /xhtml|html/.test(it.getAttribute("media-type") || ""); }).map(function (it) { return dir + decodeURIComponent(it.getAttribute("href")); });
    var jobs = [];
    prog("Đang đọc sách…", 0);
    for (var i = 0; i < xhtmlPaths.length; i++) {
      var f = zip.file(xhtmlPaths[i]); if (!f) continue;
      var src = await f.async("string");
      var doc = new DOMParser().parseFromString(fixEntities(src), "application/xhtml+xml");
      if (doc.getElementsByTagName("parsererror").length) continue;
      docs.push({ path: xhtmlPaths[i], doc: doc, decl: /^\s*<\?xml[^>]*\?>/.exec(src) });
      collectBlocks(doc).forEach(function (el) { jobs.push({ el: el, text: innerXml(el), html: true }); });
      var title = doc.getElementsByTagNameNS("*", "title")[0];
      if (title && hasLetters(title.textContent) && !/\.x?html?$|^(cover|title ?page)$/i.test(title.textContent.trim())) jobs.push({ el: title, text: title.textContent, html: false, plain: true });
    }
    // mục lục EPUB 2
    var ncxItem = items.find(function (it) { return /ncx/.test(it.getAttribute("media-type") || ""); });
    var ncx = null;
    if (ncxItem && zip.file(dir + ncxItem.getAttribute("href"))) {
      ncx = { path: dir + ncxItem.getAttribute("href") };
      ncx.doc = new DOMParser().parseFromString(await zip.file(ncx.path).async("string"), "application/xml");
      Array.from(ncx.doc.getElementsByTagNameNS("*", "text")).forEach(function (t) { if (hasLetters(t.textContent)) jobs.push({ el: t, text: t.textContent, html: false, plain: true }); });
    }
    Array.from(opfDoc.getElementsByTagNameNS("*", "title")).concat(Array.from(opfDoc.getElementsByTagNameNS("*", "description"))).forEach(function (t) {
      if (hasLetters(t.textContent)) jobs.push({ el: t, text: t.textContent, html: false, plain: true });
    });
    if (!jobs.length) throw new Error("Không tìm thấy chữ để dịch trong file này.");
    var chars = jobs.reduce(function (n, j) { return n + j.text.length; }, 0);
    prog("Đang dịch khoảng " + fmtN(chars) + " ký tự…", 0);
    var tr = await translateAll(jobs, function (f) { prog("Đang dịch " + Math.round(f * 100) + "%", f); });
    jobs.forEach(function (j, k) { if (tr[k] == null) return; if (j.plain) j.el.textContent = tr[k]; else setTranslated(j.el, tr[k]); });
    Array.from(opfDoc.getElementsByTagNameNS("*", "language")).forEach(function (l) { l.textContent = "vi"; });
    if (opfDoc.documentElement.hasAttribute("xml:lang")) opfDoc.documentElement.setAttribute("xml:lang", "vi");

    prog("Đang đóng gói…", 1);
    var out = new JSZip();
    out.file("mimetype", "application/epub+zip", { compression: "STORE" });
    var changed = {};
    docs.forEach(function (d) {
      var root = d.doc.documentElement;
      if (root.hasAttribute("lang")) root.setAttribute("lang", "vi");
      root.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:lang", "vi");
      changed[d.path] = (d.decl ? d.decl[0].trim() + "\n" : '<?xml version="1.0" encoding="utf-8"?>\n') + ser.serializeToString(d.doc).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
    });
    if (ncx) changed[ncx.path] = '<?xml version="1.0" encoding="UTF-8"?>\n' + ser.serializeToString(ncx.doc).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
    changed[opfPath] = '<?xml version="1.0" encoding="UTF-8"?>\n' + ser.serializeToString(opfDoc).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
    var names = Object.keys(zip.files).filter(function (n) { return n !== "mimetype" && !zip.files[n].dir; });
    for (var n = 0; n < names.length; n++) {
      var nm = names[n];
      if (changed[nm] != null) out.file(nm, changed[nm]);
      else out.file(nm, await zip.file(nm).async("uint8array"));
    }
    var blob = await out.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
    return { blob: blob, name: base(file.name) + "-vi.epub", chars: chars };
  }

  /* ---------------- TXT, MD ---------------- */
  function decodeText(ab) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(ab).replace(/^﻿/, ""); }
    catch (e) { return new TextDecoder("windows-1252").decode(ab); }
  }
  async function trText(file, prog, md) {
    var t = decodeText(await file.arrayBuffer()).replace(/\r\n?/g, "\n");
    var head = "";
    var fm = md && /^---\n[\s\S]*?\n---\n/.exec(t); // phần thông tin đầu file Markdown: giữ nguyên
    if (fm) { head = fm[0]; t = t.slice(head.length); }
    var parts = t.split(/(\n\s*\n)/); // giữ nguyên khoảng trống giữa các đoạn
    var jobs = [], inFence = false;
    parts.forEach(function (p, i) {
      if (i % 2 === 1 || !hasLetters(p)) return;
      if (md) {
        var fences = (p.match(/^```/gm) || []).length;
        if (inFence || /^```/.test(p.trim())) { if (fences % 2 === 1) inFence = !inFence; return; }
        var m = /^(\s*(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)?)([\s\S]*)$/.exec(p);
        jobs.push({ i: i, prefix: m[1], text: m[2], html: false });
      } else jobs.push({ i: i, prefix: "", text: p, html: false });
    });
    if (!jobs.length) throw new Error("Không tìm thấy chữ để dịch trong file này.");
    var chars = jobs.reduce(function (n, j) { return n + j.text.length; }, 0);
    var tr = await translateAll(jobs, function (f) { prog("Đang dịch " + Math.round(f * 100) + "%", f); });
    jobs.forEach(function (j, k) { parts[j.i] = j.prefix + tr[k]; });
    return { blob: new Blob([head + parts.join("")], { type: md ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }), name: base(file.name) + "-vi." + ext(file.name), chars: chars };
  }

  /* ---------------- DOCX, PDF, HTML, PPTX: DeepL dịch nguyên file ---------------- */
  async function trDocument(file, prog) {
    var fd = new FormData(); fd.append("file", file, file.name); fd.append("source", "EN");
    prog("Đang gửi file cho DeepL…", 0);
    var job = await api("/api/tr/doc", fd);
    var started = Date.now(), st;
    while (true) {
      await sleep(2500);
      st = await api("/api/tr/doc/status", { id: job.id, key: job.key });
      if (st.status === "done") break;
      if (st.status === "error") throw new Error("DeepL không dịch được file này" + (st.message ? ": " + st.message : "."));
      var el = Math.round((Date.now() - started) / 1000);
      prog(st.status === "translating" ? "Đang dịch" + (st.seconds ? ", còn khoảng " + st.seconds + " giây" : "…") : "Đang chờ DeepL xử lý… " + el + " giây", st.seconds ? Math.min(0.95, el / (el + st.seconds)) : 0.1);
      if (Date.now() - started > 30 * 60 * 1000) throw new Error("DeepL xử lý quá lâu, thử lại sau.");
    }
    prog("Đang tải bản dịch…", 1);
    var r = await api("/api/tr/doc/result", { id: job.id, key: job.key }, true);
    var blob = await r.blob();
    return { blob: blob, name: base(file.name) + "-vi." + ext(file.name), chars: st.billed };
  }

  /* ---------------- giao diện ---------------- */
  var HANDLERS = {
    epub: trEpub, md: function (f, p) { return trText(f, p, true); }, markdown: function (f, p) { return trText(f, p, true); },
    txt: function (f, p) { return trText(f, p, false); }, docx: trDocument, pdf: trDocument, html: trDocument, htm: trDocument, pptx: trDocument
  };
  var DL = '<svg viewBox="0 0 24 24"><path d="M12 3v13m0 0 5-5m-5 5-5-5M5 21h14"/></svg>';
  var queue = Promise.resolve();

  function row(f) {
    var li = document.createElement("li");
    li.className = "cv-row busy";
    li.innerHTML = '<div class="cv-thumb tr-ext">' + esc(ext(f.name).toUpperCase() || "?") + '</div><div class="cv-info"><b>' + esc(f.name) + '</b><small>Đang chờ…</small><div class="tr-bar"><i></i></div></div><div class="cv-act"></div>';
    $("results").appendChild(li);
    return li;
  }
  async function run(f, li) {
    var info = li.querySelector("small"), bar = li.querySelector(".tr-bar i");
    var prog = function (msg, frac) { info.textContent = msg; if (frac != null) bar.style.width = Math.round(frac * 100) + "%"; };
    try {
      var out = await HANDLERS[ext(f.name)](f, prog);
      var url = URL.createObjectURL(out.blob);
      li.className = "cv-row done";
      li.querySelector("b").textContent = out.name;
      info.textContent = (out.chars ? fmtN(out.chars) + " ký tự · " : "") + fmtSize(out.blob.size);
      li.querySelector(".cv-act").innerHTML = '<a class="cv-dl" href="' + url + '" download="' + esc(out.name) + '">' + DL + "<span>Tải</span></a>";
      api("/api/tr/check").then(function (d) { showUsage(d.usage); }).catch(function () {});
    } catch (e) {
      console.error(e);
      li.className = "cv-row fail"; li.querySelector(".cv-thumb").textContent = "!";
      info.textContent = e.message || "Không dịch được file này.";
    }
  }
  function addFiles(list) {
    Array.from(list).forEach(function (f) {
      var li = row(f);
      if (!HANDLERS[ext(f.name)]) { li.className = "cv-row fail"; li.querySelector(".cv-thumb").textContent = "!"; li.querySelector("small").textContent = "Định dạng chưa hỗ trợ"; return; }
      queue = queue.then(function () { return run(f, li); });
    });
  }
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  $("pick").addEventListener("change", function () { addFiles(this.files); this.value = ""; });
  $("logout").addEventListener("click", lock);

  if (LS.get(PASS)) unlock(LS.get(PASS)); else lock();
  window.__tr = { trEpub: trEpub, translateAll: translateAll };
})();
