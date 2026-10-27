/* Thư viện kiểu máy đọc sách: lưới bìa, tìm kiếm, lọc, tiến độ đọc, bảng chi tiết. */
(function () {
  var CAT = (window.CATALOG || []).map(function (b, i) { b._i = i; return b; });
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase(); }
  function prog(b) { var p = parseFloat(LS.get("prog:" + b.slug)); return isNaN(p) ? null : Math.max(0, Math.min(100, p)); }
  function opened(b) { return parseInt(LS.get("opened:" + b.slug), 10) || 0; }
  function state(b) { var p = prog(b); if (p === null) return "unread"; if (p >= 98) return "done"; return "reading"; }
  function pctTxt(p) { return p < 1 ? "1%" : Math.round(p) + "%"; }

  var ICON = {
    read: '<svg viewBox="0 0 24 24"><path d="M12 6c-1.6-1.2-3.7-2-6-2H2v14h4c2.3 0 4.4.8 6 2 1.6-1.2 3.7-2 6-2h4V4h-4c-2.3 0-4.4.8-6 2Zm0 0v14"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 3v13m0 0 5-5m-5 5-5-5M5 21h14"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>'
  };

  /* ---------- trạng thái giao diện ---------- */
  var ui = {
    f: LS.get("lib-filter") || "all",
    sort: LS.get("lib-sort") || "recent",
    view: LS.get("lib-view") || "grid",
    cat: "",
    q: ""
  };

  function tile(b) {
    var p = prog(b), st = state(b), badge = "";
    if (st === "unread") badge = '<span class="ribbon">Mới</span>';
    else if (st === "reading") badge = '<span class="pct">' + pctTxt(p) + '</span><span class="bar"><i style="width:' + p + '%"></i></span>';
    else badge = '<span class="done">' + ICON.check + '</span>';
    return '<button class="book" data-i="' + b._i + '" aria-label="' + esc(b.title) + '">' +
      '<div class="cv"><img src="' + esc(b.cover) + '" alt="" loading="lazy">' + badge + '</div>' +
      '<div class="meta-col"><div class="t">' + esc(b.title) + '</div><div class="a">' + esc(b.author) + '</div></div>' +
      '</button>';
  }

  function sorted(list) {
    var l = list.slice();
    if (ui.sort === "title") l.sort(function (a, b) { return a.title.localeCompare(b.title, "vi"); });
    else if (ui.sort === "author") l.sort(function (a, b) { return a.author.localeCompare(b.author, "vi") || a.title.localeCompare(b.title, "vi"); });
    else if (ui.sort === "shelf") l.sort(function (a, b) { return a._i - b._i; });
    else l.sort(function (a, b) { return (opened(b) - opened(a)) || (a._i - b._i); });
    return l;
  }

  function renderShelf() {
    var q = norm(ui.q.trim());
    var list = CAT.filter(function (b) {
      if (ui.f !== "all" && state(b) !== ui.f) return false;
      if (ui.cat && b.kicker !== ui.cat) return false;
      if (q && norm(b.title + " " + b.subtitle + " " + b.author + " " + b.kicker).indexOf(q) < 0) return false;
      return true;
    });
    list = sorted(list);
    var shelf = $("#shelf");
    shelf.className = "shelf" + (ui.view === "list" ? " list" : "");
    shelf.innerHTML = list.length ? list.map(tile).join("") :
      '<div class="empty">' + (q ? "Không tìm thấy sách nào khớp với “" + esc(ui.q) + "”." : "Chưa có sách nào ở mục này.") + '</div>';
    var label = { all: "", reading: " đang đọc", unread: " chưa đọc", done: " đã đọc xong" }[ui.f];
    $("#countLine").textContent = list.length + " cuốn" + label + (ui.cat ? " · " + ui.cat : "");
    document.querySelectorAll("#chips .chip[data-f]").forEach(function (c) { c.classList.toggle("on", c.dataset.f === ui.f); });
    $("#filterBtn").classList.toggle("on", !!ui.cat);
  }

  function renderHome() {
    var last = CAT.find(function (b) { return b.slug === LS.get("last"); });
    var hero = $("#homeHero");
    if (last) {
      var p = prog(last) || 0;
      hero.innerHTML = '<div class="home-hero" data-read="' + last._i + '"><div class="cv"><img src="' + esc(last.cover) + '" alt=""></div>' +
        '<div style="min-width:0;flex:1"><div class="k">Đọc tiếp</div><h2>' + esc(last.title) + '</h2><div class="s">' + esc(last.author) + '</div>' +
        '<div class="prog"><i style="width:' + p + '%"></i></div><div class="p">' + pctTxt(p) + ' đã đọc</div></div></div>';
    } else {
      var first = CAT[0];
      hero.innerHTML = first ? '<div class="home-hero" data-open="' + first._i + '"><div class="cv"><img src="' + esc(first.cover) + '" alt=""></div>' +
        '<div style="min-width:0;flex:1"><div class="k">Gợi ý cho bạn</div><h2>' + esc(first.title) + '</h2><div class="s">' + esc(first.subtitle) + '</div></div></div>' : "";
    }
    $("#railNew").innerHTML = CAT.slice().sort(function (a, b) { return a._i - b._i; }).map(tile).join("");
    var cats = {};
    CAT.forEach(function (b) { (cats[b.kicker] = cats[b.kicker] || []).push(b); });
    $("#railCatWrap").innerHTML = Object.keys(cats).filter(function (k) { return cats[k].length > 1; }).map(function (k) {
      return '<div class="row-h"><h3>' + esc(k) + '</h3><button data-cat="' + esc(k) + '">Xem tất cả</button></div><div class="rail">' + cats[k].map(tile).join("") + '</div>';
    }).join("");
  }

  function renderNowbar() {
    var last = CAT.find(function (b) { return b.slug === LS.get("last"); });
    var nb = $("#nowbar");
    if (!last || state(last) === "done") { nb.hidden = true; return; }
    nb.hidden = false;
    nb.dataset.i = last._i;
    $("#nowImg").src = last.cover;
    $("#nowTitle").textContent = last.title;
    $("#nowSub").textContent = last.author + " · " + pctTxt(prog(last) || 0);
  }

  /* ---------- bảng chi tiết & menu ---------- */
  var sheet = $("#sheet"), bg = $("#sheetBg");
  function openSheet(html) {
    sheet.innerHTML = '<div class="grab"></div>' + html;
    sheet.classList.add("open"); bg.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeSheet() { sheet.classList.remove("open"); bg.classList.remove("open"); document.body.style.overflow = ""; }
  bg.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  var y0 = null;
  sheet.addEventListener("touchstart", function (e) { y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sheet.addEventListener("touchend", function (e) { if (y0 !== null && e.changedTouches[0].clientY - y0 > 80) closeSheet(); y0 = null; });

  function bookSheet(b) {
    var p = prog(b), st = state(b);
    var readLbl = st === "reading" ? "Đọc tiếp · " + pctTxt(p) : st === "done" ? "Đọc lại" : "Đọc ngay";
    openSheet(
      '<div class="top"><div class="cv"><img src="' + esc(b.cover) + '" alt=""></div><div style="min-width:0">' +
      '<div class="k">' + esc(b.kicker) + '</div><h2>' + esc(b.title) + '</h2>' +
      (b.subtitle ? '<div class="s">' + esc(b.subtitle) + '</div>' : "") +
      '<div class="m">' + esc(b.author) + ' · ' + esc(b.year) + '<br>' + b.chapters + ' chương · ' + esc(b.words) + ' chữ</div>' +
      (p !== null ? '<div class="prog"><i style="width:' + p + '%"></i></div>' : "") +
      '</div></div>' +
      (b.blurb ? '<p class="blurb">' + esc(b.blurb) + '</p>' : '<div style="height:18px"></div>') +
      '<div class="acts">' +
      '<a class="btn primary" href="' + esc(b.read) + '">' + ICON.read + esc(readLbl) + '</a>' +
      (b.epub ? '<a class="btn" href="' + esc(b.epub) + '" download' + (b.pdf ? '' : ' style="grid-column:1/-1"') + '>' + ICON.down + 'EPUB</a>' : "") +
      (b.pdf ? '<a class="btn" href="' + esc(b.pdf) + '" download>' + ICON.down + 'PDF</a>' : "") +
      '</div>'
    );
  }

  function opt(label, on, attr) { return '<button class="opt' + (on ? " on" : "") + '" ' + attr + '>' + label + '</button>'; }
  function sortSheet() {
    openSheet('<div class="menu"><h4>Sắp xếp</h4>' +
      opt("Đọc gần đây", ui.sort === "recent", 'data-sort="recent"') +
      opt("Thứ tự trên kệ", ui.sort === "shelf", 'data-sort="shelf"') +
      opt("Tên sách", ui.sort === "title", 'data-sort="title"') +
      opt("Tác giả", ui.sort === "author", 'data-sort="author"') +
      '<h4 style="margin-top:18px">Kiểu xem</h4>' +
      opt("Lưới bìa", ui.view === "grid", 'data-view="grid"') +
      opt("Danh sách", ui.view === "list", 'data-view="list"') + '</div>');
  }
  function catSheet() {
    var cats = [];
    CAT.forEach(function (b) { if (cats.indexOf(b.kicker) < 0) cats.push(b.kicker); });
    openSheet('<div class="menu"><h4>Thể loại</h4>' + opt("Tất cả thể loại", !ui.cat, 'data-cat=""') +
      cats.map(function (c) { return opt(esc(c), ui.cat === c, 'data-cat="' + esc(c) + '"'); }).join("") + '</div>');
  }
  function themeSheet() {
    var cur = document.documentElement.getAttribute("data-ui") || "dark";
    openSheet('<div class="menu"><h4>Giao diện thư viện</h4>' + opt("Tối", cur === "dark", 'data-ui="dark"') + opt("Sáng", cur === "light", 'data-ui="light"') + '</div>');
  }
  sheet.addEventListener("click", function (e) {
    var t = e.target.closest("[data-sort],[data-view],[data-cat],[data-ui]");
    if (!t) return;
    if (t.dataset.sort) { ui.sort = t.dataset.sort; LS.set("lib-sort", ui.sort); }
    if (t.dataset.view) { ui.view = t.dataset.view; LS.set("lib-view", ui.view); }
    if (t.hasAttribute("data-cat")) { ui.cat = t.dataset.cat; }
    if (t.dataset.ui) {
      document.documentElement.setAttribute("data-ui", t.dataset.ui); LS.set("ui-theme", t.dataset.ui);
      document.querySelector('meta[name="theme-color"]').content = t.dataset.ui === "light" ? "#f4f3f0" : "#141414";
      $("#mThemeVal").textContent = t.dataset.ui === "light" ? "Sáng" : "Tối";
    }
    closeSheet(); renderShelf();
  });

  /* ---------- tab ---------- */
  function go(tab) {
    ["lib", "home", "more"].forEach(function (t) { document.getElementById("v-" + t).hidden = t !== tab; });
    document.querySelectorAll(".tabbar button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    if (tab === "home") renderHome();
    LS.set("lib-tab", tab);
    window.scrollTo(0, 0);
  }
  document.querySelector(".tabbar").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) go(b.dataset.tab); });

  /* ---------- sự kiện ---------- */
  document.addEventListener("click", function (e) {
    var bk = e.target.closest(".book");
    if (bk) { bookSheet(CAT[+bk.dataset.i]); return; }
    var hr = e.target.closest(".home-hero");
    if (hr) { if (hr.dataset.read) location.href = CAT[+hr.dataset.read].read; else bookSheet(CAT[+hr.dataset.open]); return; }
    var g = e.target.closest("[data-go]");
    if (g) { go(g.dataset.go); return; }
    var c = e.target.closest(".row-h [data-cat]");
    if (c) { ui.cat = c.dataset.cat; go("lib"); renderShelf(); }
  });
  $("#chips").addEventListener("click", function (e) {
    var c = e.target.closest(".chip[data-f]");
    if (c) { ui.f = c.dataset.f; LS.set("lib-filter", ui.f); renderShelf(); }
  });
  $("#filterBtn").addEventListener("click", catSheet);
  $("#sortBtn").addEventListener("click", sortSheet);
  var qi = $("#q");
  qi.addEventListener("input", function () { ui.q = qi.value; $("#searchBox").classList.toggle("has", !!qi.value); renderShelf(); });
  $("#qClear").addEventListener("click", function (e) { e.preventDefault(); qi.value = ""; ui.q = ""; $("#searchBox").classList.remove("has"); renderShelf(); qi.focus(); });
  var nb = $("#nowbar");
  function goNow() { location.href = CAT[+nb.dataset.i].read; }
  nb.addEventListener("click", goNow);
  nb.addEventListener("keydown", function (e) { if (e.key === "Enter") goNow(); });
  $("#mChat").addEventListener("click", function () { if (window.openChat) window.openChat(); });
  $("#mTheme").addEventListener("click", themeSheet);
  $("#mThemeVal").textContent = (document.documentElement.getAttribute("data-ui") === "light") ? "Sáng" : "Tối";
  $("#mReset").addEventListener("click", function () {
    CAT.forEach(function (b) { ["prog:", "opened:", "pos:", "scroll:"].forEach(function (k) { LS.del(k + b.slug); }); });
    LS.del("last"); renderShelf(); renderNowbar(); go("lib");
  });
  window.addEventListener("pageshow", function () { renderShelf(); renderNowbar(); });

  renderShelf();
  renderNowbar();
  var startTab = LS.get("lib-tab");
  if (startTab && startTab !== "lib") go(startTab);
})();
