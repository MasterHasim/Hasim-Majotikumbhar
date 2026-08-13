# WhatsApp Panel — Backend (Cloudflare Workers)

Replaces the Apps Script `.gs` business logic. Free tier: 100,000 requests/day,
no credit card required.

**Status**: Foundation + Phase 1 (auth/roles/teams/number-access) ported and
verified — `wrangler dev` boots cleanly and every route responds correctly
live (see PROGRESS.md), and 18 automated tests cover the actual business
logic against a mocked Firebase (real RSA JWT signing/verification included,
not stubbed out) — bootstrap edge cases, permission enforcement, number-access
grant/revoke/reactivate, and the core `requireConversationOperation`
authorization gate across ADMIN/AGENT roles. Run `npm test`.

## One-time setup (things only you can do)

1. ✅ **Cloudflare account created, logged in via `wrangler login`.**
2. ✅ **`FIREBASE_WEB_API_KEY` secret set** (public/safe value, same as the Apps Script build's).
3. **Get a Firebase service account key for this backend** — generate a fresh
   one rather than reusing the Apps Script build's (independent credentials,
   nothing shared between the two systems): Firebase Console → ⚙️ Project
   Settings → **Service accounts** tab → **Generate new private key** →
   downloads a JSON file. Then:
   ```bash
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON < path/to/downloaded-file.json
   ```
4. **Set the bootstrap admin email** — the one identity allowed to call
   `POST /api/bootstrap` and become the first ADMIN user (same role Apps
   Script's `wap.phase1.bootstrapAdminEmail` Script Property played):
   ```bash
   npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
   ```
   (enter your own email, e.g. `hasim@echt.co.in`)
5. **Set the remaining secrets** the same way (`wrangler secret put <NAME>`),
   needed once messaging is ported:
   - `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_ACCOUNT_SID`, `EXOTEL_SUBDOMAIN` — same Exotel account.
   - `WEBHOOK_SECRET_TOKEN` — generate a **new** random value (don't reuse the Apps Script one; the two systems stay fully independent until cutover).

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the
same values instead — `.dev.vars` is gitignored and only used by `wrangler dev`.

## Commands

```bash
npm install       # once
npm run dev        # local dev server at http://localhost:8787
npm run deploy     # deploy to Cloudflare (needs wrangler login done above)
npm test           # runs test/*.test.ts against a mocked Firebase
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
- `src/lib/repository.ts` — generic Realtime Database-backed repository
  (list/get/findOne/create/update/remove/replace/count), same contract every
  Apps Script repository conformed to.
- `src/lib/accessControl.ts` + `src/domain/phase1.ts` + `src/services/phase1Api.ts`
  — direct ports of `apps-script/src/Phase1AccessControl.gs` /
  `Phase1Domain.gs` / `Phase1Services.gs`. Same roles, same permissions, same
  validation rules — only the storage layer and identity source changed.
- `src/routes/phase1.ts` — HTTP endpoints, one-to-one with
  `apps-script/src/Phase1Endpoints.gs`.
- `test/helpers/mockFirebase.ts` — mocks Google's OAuth2/JWK endpoints and the
  Firebase REST API for tests, the same "mock the external boundary, run the
  real code" pattern `apps-script/tests/*.js` used.
