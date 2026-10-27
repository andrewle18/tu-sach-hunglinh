/* Ô chat nổi: khách gửi tin, tin bay về Telegram của Hùng Linh. */
(function () {
  var KEY_LOG = "tshl_chat_log", KEY_NAME = "tshl_chat_name";
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var root = document.createElement("div");
  root.className = "chat";
  root.innerHTML =
    '<button class="chat-fab" type="button" aria-label="Nhắn cho tác giả">' +
      '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg></button>' +
    '<section class="chat-panel" role="dialog" aria-label="Nhắn cho tác giả" hidden>' +
      '<header><div><b>Nhắn cho Hùng Linh</b><span>Góp ý, hỏi sách, báo lỗi chính tả…</span></div>' +
      '<button type="button" class="chat-x" aria-label="Đóng">×</button></header>' +
      '<div class="chat-log"></div>' +
      '<form class="chat-form">' +
        '<input class="chat-name" maxlength="60" placeholder="Tên bạn">' +
        '<input class="chat-contact" maxlength="120" placeholder="Email hoặc SĐT (để nhận hồi âm)">' +
        '<input class="chat-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<textarea class="chat-msg" rows="3" maxlength="2000" placeholder="Viết tin nhắn…" required></textarea>' +
        '<button type="submit">Gửi</button>' +
        '<p class="chat-status" aria-live="polite"></p>' +
      '</form>' +
    '</section>';
  document.body.appendChild(root);

  var fab = root.querySelector(".chat-fab"), panel = root.querySelector(".chat-panel"),
      log = root.querySelector(".chat-log"), form = root.querySelector(".chat-form"),
      nameI = root.querySelector(".chat-name"), contactI = root.querySelector(".chat-contact"),
      hp = root.querySelector(".chat-hp"), msgI = root.querySelector(".chat-msg"),
      status = root.querySelector(".chat-status"), btn = form.querySelector("button");

  var saved = load(KEY_NAME, {});
  nameI.value = saved.name || ""; contactI.value = saved.contact || "";

  function render() {
    var items = load(KEY_LOG, []);
    log.innerHTML = "";
    if (!items.length) {
      log.innerHTML = '<p class="chat-empty">Tin nhắn sẽ được chuyển thẳng tới tác giả. Nếu để lại email, bạn sẽ nhận được hồi âm.</p>';
      return;
    }
    items.slice(-20).forEach(function (m) {
      var p = document.createElement("p"); p.className = "chat-bubble"; p.textContent = m.t; log.appendChild(p);
    });
    log.scrollTop = log.scrollHeight;
  }

  function toggle(open) {
    panel.hidden = !open; root.classList.toggle("open", open);
    if (open) { render(); (nameI.value ? msgI : nameI).focus(); }
  }
  fab.addEventListener("click", function () { toggle(panel.hidden); });
  root.querySelector(".chat-x").addEventListener("click", function () { toggle(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) toggle(false); });

  var ERR = {
    empty_message: "Bạn chưa viết gì.",
    rate_limited: "Bạn gửi hơi nhanh, đợi một phút rồi thử lại nhé.",
    not_configured: "Ô chat chưa được cấu hình xong. Bạn thử lại sau nhé.",
    telegram_failed: "Chưa gửi được, bạn thử lại sau ít phút."
  };

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = msgI.value.trim(); if (!text) return;
    save(KEY_NAME, { name: nameI.value.trim(), contact: contactI.value.trim() });
    btn.disabled = true; status.textContent = "Đang gửi…";
    fetch("/api/message", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameI.value, contact: contactI.value, message: text, hp: hp.value, page: location.pathname + location.search })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (d) {
        if (d.ok) {
          var items = load(KEY_LOG, []); items.push({ t: text, at: Date.now() }); save(KEY_LOG, items.slice(-50));
          msgI.value = ""; status.textContent = "Đã gửi. Cảm ơn bạn!"; render();
        } else { status.textContent = ERR[d.error] || "Chưa gửi được, bạn thử lại nhé."; }
      })
      .catch(function () { status.textContent = "Mất kết nối, bạn thử lại nhé."; })
      .then(function () { btn.disabled = false; });
  });
})();
