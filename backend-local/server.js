// NEXUS local Groq test backend — Node.js 18+
const http = require('node:http');

const PORT = Number(process.env.PORT || 3000);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const ALLOWED_ORIGINS = new Set([
  'https://brotex-dvplr.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'null'
]);

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true, provider: 'Groq', model: GROQ_MODEL, configured: Boolean(GROQ_API_KEY) }));
  }
  if (req.method !== 'POST' || req.url !== '/chat') {
    res.writeHead(404);
    return res.end(JSON.stringify({ error: 'Not found. Use POST /chat or GET /health.' }));
  }
  if (!GROQ_API_KEY) {
    res.writeHead(503);
    return res.end(JSON.stringify({ error: 'GROQ_API_KEY is missing. Set it in your local environment.' }));
  }

  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy();
  });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}');
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'messages must be a non-empty array' }));
      }
      const messages = body.messages.slice(-20).map(m => ({
        role: (m.role === 'assistant' || m.role === 'model') ? 'assistant' : 'user',
        content: String(m.text || m.content || '').slice(0, 8000)
      })).filter(m => m.content.trim());
      if (!messages.length) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'No usable messages provided' }));
      }

      const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + GROQ_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.7, max_tokens: 1200 })
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        res.writeHead(upstream.status);
        return res.end(JSON.stringify({ error: data.error?.message || 'Groq API request failed (' + upstream.status + ')' }));
      }
      const reply = data.choices?.[0]?.message?.content;
      if (typeof reply !== 'string' || !reply.trim()) {
        res.writeHead(502);
        return res.end(JSON.stringify({ error: 'Groq returned an empty response' }));
      }
      res.writeHead(200);
      res.end(JSON.stringify({ reply: reply.trim(), provider: 'Groq', model: GROQ_MODEL }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message || 'Local backend error' }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('NEXUS local Groq backend listening on http://127.0.0.1:' + PORT);
  console.log('Health check: http://127.0.0.1:' + PORT + '/health');
  console.log('API key configured: ' + Boolean(GROQ_API_KEY));
});
