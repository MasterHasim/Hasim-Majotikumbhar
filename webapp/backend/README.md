# WhatsApp Panel — Backend (Cloudflare Workers)

Replaces the Apps Script `.gs` business logic. Free tier: 100,000 requests/day,
no credit card required. Live at `https://whatsapp-panel-backend.hasim-c9e.workers.dev`.

**Status**: full Apps Script feature parity (Phases 1-15) reached and
deployed live — auth/roles/teams/number-access, messaging core, CRM core
(round-robin assignment, lead stages, remarks, reminders, snooze), Phase 22
(location leads + Exotel click-to-call), templates/quick-replies/media,
admin panel, search/notifications, dashboard & analytics, backup, and
R2-backed local-file media upload. See PROGRESS.md for the full
verification history. 127 automated tests cover the actual business logic
against a mocked Firebase and mocked Exotel WhatsApp + Voice endpoints
(real RSA JWT signing/verification included, not stubbed out), plus an
in-memory fake R2 binding for the upload path. Run `npm test`. Next up:
parallel-run validation, then cutover — see PROGRESS.md's "Parallel-run
validation, round 1" for the data-isolation fix (webapp's `conversations`/
`messages` collections are now `webapp_conversations`/`webapp_messages`,
since they used to collide with apps-script's live data in the same
Firebase project) and a real validation bug fixed (`Phase1Api.validatePatch`
was missing `roleIds`/`numberIds`/`permissions` checks the apps-script
original always had).

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
  `RealtimeListenServices.gs`. `phase6Api.ts` now also has `sendTemplateReply`/
  `sendMediaReply`; `phase4Api.ts` persists inbound `mediaUrl` from the
  webhook into `messageMedia`. `phase6Api.ts`'s `uploadConversationMedia`
  is the free-tier equivalent of the source's Drive-backed upload: decodes
  a base64 file, writes it to the `MEDIA_BUCKET` R2 binding
  (`whatsapp-panel-media`, configured in `wrangler.toml`), and returns a key.
  `routes/messaging.ts`'s `GET /media/:key` serves it back publicly (no
  Firebase auth — Exotel's servers, not a signed-in browser, must be able to
  fetch it), with the real stored Content-Type, not sniffed.
- `src/services/phase10Api.ts` / `phase11Api.ts` — direct ports of
  `apps-script/src/Phase{10,11}Services.gs`: template draft → submit → sync
  workflow (real `ExotelProvider.createTemplate`/`getTemplates` calls,
  ADMIN-only) and quick-reply CRUD.
- Every service's `conversations`/`messages` `Repository` is actually keyed
  `webapp_conversations`/`webapp_messages` in Firebase — apps-script writes
  its own live data to the plain `conversations`/`messages` paths in the
  same Firebase project (`whatsapp-panel-db`), so this backend uses
  separate paths to avoid colliding with data the daily-use system depends
  on. Every other collection (`numbers`, `customers`, `users`, etc.) was
  already exclusive to this backend, so nothing else needed renaming.
- `src/lib/firebaseAdmin.ts`'s `FirebaseDb` has a request-scoped `list()`
  cache (writes invalidate their collection) — added after live logs
  (`wrangler tail`) showed `WorkspaceApi`'s aggregation hitting Cloudflare's
  Free-tier 50-subrequest-per-invocation cap, since every `PhaseNApi` builds
  its own `AccessControl` from a fresh repository bundle. Same class of fix
  the Apps Script build already made for `SheetRepository`.
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
- `src/services/phase13Api.ts` — direct port of
  `apps-script/src/Phase13Services.gs`: `searchConversations` (composed on
  top of `Phase5Api`'s already-enforced authorization, not a reimplementation
  of it) and `getNeedsResponseCounts`. Phase 12 (admin panel) needed no new
  backend service at all — `Phase1Api`/`Phase3Api`/`NumberAssignmentConfigApi`
  already covered every bit of CRUD it uses.
- `src/services/phase14Api.ts` — direct port of
  `apps-script/src/Phase14Services.gs`: dashboard/analytics metrics, also
  scoped through `Phase5Api.listMyNumbers()`, gated on `REPORTS_VIEW`.
- `src/services/phase15Api.ts` — the free-tier equivalent of
  `apps-script/src/Phase15Services.gs`'s `backupNow()`: a full Firebase
  Realtime Database JSON export (no 1:1 port exists for the source's
  Sheets/Drive-specific `SpreadsheetApp.copy()`, since this backend has no
  spreadsheet). The scheduled-trigger half of the source has no equivalent
  here on purpose — see the file's own header comment.
- `src/routes/phase1.ts` / `messaging.ts` / `crm.ts` / `phase22.ts` /
  `templates.ts` / `search.ts` / `dashboard.ts` / `backup.ts` — HTTP
  endpoints, one-to-one with `apps-script/src/Phase1Endpoints.gs` /
  `Phase6Endpoints.gs` / `Phase4Webhook.gs` / the Phase 7-9 endpoint files /
  `Phase22Endpoints.gs` / the Phase 10-11 endpoint files /
  `Phase13Endpoints.gs` / `Phase14Endpoints.gs` / (`backupNow` had no
  dedicated endpoint file in the source — it hung off `Phase15Services.gs`
  directly).
- `test/helpers/mockFirebase.ts` — mocks Google's OAuth2/JWK endpoints, the
  Firebase REST API, and a fake Exotel endpoint for tests, the same "mock the
  external boundary, run the real code" pattern `apps-script/tests/*.js` used.
