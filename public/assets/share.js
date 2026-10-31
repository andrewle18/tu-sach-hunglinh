/* Chia sẻ một cuốn sách: dùng bảng chia sẻ của điện thoại, máy tính thì chép liên kết. */
(function () {
  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var a = document.createElement("textarea"); a.value = text; a.style.position = "fixed"; a.style.opacity = "0";
      document.body.appendChild(a); a.select();
      try { document.execCommand("copy") ? ok() : fail(); } catch (e) { fail(e); }
      a.remove();
    });
  }
  window.shareBook = function (b) {
    if (!b) return;
    var url = new URL(b.share || ("?book=" + encodeURIComponent(b.slug)), location.origin + "/").href;
    var data = { title: b.title, text: b.title + " · " + b.author, url: url };
    if (navigator.share) {
      navigator.share(data).catch(function (e) { if (e && e.name !== "AbortError") copy(url).then(function () { toast("Đã chép liên kết"); }); });
    } else {
      copy(url).then(function () { toast("Đã chép liên kết sách"); }, function () { window.prompt("Chép liên kết này:", url); });
    }
  };
  window.shareBySlug = function (slug) {
    window.shareBook((window.CATALOG || []).find(function (b) { return b.slug === slug; }));
  };
})();
