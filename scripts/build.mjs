// Tủ sách Hùng Linh: tự dựng kệ sách từ các thư mục trong public/books/.
//
// Mỗi thư mục public/books/<ten-sach>/ chỉ cần:
//   - một file .epub   (bắt buộc)
//   - một file .pdf    (không bắt buộc)
//   - thong-tin.txt    (không bắt buộc: tiêu đề, giới thiệu, thứ tự...)
//   - cover.png / cover.jpg (không bắt buộc: không có thì lấy bìa trong EPUB)
//
// Script đọc EPUB, sinh nội dung đọc online vào <ten-sach>/auto/, rồi viết
// lại public/books.js. Wrangler tự chạy script này trước mỗi lần deploy/dev.
// Không cần cài thêm thư viện nào.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const BOOKS = path.join(PUB, "books");

// ---------- đọc file zip (EPUB là zip) ----------
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("không phải file zip/epub hợp lệ");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    entries.set(name, { method, csize, local });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    get(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lnl = buf.readUInt16LE(e.local + 26), lxl = buf.readUInt16LE(e.local + 28);
      const start = e.local + 30 + lnl + lxl;
      const raw = buf.slice(start, start + e.csize);
      return e.method === 0 ? raw : zlib.inflateRawSync(raw);
    },
    text(name) { const b = this.get(name); return b ? b.toString("utf8") : null; },
  };
}

// ---------- tiện ích ----------
const decodeEntities = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
   .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const posix = (...a) => path.posix.normalize(path.posix.join(...a));
const urlPath = (...segs) => segs.map((s) => s.split("/").map(encodeURIComponent).join("/")).join("/");

