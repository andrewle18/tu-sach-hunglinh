// Tủ sách Hùng Linh: Worker nhỏ chỉ lo ô chat.
// Mọi request khác được Cloudflare phục vụ thẳng từ public/ (static assets).
// POST /api/message  ->  chuyển tin nhắn tới Telegram của chủ site.

const MAX_NAME = 60;
const MAX_MSG = 2000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const hits = new Map(); // giới hạn tốc độ theo IP (trong bộ nhớ của từng isolate)

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_MAX;
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

async function handleMessage(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  // Honeypot: người thật không thấy ô này, bot thì hay điền vào.
  if (body.hp) return json({ ok: true });

  const name = String(body.name || "").trim().slice(0, MAX_NAME) || "Khách";
  const contact = String(body.contact || "").trim().slice(0, 120);
  const message = String(body.message || "").trim().slice(0, MAX_MSG);
  const page = String(body.page || "").slice(0, 300);
  if (!message) return json({ ok: false, error: "empty_message" }, 400);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (rateLimited(ip)) return json({ ok: false, error: "rate_limited" }, 429);

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const country = request.cf && request.cf.country ? ` · ${request.cf.country}` : "";
  const text =
    `<b>📚 Tin nhắn từ Tủ sách</b>\n` +
    `<b>Từ:</b> ${esc(name)}${contact ? ` (${esc(contact)})` : ""}\n` +
    `<b>Trang:</b> ${esc(page)}${country}\n\n` +
    esc(message);

  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) return json({ ok: false, error: "telegram_failed" }, 502);
  } catch {
    return json({ ok: false, error: "telegram_failed" }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/message") return handleMessage(request, env);
    return env.ASSETS.fetch(request);
  },
};
