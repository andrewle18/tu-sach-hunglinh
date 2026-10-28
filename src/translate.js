// Dịch tiếng Anh sang tiếng Việt qua DeepL. Chỉ người có mật khẩu mới dùng được.
// Secret cần đặt trong Cloudflare: DEEPL_API_KEY, TRANSLATE_PASSWORD.
//   POST /api/tr/check                 kiểm tra mật khẩu, trả về hạn mức đã dùng
//   POST /api/tr/text   {texts,html}   dịch một lô đoạn văn
//   POST /api/tr/doc    (multipart)    gửi file Word/PDF/HTML cho DeepL dịch nguyên file
//   POST /api/tr/doc/status {id,key}   hỏi tiến độ
//   POST /api/tr/doc/result {id,key}   lấy file đã dịch

const fails = new Map(); // đếm số lần sai mật khẩu theo IP

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function apiBase(env) {
  if (env.DEEPL_API_URL) return env.DEEPL_API_URL.replace(/\/$/, "");
  return /:fx$/.test(env.DEEPL_API_KEY || "") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

function sameString(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function authorize(request, env) {
  if (!env.DEEPL_API_KEY || !env.TRANSLATE_PASSWORD) return json({ ok: false, error: "not_configured" }, 500);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const rec = (fails.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  if (rec.length >= 10) return json({ ok: false, error: "too_many_attempts" }, 429);
  if (!sameString(request.headers.get("x-pass"), env.TRANSLATE_PASSWORD)) {
    rec.push(now); fails.set(ip, rec);
    return json({ ok: false, error: "bad_password" }, 401);
  }
  return null;
}

async function deepl(env, path, init = {}) {
  const headers = Object.assign({ Authorization: "DeepL-Auth-Key " + env.DEEPL_API_KEY }, init.headers || {});
  return fetch(apiBase(env) + path, Object.assign({}, init, { headers }));
}

async function passError(r) {
  let detail = "";
  try { detail = (await r.json()).message || ""; } catch { /* ignore */ }
  const code = r.status === 456 ? "quota_exceeded" : r.status === 403 ? "bad_api_key" : r.status === 429 ? "busy" : "deepl_error";
  return json({ ok: false, error: code, status: r.status, detail }, r.status === 456 ? 402 : 502);
}

async function usage(env) {
  const r = await deepl(env, "/v2/usage");
  if (!r.ok) return null;
  return r.json();
}

export async function handleTranslate(request, env, url) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const denied = authorize(request, env);
  if (denied) return denied;
  const p = url.pathname;

  if (p === "/api/tr/check") {
    return json({ ok: true, usage: await usage(env) });
  }

  if (p === "/api/tr/text") {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
    const texts = Array.isArray(body.texts) ? body.texts.map(String) : [];
    if (!texts.length || texts.length > 50) return json({ ok: false, error: "bad_batch" }, 400);
    const size = texts.reduce((n, t) => n + t.length, 0);
    if (size > 60_000) return json({ ok: false, error: "batch_too_large" }, 413);
    const payload = { text: texts, target_lang: "VI", preserve_formatting: true };
    if (body.source) payload.source_lang = String(body.source).toUpperCase();
    if (body.html) { payload.tag_handling = "html"; }
    const r = await deepl(env, "/v2/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) return passError(r);
    const data = await r.json();
    return json({ ok: true, translations: (data.translations || []).map((t) => t.text) });
  }

  if (p === "/api/tr/doc") {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return json({ ok: false, error: "no_file" }, 400);
    const fd = new FormData();
    fd.append("target_lang", "VI");
    if (form.get("source")) fd.append("source_lang", String(form.get("source")).toUpperCase());
    fd.append("file", file, file.name || "document");
    const r = await deepl(env, "/v2/document", { method: "POST", body: fd });
    if (!r.ok) return passError(r);
    const d = await r.json();
    return json({ ok: true, id: d.document_id, key: d.document_key });
  }

  if (p === "/api/tr/doc/status" || p === "/api/tr/doc/result") {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
    const id = String(body.id || ""), key = String(body.key || "");
    if (!/^[A-Za-z0-9]+$/.test(id) || !key) return json({ ok: false, error: "bad_id" }, 400);
    const sub = p.endsWith("result") ? "/result" : "";
    const r = await deepl(env, "/v2/document/" + id + sub, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document_key: key }),
    });
    if (!r.ok) return passError(r);
    if (sub) {
      return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "application/octet-stream", "cache-control": "no-store" } });
    }
    const s = await r.json();
    return json({ ok: true, status: s.status, seconds: s.seconds_remaining, billed: s.billed_characters, message: s.error_message || s.message });
  }

  return json({ ok: false, error: "not_found" }, 404);
}