function titleCaseVi(s) {
  // Chỉ đổi khi cả chuỗi đang viết HOA (kiểu "KHỞI NGUYÊN HY LẠP").
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(“"'])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}
function prettyPart(t) {
  const m = t.match(/^\s*(phần|phan|part)\s+([ivxlcdm\d]+)\s*[,:.·\-–—]*\s*(.*)$/i);
  if (!m) return titleCaseVi(t);
  const num = /^\d+$/.test(m[2]) ? m[2] : m[2].toUpperCase();
  return m[3] ? `Phần ${num} · ${titleCaseVi(m[3])}` : `Phần ${num}`;
}

function readInfo(dir) {
  const f = ["thong-tin.txt", "thongtin.txt", "info.txt"].map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
  const info = {};
  if (!f) return info;
  for (const line of fs.readFileSync(f, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([a-zA-Z\-_ ]+?)\s*:\s*(.*)$/);
    if (m && m[2].trim()) info[m[1].toLowerCase().replace(/[\s_]+/g, "-")] = m[2].trim();
  }
  return info;
}

// ---------- EPUB -> nội dung đọc online ----------
function parseEpub(file) {
  const z = readZip(file);
  const container = z.text("META-INF/container.xml");
  const opfPath = (container && container.match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath) throw new Error("thiếu META-INF/container.xml");
  const opf = z.text(opfPath);
  const opfDir = path.posix.dirname(opfPath);

  // metadata
  const meta = { titles: [], subtitle: "", author: "", description: "", date: "" };
  for (const m of opf.matchAll(/<dc:title([^>]*)>([\s\S]*?)<\/dc:title>/g)) {
    const id = (m[1].match(/id="([^"]+)"/) || [])[1];
    const type = id ? (opf.match(new RegExp(`refines="#${id}"[^>]*property="title-type"[^>]*>([^<]+)<`)) || [])[1] : "";
    meta.titles.push({ text: stripTags(m[2]), type: type || "" });
  }
  const main = meta.titles.find((t) => t.type === "main") || meta.titles[0] || { text: "" };
  const sub = meta.titles.find((t) => t.type === "subtitle");
  meta.title = main.text;
  meta.subtitle = sub ? sub.text : "";
  meta.author = stripTags((opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/) || [])[1] || "");
  meta.description = stripTags((opf.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/) || [])[1] || "");
  meta.date = stripTags((opf.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/) || [])[1] || "").slice(0, 4);

  // manifest + spine
  const manifest = {};
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/g)) {
    const a = m[1], g = (k) => (a.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] || "";
    manifest[g("id")] = { href: posix(opfDir, decodeURIComponent(g("href"))), type: g("media-type"), props: g("properties") };
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => manifest[m[1]]).filter(Boolean);

  // pandoc chỉ ghi phụ đề ở trang tiêu đề
  if (!meta.subtitle) {
    for (const it of spine.slice(0, 4)) {
      const m = (z.text(it.href) || "").match(/<p[^>]*class="subtitle"[^>]*>([\s\S]*?)<\/p>/);
      if (m) { meta.subtitle = stripTags(m[1]); break; }
    }
  }

  // bìa
  let coverItem = Object.values(manifest).find((i) => /cover-image/.test(i.props));
  if (!coverItem) {
    const cid = (opf.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/) || [])[1];
    if (cid && manifest[cid] && /^image\//.test(manifest[cid].type)) coverItem = manifest[cid];
  }

  // mục lục: nav.xhtml (EPUB3) hoặc toc.ncx (EPUB2)
  const toc = []; // {level, title, file, frag}
  const navItem = Object.values(manifest).find((i) => /\bnav\b/.test(i.props));
  if (navItem) {
    const nav = z.text(navItem.href);
    const tocNav = (nav.match(/<nav[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/) || [])[1] || "";
    const navDir = path.posix.dirname(navItem.href);
    let depth = 0;
    for (const m of tocNav.matchAll(/<(\/?)ol\b[^>]*>|<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
      if (m[0].startsWith("<ol")) depth++;
      else if (m[0].startsWith("</ol")) depth--;
      else {
        const [f, frag] = decodeURIComponent(m[2]).split("#");
        toc.push({ level: depth, title: stripTags(m[3]), file: posix(navDir, f), frag: frag || "" });
      }
    }
  } else {
    const ncxItem = Object.values(manifest).find((i) => /ncx/.test(i.type));
    const ncx = ncxItem ? z.text(ncxItem.href) : "";
    const ncxDir = ncxItem ? path.posix.dirname(ncxItem.href) : "";
    let depth = 0;
    for (const m of ncx.matchAll(/<navPoint\b|<\/navPoint>|<text>([\s\S]*?)<\/text>|<content[^>]*src="([^"]+)"/g)) {
      if (m[0] === "</navPoint>") depth--;
      else if (m[0].startsWith("<navPoint")) { depth++; toc.push({ level: depth, title: "", file: "", frag: "" }); }
      else if (m[1] !== undefined) { const t = toc[toc.length - 1]; if (t && !t.title) t.title = stripTags(m[1]); }
      else if (m[2]) { const t = toc[toc.length - 1]; const [f, frag] = decodeURIComponent(m[2]).split("#"); if (t && !t.file) { t.file = posix(ncxDir, f); t.frag = frag || ""; } }
    }
  }
  // chỉ giữ hai cấp đầu (phần, chương)
  const entries = toc.filter((t) => t.level <= 2 && t.file);
  entries.forEach((e, i) => { e.hasChildren = entries[i + 1] && entries[i + 1].level > e.level; });

  return { z, meta, spine, coverItem, entries };
}

