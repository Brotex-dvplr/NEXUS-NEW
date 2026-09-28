"use strict";

/**
 * NEXUS Gemini backend for Render.
 * Required environment variable: GEMINI_API_KEY
 * Public endpoint: POST /chat
 */
const http = require("node:http");

const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://brotex-dvplr.github.io";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_BODY_BYTES = 64 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
const buckets = new Map();

function sendJson(res, status, data, origin) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  });
  res.end(JSON.stringify(data));
}

function rateLimited(ip) {
  const now = Date.now();
  let entry = buckets.get(ip);
  if (!entry || now - entry.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Invalid JSON body."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    });
    return res.end();
  }

  if (url.pathname === "/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, service: "nexus-gemini-backend" }, origin);
  }

  if (origin !== ALLOWED_ORIGIN) {
    return sendJson(res, 403, { error: "Origin not allowed." }, origin);
  }
  if (url.pathname !== "/chat") return sendJson(res, 404, { error: "Not found. Use POST /chat." }, origin);
  if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST /chat." }, origin);
  if (!process.env.GEMINI_API_KEY) {
    return sendJson(res, 503, { error: "Backend is missing its GEMINI_API_KEY environment secret." }, origin);
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) {
    return sendJson(res, 429, { error: "Too many requests. Please wait a minute and try again." }, origin);
  }

  let body;
  try { body = await readJson(req); }
  catch (err) { return sendJson(res, err.status || 400, { error: err.status === 413 ? "Request too large." : "Invalid JSON body." }, origin); }

  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) {
    return sendJson(res, 400, { error: "Send between 1 and 20 messages." }, origin);
  }

  const contents = [];
  for (const message of body.messages) {
    if (!message || !["user", "model"].includes(message.role) || typeof message.text !== "string") {
      return sendJson(res, 400, { error: "Invalid message format." }, origin);
    }
    const text = message.text.trim();
    if (!text || text.length > 4000) {
      return sendJson(res, 400, { error: "Each message must be 1–4000 characters." }, origin);
    }
    contents.push({ role: message.role, parts: [{ text }] });
  }
  if (contents[contents.length - 1].role !== "user") {
    return sendJson(res, 400, { error: "The latest message must be from the user." }, origin);
  }

  try {
    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(MODEL) + ":generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "You are NEXUS AI, a helpful assistant. Reply in Persian by default unless the user asks for another language. Be clear, practical, and honest about uncertainty." }]
          },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1200 }
        }),
        signal: AbortSignal.timeout(45_000)
      }
    );

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      return sendJson(res, status, {
        error: upstream.status === 429
          ? "Gemini rate limit reached. Try again shortly."
          : "Gemini could not complete the request. Check the API key and model access in Render settings."
      }, origin);
    }

    const reply = (result.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "").join("").trim();
    if (!reply) return sendJson(res, 502, { error: "Gemini returned an empty response. Try rephrasing your message." }, origin);
    return sendJson(res, 200, { reply }, origin);
  } catch {
    return sendJson(res, 502, { error: "Could not reach Gemini. Please try again." }, origin);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("NEXUS Gemini backend listening on port " + PORT);
});
