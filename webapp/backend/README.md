# WhatsApp Panel — Backend (Cloudflare Workers)

Replaces the Apps Script `.gs` business logic. Free tier: 100,000 requests/day,
no credit card required. Live at `https://whatsapp-panel-backend.hasim-c9e.workers.dev`.

**Status**: Foundation + Phase 1 (auth/roles/teams/number-access) + messaging
core (numbers/customers/conversations/messages/webhook/send) + CRM core
(round-robin assignment, lead stages, remarks, reminders, snooze) + Phase 22
(location leads + Exotel click-to-call) ported, tested, and deployed live —
see PROGRESS.md for the full verification history. 90 automated tests cover
the actual business logic against a mocked Firebase and mocked Exotel
WhatsApp + Voice endpoints (real RSA JWT signing/verification included, not
stubbed out). Run `npm test`. Next up: templates, quick replies, media.

## Setup status

All secrets are set — Cloudflare login, `FIREBASE_WEB_API_KEY`,
`FIREBASE_SERVICE_ACCOUNT_JSON` (a fresh key, independent from the Apps
Script build's), `BOOTSTRAP_ADMIN_EMAIL`, `WEBHOOK_SECRET_TOKEN` (generated
automatically, not pointed at Exotel yet on purpose), the 4 Exotel WhatsApp
credentials, and the 4 Exotel Voice credentials (`EXOTEL_VOICE_ACCOUNT_SID`/
`API_KEY`/`API_TOKEN`/`CALLER_ID`). Click-to-call itself is still unverified
against a real Exotel account — see PROGRESS.md's task list.

**One remaining action**: nobody has completed sign-up yet on this new
system — open the frontend, sign in with Google, and click "Become the first
admin" when prompted (see PROGRESS.md).

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
  `RealtimeListenServices.gs`. Template/media sends are deferred to a later
  phase on purpose (see PROGRESS.md) — they don't exist on this backend yet.
- `src/services/phase7Api.ts` (`Phase7Api` + `NumberAssignmentConfigApi`) /
  `phase8Api.ts` / `phase9Api.ts` — direct ports of
  `apps-script/src/Phase{7,8,9}{Domain,Services}.gs`: round-robin assignment
  (eligibility + availability + numberAccess gating, rotation, returning-
  customer inheritance, fallback, working hours, history), lead stages +
  customer stage + remarks, and reminders + snooze. Wired into `phase4Api.ts`
  (auto-assign new conversations) and `phase5Api.ts` (hide snoozed
  conversations from the active inbox); `workspaceApi.ts` aggregates all of it.
- `src/domain/phase22.ts` + `src/services/exotelVoiceProvider.ts` +
  `src/services/phase22Api.ts` — direct ports of
  `apps-script/src/Phase22{Domain,ExotelVoice,Services}.gs`: the six fixed
  locations, lead upload/assignment (single/round-robin/manual, same rotation
  pattern as `phase7Api.ts`'s), lead stage + remarks (reusing `phase8Api.ts`'s
  ownership rule), click-to-call via a separate Exotel Voice credential set
  (still UNVERIFIED against a real account, same flag the source carried),
  and the "start WhatsApp from a lead" bridge into the existing messaging
  services. Added a `phone` field to `User` (`domain/types.ts`) for this.
- `src/routes/phase1.ts` / `messaging.ts` / `crm.ts` / `phase22.ts` — HTTP
  endpoints, one-to-one with `apps-script/src/Phase1Endpoints.gs` /
  `Phase6Endpoints.gs` / `Phase4Webhook.gs` / the Phase 7-9 endpoint files /
  `Phase22Endpoints.gs`.
- `test/helpers/mockFirebase.ts` — mocks Google's OAuth2/JWK endpoints, the
  Firebase REST API, and a fake Exotel endpoint for tests, the same "mock the
  external boundary, run the real code" pattern `apps-script/tests/*.js` used.
