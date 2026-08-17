# WhatsApp Panel — Backend (Cloudflare Workers)

Replaces the Apps Script `.gs` business logic. Free tier: 100,000 requests/day,
no credit card required. Live at `https://whatsapp-panel-backend.hasim-c9e.workers.dev`.

**Status**: Foundation + Phase 1 (auth/roles/teams/number-access) + messaging
core (numbers/customers/conversations/messages/webhook/send) ported, tested,
and deployed live — see PROGRESS.md for the full verification history. 35
automated tests cover the actual business logic against a mocked Firebase and
a mocked Exotel endpoint (real RSA JWT signing/verification included, not
stubbed out). Run `npm test`.

## One-time setup (things only you can do)

1. ✅ Cloudflare account created, logged in via `wrangler login`.
2. ✅ `FIREBASE_WEB_API_KEY` secret set (public/safe value, same as the Apps Script build's).
3. ✅ `FIREBASE_SERVICE_ACCOUNT_JSON` secret set — a fresh key generated for
   this backend (Firebase Console → ⚙️ Project Settings → **Service accounts**
   → **Generate new private key**), independent from the Apps Script build's.
4. ✅ `BOOTSTRAP_ADMIN_EMAIL` secret set — the one identity allowed to call
   `POST /api/bootstrap` and become the first ADMIN user.
5. **Set Exotel credentials** (needed before `sendReply` or the webhook can
   actually reach WhatsApp — same Exotel account as the Apps Script build):
   ```bash
   npx wrangler secret put EXOTEL_API_KEY
   npx wrangler secret put EXOTEL_API_TOKEN
   npx wrangler secret put EXOTEL_ACCOUNT_SID
   npx wrangler secret put EXOTEL_SUBDOMAIN
   ```
6. **Set a webhook secret token** (generate a **new** random value — don't
   reuse the Apps Script one, keep the two systems independent until cutover):
   ```bash
   npx wrangler secret put WEBHOOK_SECRET_TOKEN
   ```
   Don't point Exotel at the new webhook URL yet — that's a deliberate later
   cutover step (see PROGRESS.md), not something to do as part of setup.

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the
same values instead — `.dev.vars` is gitignored and only used by `wrangler dev`.

## Commands

```bash
npm install       # once
npm run dev        # local dev server at http://localhost:8787
npm run deploy     # deploy to Cloudflare (needs wrangler login done above)
npm test           # runs test/*.test.ts against a mocked Firebase + Exotel
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
- `src/lib/accessControl.ts` + `src/lib/phase1Repositories.ts` +
  `src/domain/phase1.ts` + `src/services/phase1Api.ts` — direct ports of
  `apps-script/src/Phase1AccessControl.gs` / `Phase1Domain.gs` /
  `Phase1Services.gs`. Same roles, same permissions, same validation rules —
  only the storage layer and identity source changed. `phase1Repositories.ts`
  is the shared repository bundle every later phase's AccessControl is built
  from (mirrors every Apps Script PhaseNApi constructing its own AccessControl
  against the same underlying store).
- `src/services/exotelProvider.ts` — direct port of
  `apps-script/src/Phase3Domain.gs` + `Phase3ExotelProvider.gs`. Same
  confirmed-live base URL/auth pattern, same webhook payload parsing.
- `src/services/phase3Api.ts` / `phase4Api.ts` / `phase5Api.ts` / `phase6Api.ts`
  / `workspaceApi.ts` / `realtimeListenApi.ts` — direct ports of
  `apps-script/src/Phase{3,4,5,6}Services.gs`, `WorkspaceServices.gs`, and
  `RealtimeListenServices.gs`. Round-robin auto-assignment, snooze filtering,
  and template/media sends are deferred to later phases on purpose (see
  PROGRESS.md) — they don't exist on this backend yet.
- `src/routes/phase1.ts` / `messaging.ts` — HTTP endpoints, one-to-one with
  `apps-script/src/Phase1Endpoints.gs` / `Phase6Endpoints.gs` /
  `Phase4Webhook.gs`.
- `test/helpers/mockFirebase.ts` — mocks Google's OAuth2/JWK endpoints, the
  Firebase REST API, and a fake Exotel endpoint for tests, the same "mock the
  external boundary, run the real code" pattern `apps-script/tests/*.js` used.
