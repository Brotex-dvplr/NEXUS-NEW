# NEXUS Gemini Chat backend

The NEXUS website is static on GitHub Pages, so it cannot keep a Gemini API key secret or run server-side code. This folder contains a Cloudflare Worker that proxies chat requests to Gemini without exposing the key in the browser.

## Deploy with Cloudflare Workers (no local installation required)

1. Open https://dash.cloudflare.com/ and go to **Workers & Pages**.
2. Create a Worker (for example, `nexus-gemini-chat`).
3. Open the Worker editor and replace its starter code with the full contents of `gemini-worker.js`.
4. In the Worker settings, open **Variables and Secrets** and add a secret:
   - Name: `GEMINI_API_KEY`
   - Value: your key from https://aistudio.google.com/apikey
   Mark it as a **Secret**, not a plain-text variable. Never commit the key to GitHub.
5. Deploy the Worker. Its address will look like `https://nexus-gemini-chat.<your-account>.workers.dev`.
6. Open your NEXUS site, go to **AI Hub**, paste the Worker URL into **آدرس بک‌اند امن**, add `/chat` to the end, then press **ذخیره اتصال**. Example: `https://nexus-gemini-chat.<your-account>.workers.dev/chat`.
7. Send a test message.

## Security notes

- The Worker only allows browser requests from `https://brotex-dvplr.github.io`.
- The API key is read only from the Worker secret `env.GEMINI_API_KEY`; it is never returned to the browser.
- The Worker validates message size and history length and includes a best-effort per-isolate request throttle. For a public production service, configure Cloudflare Rate Limiting/WAF rules too.
- Gemini usage may be subject to quotas, availability, and billing in your Google AI Studio project.
- If your GitHub Pages site later uses a custom domain, update `ALLOWED_ORIGIN` in `gemini-worker.js` to that exact HTTPS origin and redeploy.

## Optional Wrangler CLI deployment

Install Wrangler, log in to Cloudflare, and from this directory run:

```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

When prompted for the secret, paste your API key. Do not place it in `wrangler.toml` or source control.