function buildUnits(epub, imgBase, imgOut) {
  const { z, spine, entries } = epub;
  const byFile = new Map();
  for (const e of entries) { if (!byFile.has(e.file)) byFile.set(e.file, []); byFile.get(e.file).push(e); }
  const usedImages = new Map(); // đường dẫn trong epub -> tên file xuất ra

  const segments = []; // {entry|null, html}
  // bỏ các trang đứng trước mục đầu tiên của mục lục (bìa, trang tên sách...)
  const first = spine.findIndex((i) => byFile.has(i.href));
  for (const item of spine.slice(Math.max(0, first))) {
    if (!/x?html/.test(item.type) || /\bnav\b/.test(item.props)) continue;
    let html = z.text(item.href) || "";
    const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1] || "";
    if (/epub:type="cover"|class="cover"/.test(html) && !/<p\b/.test(body)) continue; // trang bìa
    const dir = path.posix.dirname(item.href);
    let b = body
      .replace(/<nav\b[\s\S]*?<\/nav>/g, "")
      .replace(/<\/?(section|div)\b[^>]*>/g, (t) => (t.startsWith("</") ? "" : t.match(/\bid="[^"]+"/) ? `<a ${t.match(/\bid="[^"]+"/)[0]}></a>` : ""))
      .replace(/<(img|image)\b([^>]*?)(?:src|xlink:href)="([^"]+)"([^>]*)\/?>/g, (_, tag, a, src, c) => {
        const inEpub = posix(dir, decodeURIComponent(src));
        if (!usedImages.has(inEpub)) usedImages.set(inEpub, usedImages.size + "-" + path.posix.basename(inEpub));
        const alt = (a + c).match(/alt="([^"]*)"/);
        return `<img src="${urlPath(imgBase, usedImages.get(inEpub))}" alt="${alt ? alt[1] : ""}" loading="lazy">`;
      })
      .replace(/<svg\b[\s\S]*?<\/svg>/g, (s) => (/<img/.test(s) ? s.replace(/<\/?svg[^>]*>/g, "") : ""))
      .replace(/href="(?!https?:|mailto:)[^"#]*#([^"]+)"/g, 'href="#$1"')
      .replace(/\sepub:type="[^"]*"/g, "")
      .replace(/<\?xml[^>]*>/g, "");

    const cuts = (byFile.get(item.href) || []).map((e) => {
      if (!e.frag) return { e, pos: 0 };
      const re = new RegExp(`<[^>]*\\bid="${e.frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
      const m = b.match(re);
      return { e, pos: m ? m.index : -1 };
    }).filter((c) => c.pos >= 0).sort((a, b2) => a.pos - b2.pos);

    if (!cuts.length) { if (stripTags(b)) segments.push({ entry: null, html: b }); continue; }
    if (cuts[0].pos > 0 && stripTags(b.slice(0, cuts[0].pos))) segments.push({ entry: null, html: b.slice(0, cuts[0].pos) });
    cuts.forEach((c, i) => segments.push({ entry: c.e, html: b.slice(c.pos, i + 1 < cuts.length ? cuts[i + 1].pos : b.length) }));
  }

  // ghép đoạn không có mục lục vào đoạn trước
  const merged = [];
  for (const s of segments) {
    if (!s.entry && merged.length) merged[merged.length - 1].html += s.html;
    else merged.push(s);
  }

  const hasParts = entries.some((e) => e.level === 1 && e.hasChildren);
  let part = hasParts ? "Mở đầu" : "Nội dung", seenPart = false;
  const units = [];
  for (const s of merged) {
    let html = s.html;
    const e = s.entry;
    let title = e ? e.title : "";
    // bỏ tiêu đề đầu tiên (trình đọc tự hiển thị tiêu đề)
    const h = html.match(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/);
    if (h && (!title || stripTags(h[2]) === title || h.index < 200)) {
      if (!title) title = stripTags(h[2]);
      html = html.slice(0, h.index) + html.slice(h.index + h[0].length);
    }
    // chuẩn hoá tiêu đề con: cấp cao nhất còn lại -> h2.sub, tiếp theo -> h3
    const levels = [...new Set([...html.matchAll(/<h([1-6])\b/g)].map((m) => +m[1]))].sort();
    html = html.replace(/<(\/?)h([1-6])\b([^>]*)>/g, (_, close, lv, attrs) => {
      const rank = levels.indexOf(+lv);
      const n = Math.min(4, 2 + Math.max(0, rank));
      if (close) return `</h${n}>`;
      const id = (attrs.match(/\bid="[^"]+"/) || [""])[0];
      return n === 2 ? `<h2 class="sub" ${id}>` : `<h${n} ${id}>`;
    });
    html = html.replace(/\n{2,}/g, "\n").trim();

    if (e && e.level === 1 && e.hasChildren) {
      part = prettyPart(title); seenPart = true;
      if (stripTags(html).length > 200 || /<img/.test(html)) units.push({ part, kind: "intro", title: part, html });
      continue;
    }
    if (e && e.level === 1 && hasParts && seenPart) {
      // mục cấp 1 không có chương con, nằm sau các phần: kết luận, phụ lục...
      part = "Cuối sách";
    }
    if (!stripTags(html) && !/<img/.test(html)) continue;
    units.push({ part, kind: "chapter", title: title || "Không tên", html });
  }
  units.forEach((u, i) => (u.id = "p" + i));

  // xuất ảnh
  if (usedImages.size) {
    fs.mkdirSync(imgOut, { recursive: true });
    for (const [inEpub, out] of usedImages) {
      const data = z.get(inEpub);
      if (data) fs.writeFileSync(path.join(imgOut, out), data);
    }
  }
  return units;
}

