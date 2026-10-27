/* Trình đọc kiểu máy đọc sách: thanh công cụ tự ẩn, tiến độ phần trăm, cỡ chữ, nền, mục lục. */
(function () {
  var qs = new URLSearchParams(location.search);
  var CAT = window.CATALOG || [];
  var slug = qs.get("book") || (CAT[0] && CAT[0].slug) || "";
  var meta = CAT.find(function (b) { return b.slug === slug; }) || {};
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var $ = function (s) { return document.getElementById(s); };
  var root = document.documentElement;
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  var units = [], lens = [], cum = [], total = 1, idx = 0;
  var WPM = 230;

  var sc = document.createElement("script");
  sc.src = meta.content || ("books/" + slug + "/content.js");
  sc.onload = init;
  sc.onerror = function () { $("page").innerHTML = '<p style="text-align:center;color:var(--rmuted)">Không tải được nội dung sách.</p>'; };
  document.head.appendChild(sc);

  function words(html) { return (html.replace(/<[^>]+>/g, " ").match(/[^\s]+/g) || []).length; }

  function init() {
    var B = window.BOOK;
    units = B.units || [];
    lens = units.map(function (u) { return Math.max(1, words(u.html)); });
    var acc = 0; cum = lens.map(function (l) { var c = acc; acc += l; return c; }); total = acc || 1;
    document.title = B.title + " · đang đọc";
    $("bookTitle").firstChild.nodeValue = B.title;
    $("dTitle").textContent = B.title;
    if (meta.cover) $("dImg").src = meta.cover; else $("dImg").style.display = "none";
    $("slider").max = Math.max(0, units.length - 1);
    buildToc(); buildDownloads(); restorePrefs(); bind();
    LS.set("opened:" + slug, String(Date.now()));
    LS.set("last", slug);

    var start = 0, frac = 0;
    var h = location.hash.replace("#", "");
    if (h) { var f = units.findIndex(function (u) { return u.id === h; }); if (f >= 0) start = f; }
    else {
      var last = LS.get("pos:" + slug);
      var g = units.findIndex(function (u) { return u.id === last; });
      if (g >= 0) { start = g; frac = parseFloat(LS.get("scroll:" + slug)) || 0; }
    }
    show(start, frac);
    if (LS.get("prog:" + slug) === null) saveProgress();
  }

  function buildToc() {
    var html = "", cur = null;
    units.forEach(function (u, i) {
      if (u.part !== cur) { cur = u.part; html += "<h4>" + esc(u.part) + "</h4>"; }
      var label = u.kind === "intro" ? "Dẫn nhập" : u.title;
      html += '<a href="#' + u.id + '" data-i="' + i + '" class="' + (u.kind === "intro" ? "intro" : "") + '"><span>' + esc(label) + '</span><em>' + Math.round(cum[i] / total * 100) + "%</em></a>";
    });
    $("toc").innerHTML = html;
    $("toc").addEventListener("click", function (e) {
      var a = e.target.closest("a"); if (!a) return;
      e.preventDefault(); closeAll(); show(+a.dataset.i, 0);
    });
  }

  function buildDownloads() {
    var h = "";
    if (meta.epub) h += '<a class="btn" href="' + esc(meta.epub) + '" download style="color:var(--rink);border-color:var(--rrule);background:none">EPUB</a>';
    if (meta.pdf) h += '<a class="btn" href="' + esc(meta.pdf) + '" download style="color:var(--rink);border-color:var(--rrule);background:none">PDF</a>';
    $("dlRow").innerHTML = h || '<span style="color:var(--rmuted)">Chưa có file tải cho cuốn này.</span>';
    if (!h) $("dlBtn").style.display = "none";
  }

  function label(u) { return u.kind === "intro" ? u.part : u.title; }

  function show(i, frac) {
    if (i < 0 || i >= units.length) return;
    idx = i; var u = units[i];
    var head = u.kind === "intro"
      ? '<h1 class="ch-title">' + esc(u.part.replace(" · ", ": ")) + "</h1>"
      : (u.part && u.part !== u.title ? '<div class="eyebrow">' + esc(u.part) + "</div>" : "") + '<h1 class="ch-title">' + esc(u.title) + "</h1>";
    $("page").innerHTML = head + '<div class="orn">· · ·</div><div class="content">' + u.html + "</div>";
    var nx = units[i + 1];
    $("chEnd").innerHTML = nx
      ? '<button class="next" id="nextBtn"><small>Chương tiếp</small><b>' + esc(label(nx)) + "</b></button>"
      : '<p class="fin">Hết sách. Cảm ơn bạn đã đọc.</p><p><a class="next" href="index.html" style="display:inline-flex"><small>Về</small><b>Thư viện</b></a></p>';
    if (nx) $("nextBtn").onclick = function () { show(i + 1, 0); };
    $("chapTitle").textContent = label(u);
    $("slider").value = i; setSliderFill();
    document.querySelectorAll("#toc a").forEach(function (a) { a.classList.toggle("active", +a.dataset.i === i); });
    history.replaceState(null, "", "#" + u.id);
    LS.set("pos:" + slug, u.id);
    requestAnimationFrame(function () {
      var max = document.documentElement.scrollHeight - innerHeight;
      window.scrollTo(0, frac ? Math.round(frac * max) : 0);
      updatePos(); saveProgress();
    });
    root.classList.remove("chrome-off");
  }

  function chapFrac() {
    var max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 1;
  }
  function overall() { return (cum[idx] + lens[idx] * chapFrac()) / total * 100; }

  function updatePos() {
    if (!units.length) return;
    var f = chapFrac(), pct = overall();
    var mins = Math.ceil(lens[idx] * (1 - f) / WPM);
    $("posL").textContent = f > 0.985 ? "Hết chương" : (mins <= 1 ? "Còn dưới 1 phút trong chương" : "Còn " + mins + " phút trong chương");
    $("posR").textContent = Math.max(0, Math.round(pct)) + "%";
    $("dPct").textContent = Math.round(pct) + "% đã đọc";
  }
  var saveT = null;
  function saveProgress() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      LS.set("prog:" + slug, overall().toFixed(2));
      LS.set("scroll:" + slug, chapFrac().toFixed(4));
    }, 250);
  }

  /* ---------- thanh công cụ tự ẩn ---------- */
  var lastY = 0;
  window.addEventListener("scroll", function () {
    var y = scrollY;
    if (y > lastY + 12 && y > 80) root.classList.add("chrome-off");
    else if (y < lastY - 40) root.classList.remove("chrome-off");
    lastY = y; updatePos(); saveProgress();
  }, { passive: true });
  $("scroller").addEventListener("click", function (e) {
    if (e.target.closest("a,button,input,figure,table")) return;
    if (window.getSelection && String(window.getSelection())) return;
    root.classList.toggle("chrome-off");
  });

  /* ---------- thanh trượt chương ---------- */
  function setSliderFill(el) {
    el = el || $("slider");
    var mx = +el.max || 1; el.style.setProperty("--v", (+el.value / mx * 100) + "%");
  }
  $("slider").addEventListener("input", function () {
    setSliderFill();
    var u = units[+this.value]; $("posL").textContent = label(u); $("posR").textContent = Math.round(cum[+this.value] / total * 100) + "%";
  });
  $("slider").addEventListener("change", function () { show(+this.value, 0); });

  /* ---------- bảng điều khiển ---------- */
  var SIZES = [0.94, 1.02, 1.1, 1.18, 1.28, 1.4, 1.54, 1.7];
  var SPACING = { tight: ["1.55", "40em"], normal: ["1.75", "36em"], wide: ["1.95", "32em"] };
  function applyPrefs() {
    var si = parseInt(LS.get("fs"), 10); if (isNaN(si)) si = 3;
    root.style.setProperty("--fs", SIZES[si] + "rem"); $("fs").value = si; setSliderFill($("fs"));
    var t = LS.get("read") || "light"; root.setAttribute("data-read", t);
    document.querySelectorAll("#themes button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === t); });
    var f = LS.get("rfont") || "serif";
    root.style.setProperty("--rfont", f === "sans" ? "'Noto Sans',var(--sans)" : "var(--serif)");
    document.querySelectorAll("#fonts button").forEach(function (b) { b.classList.toggle("on", b.dataset.f === f); });
    var s = LS.get("rspace") || "normal";
    root.style.setProperty("--lh", SPACING[s][0]); root.style.setProperty("--measure", SPACING[s][1]);
    document.querySelectorAll("#spacing button").forEach(function (b) { b.classList.toggle("on", b.dataset.s === s); });
  }
  function restorePrefs() { applyPrefs(); }
  function keepPlace(fn) { var f = chapFrac(); fn(); applyPrefs(); requestAnimationFrame(function () { window.scrollTo(0, f * (document.documentElement.scrollHeight - innerHeight)); updatePos(); }); }
  $("fs").addEventListener("input", function () { var v = this.value; keepPlace(function () { LS.set("fs", v); }); });
  $("themes").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { LS.set("read", b.dataset.t); applyPrefs(); } });
  $("fonts").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) keepPlace(function () { LS.set("rfont", b.dataset.f); }); });
  $("spacing").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) keepPlace(function () { LS.set("rspace", b.dataset.s); }); });

  var bg = $("dBg");
  function closeAll() { ["drawer", "aaPanel", "dlPanel"].forEach(function (id) { $(id).classList.remove("open"); }); bg.classList.remove("open"); }
  function openOne(id) { closeAll(); $(id).classList.add("open"); bg.classList.add("open"); root.classList.remove("chrome-off"); }
  function bind() {
    $("tocBtn").onclick = function () { openOne("drawer"); var a = document.querySelector("#toc a.active"); if (a) a.scrollIntoView({ block: "center" }); };
    $("aaBtn").onclick = function () { openOne("aaPanel"); };
    $("dlBtn").onclick = function () { openOne("dlPanel"); };
    bg.onclick = closeAll;
    document.addEventListener("keydown", function (e) {
      if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") show(idx + 1, 0);
      if (e.key === "ArrowLeft") show(idx - 1, 0);
      if (e.key === "Escape") closeAll();
    });
    window.addEventListener("pagehide", function () {
      LS.set("prog:" + slug, overall().toFixed(2)); LS.set("scroll:" + slug, chapFrac().toFixed(4));
    });
  }
})();
