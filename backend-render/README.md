# NEXUS Gemini backend — Render

This folder contains a small Node.js HTTP server for the NEXUS AI Hub. It keeps the Gemini API key on the server and exposes `POST /chat`, which matches the current NEXUS frontend.

## Deploy on Render

1. Sign in at https://render.com/ and connect your GitHub account if asked.
2. Choose **New + → Web Service**.
3. Select repository `Brotex-dvplr/NEXUS-NEW` and branch `main`.
4. Set **Root Directory** to `backend-render`.
5. Set **Runtime** to **Node**.
6. Set **Build Command** to `npm install`.
7. Set **Start Command** to `npm start`.
8. Choose a plan, then create the Web Service.
9. After the first deploy, open the service's **Environment** tab and add:
   - Key: `GEMINI_API_KEY`
   - Value: your current valid Gemini API key
10. Optionally add `ALLOWED_ORIGIN` with value `https://brotex-dvplr.github.io`. This is the default, so it is not required.
11. Save and deploy the environment changes.
12. Copy the service's public URL, e.g. `https://your-service-name.onrender.com`.
13. Open the NEXUS website, go to AI Hub, and enter `https://your-service-name.onrender.com/chat` in **آدرس بک‌اند امن**, then save.
14. Test a short message. You can also open `https://your-service-name.onrender.com/health`; it should return JSON with `"ok":true`.

## Security and limits

- Never commit the API key to GitHub or put it in frontend HTML/JavaScript.
- If a key was shared publicly or in chat, revoke it and create a replacement before deployment.
- This server only permits browser requests from the GitHub Pages origin configured above.
- The included in-memory rate limit is best-effort per server instance, not a global abuse-prevention system.
- Render free web services can sleep after inactivity, so the first request after a quiet period may take longer.