function countWords(units) {
  return units.reduce((n, u) => n + (stripTags(u.html).match(/[\p{L}\p{N}]+/gu) || []).length, 0);
}
const fmtWords = (n) => "≈ " + (Math.round(n / 100) * 100).toLocaleString("de-DE");

// ---------- chạy ----------
function main() {
  if (!fs.existsSync(BOOKS)) fs.mkdirSync(BOOKS, { recursive: true });
  const catalog = [];
  const dirs = fs.readdirSync(BOOKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

  for (const slug of dirs) {
    const dir = path.join(BOOKS, slug);
    const files = fs.readdirSync(dir);
    const info = readInfo(dir);
    if (/^(co|có|yes|1|true)$/i.test(info["an"] || "")) { console.log(`- ${slug}: đang ẩn (an: co)`); continue; }
    const epubName = files.find((f) => /\.epub$/i.test(f));
    const pdfName = files.find((f) => /\.pdf$/i.test(f));
    if (!epubName) { console.log(`! ${slug}: không có file .epub, bỏ qua`); continue; }

    let epub;
    try { epub = parseEpub(path.join(dir, epubName)); }
    catch (err) { console.log(`! ${slug}: lỗi đọc EPUB (${err.message}), bỏ qua`); continue; }

    const auto = path.join(dir, "auto");
    fs.rmSync(auto, { recursive: true, force: true });
    fs.mkdirSync(auto, { recursive: true });

    // bìa
    let cover = files.find((f) => /^(cover|bia)\.(png|jpe?g|webp)$/i.test(f));
    let coverUrl;
    if (cover) coverUrl = urlPath("books", slug, cover);
    else if (epub.coverItem) {
      const ext = path.extname(epub.coverItem.href) || ".png";
      fs.writeFileSync(path.join(auto, "cover" + ext), epub.z.get(epub.coverItem.href));
      coverUrl = urlPath("books", slug, "auto", "cover" + ext);
    }

    // nội dung đọc online: dùng content.js viết tay nếu có, không thì sinh từ EPUB
    const title = info["tieu-de"] || epub.meta.title || slug;
    const subtitle = info["phu-de"] || epub.meta.subtitle || "";
    const author = info["tac-gia"] || epub.meta.author || "Hùng Linh";
    let contentUrl, units;
    if (files.includes("content.js")) {
      contentUrl = urlPath("books", slug, "content.js");
      const s = fs.readFileSync(path.join(dir, "content.js"), "utf8");
      try { units = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)).units; } catch { units = []; }
    } else {
      units = buildUnits(epub, urlPath("books", slug, "auto", "img"), path.join(auto, "img"));
      fs.writeFileSync(path.join(auto, "content.js"), "window.BOOK = " + JSON.stringify({ title, subtitle, author, units }) + ";\n");
      contentUrl = urlPath("books", slug, "auto", "content.js");
    }

    const chapters = units.filter((u) => /^chương\b/i.test(u.title)).length || units.filter((u) => u.kind !== "intro").length;
    catalog.push({
      slug,
      order: parseFloat(info["thu-tu"]) || 1000,
      title, subtitle, author,
      year: info["nam"] || epub.meta.date || String(new Date().getFullYear()),
      kicker: info["nhan"] || "Sách",
      cover: coverUrl || "",
      epub: urlPath("books", slug, epubName),
      pdf: pdfName ? urlPath("books", slug, pdfName) : "",
      content: contentUrl,
      read: "read.html?book=" + encodeURIComponent(slug),
      chapters: +info["so-chuong"] || chapters,
      words: info["so-tu"] || fmtWords(countWords(units)),
      blurb: info["gioi-thieu"] || epub.meta.description || "",
    });
    console.log(`+ ${slug}: "${title}", ${units.length} mục, ${chapters} chương${pdfName ? ", có PDF" : ""}`);
  }

  catalog.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "vi"));
  catalog.forEach((b) => delete b.order);
  fs.writeFileSync(path.join(PUB, "books.js"),
    "// File này được tạo tự động bởi scripts/build.mjs. Đừng sửa tay.\nwindow.CATALOG = " + JSON.stringify(catalog, null, 2) + ";\n");
  console.log(`Kệ sách: ${catalog.length} cuốn.`);
}

main();
