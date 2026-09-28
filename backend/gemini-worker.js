/**
 * NEXUS Gemini Chat — Cloudflare Worker backend
 * Deploy this Worker separately from GitHub Pages.
 * Set GEMINI_API_KEY as a Worker Secret; never put it in frontend code.
 */
const ALLOWED_ORIGIN = "https://brotex-dvplr.github.io";
const MODEL = "gemini-2.5-flash";
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
// Best-effort per-isolate throttling. For production, also enable Cloudflare
// rate limiting/WAF rules because isolate memory is not a global rate limiter.
const requestBuckets = new Map();

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}
function isRateLimited(ip) {
  const now = Date.now();
  const bucket = requestBuckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    requestBuckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed." }, 403, origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") return json({ error: "Use POST /chat." }, 405, origin);
    const url = new URL(request.url);
    if (url.pathname !== "/chat" && url.pathname !== "/") return json({ error: "Not found." }, 404, origin);
    if (!env.GEMINI_API_KEY) return json({ error: "Backend is missing its GEMINI_API_KEY secret." }, 503, origin);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (isRateLimited(ip)) return json({ error: "Too many requests. Please wait a minute and try again." }, 429, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400, origin); }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) {
      return json({ error: "Send between 1 and 20 messages." }, 400, origin);
    }
    const contents = [];
    for (const message of body.messages) {
      if (!message || !["user", "model"].includes(message.role) || typeof message.text !== "string") {
        return json({ error: "Invalid message format." }, 400, origin);
      }
      const text = message.text.trim();
      if (!text || text.length > 4000) return json({ error: "Each message must be 1–4000 characters." }, 400, origin);
      contents.push({ role: message.role, parts: [{ text }] });
    }
    if (contents[contents.length - 1].role !== "user") {
      return json({ error: "The latest message must be from the user." }, 400, origin);
    }

    try {
      const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: "You are NEXUS AI, a helpful assistant. Reply in Persian by default unless the user asks for another language. Be clear, practical, and honest about uncertainty." }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
        }),
      });
      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        // Avoid returning provider details or secrets to public clients.
        const status = upstream.status === 429 ? 429 : 502;
        return json({ error: upstream.status === 429 ? "Gemini rate limit reached. Try again shortly." : "Gemini could not complete the request. Check the API key and model access in the backend settings." }, status, origin);
      }
      const reply = (result.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("").trim();
      if (!reply) return json({ error: "Gemini returned an empty response. Try rephrasing your message." }, 502, origin);
      return json({ reply }, 200, origin);
    } catch {
      return json({ error: "Could not reach Gemini. Please try again." }, 502, origin);
    }
  },
};
