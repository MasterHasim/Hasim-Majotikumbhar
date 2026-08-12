# WhatsApp Panel — Backend (Cloudflare Workers)

Replaces the Apps Script `.gs` business logic. Free tier: 100,000 requests/day,
no credit card required. Verified locally — `wrangler dev` boots cleanly,
`/health` and `/api/whoami` both respond correctly (see PROGRESS.md).

## One-time setup (things only you can do)

1. **Create a free Cloudflare account** at https://dash.cloudflare.com/sign-up
   if you don't already have one.
2. **Install and log in to Wrangler** (run from this folder):
   ```bash
   npx wrangler login
   ```
   This opens a browser to authorize the CLI — no payment info required for
   the Workers Free plan.
3. **Get the Firebase service account JSON as one line** — this is the *same*
   file already used by the Apps Script build (it was base64-encoded there as
   `FIREBASE_SERVICE_ACCOUNT_B64`). Decode it back to plain JSON, then:
   ```bash
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
   ```
   paste the JSON when prompted.
4. **Set the remaining secrets** the same way (`wrangler secret put <NAME>`):
   - `FIREBASE_WEB_API_KEY` — same value as the Apps Script build's.
   - `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_ACCOUNT_SID`, `EXOTEL_SUBDOMAIN` — same Exotel account, needed once messaging is ported.
   - `WEBHOOK_SECRET_TOKEN` — generate a **new** random value (don't reuse the Apps Script one; the two systems stay fully independent until cutover).

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the
same values instead — `.dev.vars` is gitignored and only used by `wrangler dev`.

## Commands

```bash
npm install       # once
npm run dev       # local dev server at http://localhost:8787
npm run deploy    # deploy to Cloudflare (needs wrangler login done above)
npm run typecheck
```

## Structure

- `src/index.ts` — router + top-level error/CORS handling.
- `src/lib/firebaseAdmin.ts` — service-account JWT signing (Web Crypto, no
  Node Admin SDK) for admin-level Realtime Database access, plus minting
  scoped custom tokens for the browser's direct realtime connection.
- `src/lib/auth.ts` — verifies Firebase ID tokens sent by the frontend, against
  Google's public keys, without the Admin SDK.
- `src/lib/cors.ts` — CORS handling, allowed origins via `ALLOWED_ORIGINS`.
