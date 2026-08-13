# WhatsApp Multi-Number CRM — Progress Report

**Last updated:** 2026-08-10 (overnight autonomous run through Phase 18, then a full day of live testing/direct feedback — see `memory/DECISIONS.md` and `memory/CHANGELOG.md`)
**Purpose:** single source of truth for "what's done, what's left, and what needs you personally." Updated after every phase/transition. See `docs/ROADMAP.md` for full phase scope, `memory/CHANGELOG.md` for full per-phase detail (this file stays intentionally brief per phase), and `memory/DECISIONS.md` for architectural reasoning.

## 🚧 Migration in progress: moving off Apps Script to a free, faster stack

Per your decision, the app is being rebuilt on Cloudflare Workers (backend) +
Firebase Realtime Database (already in use) + React (frontend) — all free
tier, no credit card required anywhere. The two builds are kept **completely
separate** on disk: `apps-script/` (current, live, what your team uses today
— untouched and still being bug-fixed in parallel) and `webapp/` (the new
build, `webapp/backend/` + `webapp/frontend/`). Nothing moves over to the new
one until it's fully validated — see the phase list further down.

**Status: foundation built and verified working.**
- `webapp/backend/` — Cloudflare Workers project. Verified locally: boots
  cleanly, routing/error-handling/CORS all work, and the auth-checking
  pipeline correctly rejects unauthenticated requests. Firebase Admin access
  (reading/writing the database, minting realtime tokens) is built using the
  same JWT-signing approach the Apps Script build used, adapted to Workers'
  native Web Crypto API instead of Apps Script's `Utilities` — no Firebase
  Admin SDK needed (it isn't Workers-compatible).
- `webapp/frontend/` — React app (Vite). Verified: typechecks clean, builds
  clean, dev server boots. Has a working Google-sign-in screen that calls the
  new backend and shows the response — proves the whole chain (browser →
  Firebase Auth → ID token → Workers → verified → response) works end to end,
  the same kind of real round-trip check that caught the Apps Script realtime
  bugs earlier, done now before any real feature logic is built on top.

**Phase 1 (auth/roles/teams/number-access) ported and tested.** Direct port of
`apps-script/src/Phase1{Domain,AccessControl,Services,Endpoints}.gs` — same
five roles, same permission rules, same validation, only the storage layer
(Realtime Database instead of Script Properties) and identity source
(verified Firebase ID token instead of `Session.getActiveUser()`) changed.
Verified two ways: live against a running `wrangler dev` server (every one of
the 24 endpoints correctly routes and enforces auth), and with 18 automated
tests against a mocked Firebase — real RSA JWT signing/verification included,
not stubbed out — covering bootstrap edge cases, permission enforcement, and
the core `requireConversationOperation` authorization gate across roles. One
real bug was caught and fixed by these tests (a test-isolation issue in the
Google-public-key cache, not a production bug). Run `npm test` in
`webapp/backend/`.

### ✅ Action needed from you — new stack setup (one-time, ~15 minutes)

1. ✅ Cloudflare account created, `wrangler login` done.
2. ✅ `FIREBASE_WEB_API_KEY` secret set.
3. **Generate a Firebase service account key for this backend** (a fresh one,
   not the Apps Script build's — independent credentials): Firebase Console →
   ⚙️ Project Settings → **Service accounts** → **Generate new private key**,
   then from `webapp/backend/`:
   ```
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON < path\to\downloaded-file.json
   ```
4. **Set the bootstrap admin email** (the one identity allowed to become the
   first ADMIN user in the new system):
   ```
   npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
   ```
   (enter your own email)
5. For local development instead of live secrets: copy
   `webapp/backend/.dev.vars.example` → `.dev.vars` and
   `webapp/frontend/.env.example` → `.env.local`, fill in the same values.
   Both files are gitignored.

Full details are in `webapp/backend/README.md` and `webapp/frontend/README.md`.
I can't do these specific steps myself — they need your Cloudflare account and
the credential values only you have access to. Everything else (all the
actual code) I'm building without needing anything further from you, phase by
phase, same order as the original build:

1. ~~Foundation (backend + frontend scaffolding, auth pipeline proven)~~ ✅ done
2. ~~Phase 1 — auth, roles, teams, number access~~ ✅ done, tested
3. Messaging core — numbers, customers, conversations, messages, webhook, send (highest priority, since it's already Firebase-native) — **in progress**
4. CRM core — assignment, remarks, reminders, stages
5. Templates, quick replies, media
6. Admin panel, notifications, dashboard, audit/backup
7. Parallel-run validation, then cutover (Apps Script stays live and untouched the entire time)

---

## Action needed from you right now (Apps Script build — daily use)

- **Real-time message delivery is live and confirmed working end-to-end (@55).** New messages now appear the instant they arrive, via the browser talking to Firebase directly instead of through Apps Script. Getting here needed three separate fixes beyond the original build (@50):
  1. **Concurrency pileup (@51)** — opening a conversation was firing 5+ parallel Apps Script executions at once (workspace data, the listen token, templates, quick replies, stages); the Executions panel showed even unrelated Sheets-only calls stuck "Running" for 6-7s as a result. The listen token now rides inside the existing `getConversationWorkspace` call instead of its own round trip.
  2. **Firebase Authentication was never enabled for the project** — `signInWithCustomToken` can't work at all until the Authentication product itself is initialized in the Firebase console, separately from Realtime Database and the registered web app. Enabled directly (Email/Password + Google providers, per your request).
  3. **Security rules broke the live query** — `.read` was defined per-message (`$messageId`), but Firebase rejects an entire `orderBy`/`equalTo` query if the read rule depends on data below the queried location. Fixed using Firebase's query-based rules pattern (checks `query.orderByChild`/`query.equalTo` against a lookup on `/conversations/{id}/numberId`, evaluable without touching individual message records) — still scoped to exactly the numbers an agent has been granted, same as everywhere else in the app. Live-verified via a visible debug banner injected into the running app: confirmed `signIn OK` and `ES OPEN` (EventSource connected) before removing the debug scaffolding.

  Please do a final real-world check: open a conversation and have someone message it from WhatsApp without touching the panel — it should now appear without any refresh.
- ~~"Sent reply not showing in the thread"~~ — confirmed working by you. Resolved.
- ~~Authorize the Drive scope~~ — done, confirmed by you.
- ~~Domain-restricted deployment~~ — checked, it's already "Anyone," not the cause of anything. Ruled out.
- **Media delivered as generic binary ("Bin format"), not viewable — fixed, needs retest (@42).** Root cause: Drive's `export=download` link ignores the file's real type and serves everything as `application/octet-stream`, so WhatsApp couldn't tell it was an image. Switched to `export=view`, which serves the real Content-Type. Confirmed-by-reasoning for images; video/audio/document delivery through this same URL format is still unverified — flag it again if a non-image attachment still comes through wrong.
- **Test "Add user" end-to-end (deployed @41).** Creating a user now automatically emails them a welcome message with a temporary password included directly (not a link) — no separate "send setup link" step needed. If the email doesn't arrive, the temp password still shows in an alert to you as a fallback, and the per-row "Send setup link"/"Generate temp password" buttons remain as manual alternatives.
- **Change-password screen UI fixed + password show/hide added (@43).** The full-width bug was a real CSS gap. Test the "Current password is incorrect" flow again with the eye toggle to check exactly what you're typing.
- **All "Edit" buttons across the admin pages now use a proper card/dropdown modal instead of sequential prompt() popups (@44, and a real bug in it fixed at @45 — the modal wasn't appearing at all due to a CSS conflict).** Users, Customer details, Quick Replies, Team Members, WhatsApp Numbers, Lead Stages. Please click through each once to confirm they save correctly. Three lower-priority prompt()s remain (snooze duration, template variables, submit-for-review wabaId) — not "edit a record" flows, left for now unless you want those converted too.
- **"User number assignment" — Edit User now manages WhatsApp number access directly (@46).** This was a real gap: number access lived only on a separate Settings page. Edit User now shows a checklist of every number with current access pre-checked. Please test toggling a number on/off for a user.
- **Firebase Realtime Database migration is LIVE (@47), and a real perf regression in it was found and fixed (@49).** Messages/Conversations moved to Firebase (@47), but you reported it still felt slow right after — turned out `FirebaseRealtimeDbRepository` was missing the same per-request read cache `SheetRepository` already had, so one dashboard/workspace load was doing 4+ separate live network calls to Firebase for data that hadn't changed between them. Fixed and deployed (@49), with direct test coverage proving 3 repository instances now produce exactly 1 network read. **Also fixed the "page refreshing" complaint (@48)**: every action was flashing the chat pane and conversation list to a blank "Loading…" before repopulating — not an actual page reload, but felt like one. Old content now stays on screen through the round trip. **Please retest now**: click through reply/note/assign/resolve and confirm it feels instant, not flashing or slow. Everything else (Numbers, Customers, Templates, Users, etc.) is still on Sheets by design — see the exchange in chat for why moving the rest isn't recommended right now.
- See the **full wake-up task list** at the bottom of this file for everything else queued up (template live-send verification, seeding lead stages, etc.)

## Phase status

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Project Foundation & Architecture | ✅ Done | |
| 1 | Authentication, Users & Authorization | ✅ Done, live-verified | Hasim is ACTIVE ADMIN |
| 2 | Core Database / Repository Layer | ✅ Done, live-verified | |
| 3 | WhatsApp Numbers & Exotel Integration | ✅ Done, live-verified | 10 numbers registered (8 fully, 2 partially) |
| 4 | Webhook & Message Ingestion | ✅ Done, live-verified | |
| 5 | Conversations & Inbox | ✅ Done, live-verified | |
| 6 | Agent Reply / Outbound Messaging | ✅ **Live-confirmed 2026-08-10** — a real reply sent from the portal reached the customer on WhatsApp | Template/media sends within this phase's family are still unverified (see Phase 10/11) |
| 7 | Assignment & Round-Robin Engine | ✅ Code done, Node-tested | Auto-assigns new leads on ingestion; no live send involved, so no user-dependent verification needed here |
| 8 | CRM-lite: Customers, Stages, Remarks | ✅ Code done, Node-tested | Stage seed needs a one-time live run (see task list) |
| 9 | Reminders, Snooze & Follow-up | ✅ Code done, Node-tested | |
| 10 | WhatsApp Templates | 🟡 Code done, Node-tested — live submit/send pending you | `createTemplate`/`sendTemplate` real-world side effects, deliberately not invoked live |
| 11 | Quick Replies & Media | 🟡 Code done, Node-tested — live media send pending you | `sendMedia`/inbound media extraction both unverified (no real media message ever sent/received) |
| 12 | Admin Panel & Configuration | ✅ Code done, Node-tested (backend) | New `frontend/Admin.html` — needs your live click-through, see task list |
| 13 | Notifications, Search & Productivity | ✅ Code done, Node-tested | "Notifications" scoped to in-UI needs-response badges (no push/email — see Decisions) |
| 14 | Dashboard & Analytics | ✅ Code done, Node-tested | "Resolved" always 0 — no close-conversation workflow exists yet, see task list |
| 15 | Audit, Security, Backup & Reliability | 🟡 Code done, Node-tested — live verify pending you | New OAuth scopes added (drive.file, script.scriptapp) — fresh consent screen expected |
| 16 | Testing & QA | ✅ Done | Found + fixed one real access-control bug (getCustomerStage) — see below |
| 17 | Production Deployment | 🟡 Readiness checklist done (`docs/DEPLOYMENT.md`) — go-live is your decision | This system has effectively been live since Phase 4; nothing left is a code gap |
| 18 | Zoho Integration Preparation | ✅ Done — mapping documented (`docs/ZOHO_PHASE_2.md`) | 5 open questions only you can answer before Phase 19 can start |
| 19 | Zoho CRM Integration | ⬜ Blocked — needs your Zoho credentials + answers to Phase 18's open questions | |
| 20 | Production Hardening & Optimization | ⬜ Blocked — needs real usage data that doesn't exist yet | |
| 21 | Final Documentation & Handover | ⬜ Deliberately not started — depends on Phases 17/19/20 per the roadmap's "do not build out of order" rule, and those are blocked on you | |

## Recently shipped (brief — see `memory/CHANGELOG.md` for full detail)

- **Live-testing round 2 (@33-@35)**: confirmed the audit log migration ran clean (1625 entries moved). Added `CacheService` cross-request caching for speed, then **reverted it same-session** after you reported a sent reply not appearing in the thread — too risky for message data, not worth it. Replaced the old 3-prompt() media-URL flow with a real local-file picker (uploads to a dedicated Drive folder, sets link-sharing so Exotel can fetch it — delivery itself still unverified). Added a visible scrollbar + smooth scroll to the message pane. **Real send confirmed working**: a reply sent from the portal reached the customer on WhatsApp for the first time.
- **Four real bugs found from your live testing, all fixed and deployed (@29-@32)**: (1) landing screen stuck on "Loading…" forever — a failure-handler helper (`renderError`) was referenced but never defined, so the call threw before the request to the server was even sent; (2) every repository read did a full Sheets table scan, and the aggregated workspace endpoint re-read the same tables 3-4x over — added a short-TTL, write-invalidated read cache shared across repository instances; (3) the audit log's single Property-blob storage hit Apps Script's quota after a month of real use, breaking "Add Note" and silently breaking other audit-logged actions — moved to a proper Sheets tab (**needs your one-time migration run, see above**); (4) the conversation panel's message pane used a hardcoded height that didn't account for whatever sat above it (e.g. Dashboard's KPI row), pushing the compose box below the fold and forcing double-scrolling — now sizes itself to whatever room is actually left, plus added message avatars and Enter-to-send on both Reply and Note.
- **Number-picker restored + everything properly scoped**: you asked for the original "select a number first" screen back (I'd dropped it earlier the same session) and for nothing to mix across numbers once you're inside one. Done — Dashboard, Inbox, All Conversations, Unassigned, Customers, Reminders, Reports, and the notification bell are all now scoped to whichever number you picked on the landing screen. Admin pages (Users, Teams, WhatsApp Numbers, Templates, Quick Replies, Settings, Audit Log) are still org-wide, since those aren't conversation data.
- **Unified sidebar-nav redesign**: the whole panel now matches the reference CRM mockup you shared — one app, dark-green sidebar navigation (Dashboard, Inbox, All Conversations, Unassigned, Reminders, Customers, Reports, plus the former Admin Panel sections), a real KPI dashboard, a redesigned chat panel (inline Assign dropdown, Reply/Note tabs, sender names, inline media), and a Customer Details side panel (edit contact info, Previous Conversations, Notes, Reminders). No more separate `?page=admin` — that page is retired. New: an Availability dropdown in the top bar (this already existed on the backend since Phase 1 but was never wired to any UI until now) and a notification bell. KPI cards show real counts only, not fake "vs yesterday" trends, per your own call. This was almost entirely a frontend rewrite — all 20 backend tests still pass.
- **Inbox polish**: fixed four real gaps from your workspace screenshot — conversation list shows customer names now (was showing "OPEN"), replies show who sent them ("Rahul replied," per the original spec, previously invisible), media messages show an actual image/link instead of placeholder text, and Remarks/Reminders are now collapsible sections below the compose box instead of always-expanded panels pushing the chat thread out of view.
- **Number/org-select landing screen**: the Web App now opens on a card grid — one card per number you can access, with a needs-response badge — matching the Superfone screenshot you shared. Click a card to enter that number's inbox (Conversations + Detail, same as before); "← Switch number" in the header takes you back to the grid. The old always-visible Numbers list pane is gone — you pick once, up front.
- **Chatbot/webhook incident (resolved)**: the chatbot on 079-485-02810 was intercepting messages for every number because Exotel routes webhooks per-account, not truly per-number — confirmed our own code was untouched all day, so it wasn't a regression from anything I did. Fixed by you re-adding our webhook URL to that same slot.
- **Post-Phase-18 follow-up** (your direct feedback after using the live system): **Resolve** — any assigned agent or ADMIN can now mark a conversation resolved (button in the detail header); resolved conversations leave the active list but are still findable via search. **Reports are now scoped** — Supervisors/Site Managers see only numbers/data they actually have access to, not the whole org (reverses this morning's earlier decision, per your explicit instruction). **Speed** — diagnosed and fixed the real cause: opening a conversation was firing 8 separate server calls; now it's 1, plus templates/quick replies are cached instead of re-fetched every time. Declined a full database migration for now (see `memory/DECISIONS.md`) since this addressed the actual measured cause — flag it again if things are still slow after real daily use. Media sending bug is still open — **need diagnostics from you** (see task list).
- **Phase 17/18**: Wrote `docs/DEPLOYMENT.md` (current deployment/credential/scope state against the roadmap's go-live checklist — nothing here is a code gap, "going live" is entirely your decision) and `docs/ZOHO_PHASE_2.md` (the full entity mapping the roadmap calls for, plus 5 open questions only you can answer before Zoho integration itself can start — Lead vs. Contact, what "Won" maps to, the dedupe key, your Zoho edition/customizations, and sync conflict resolution). Also appended a Phase 15/16 section to `docs/SECURITY.md` tying together the audit-coverage mapping and the `getCustomerStage` fix. **Phases 19-21 are genuinely blocked** — 19 needs real Zoho credentials, 20 needs real usage data, and 21 (final handover docs) deliberately waits on 17/19/20 per the roadmap's own "don't build out of order" rule. This is as far as I can take the roadmap unattended.
- **Phase 16**: Systematic QA pass. Added a consolidated test runner (`node tests/run-all.js`) and a coverage matrix (`docs/TESTING.md`). **Found and fixed a real security bug**: `getCustomerStage` had no authorization check at all — any signed-in Google account could read any customer's lead stage. It's fixed now (matches `setCustomerStage`'s own access rule) and there's a permanent automated check (`authorization-sweep-verification.js`) that would catch this class of bug again on any future endpoint. This already went through the same testing/deploy/commit process as every other phase — nothing further needed from you here, just flagging that it happened since it's a security-relevant fix.
- **Phase 15**: Confirmed audit-event coverage and secrets hygiene are already solid (no new code needed — just documented the mapping). New: backup — "Back up now" (full spreadsheet copy into Drive) and an optional daily 2am automatic backup, both in the Admin Panel's new Backup section. **Needs your live click-through** — I added two new OAuth scopes to run this (`drive.file`, `script.scriptapp`), so the next execution will show a fresh Google consent screen; see task list.
- **Phase 14**: Dashboard/reports — conversation totals + per-number/per-agent breakdowns, average first-response time, stage distribution, template usage, lead conversion rate. Gated on `REPORTS_VIEW` (SUPERVISOR/SITE_MANAGER/VIEWER/ADMIN — a permission Phase 1 defined but nothing used until now). A "Reports" link/overlay was added to the main inbox. **Real gap found while building this**: no phase has ever added a way to close/resolve a conversation, so the "resolved" metric always reports 0 — see the task list below, this is a real product decision for you, not something I should invent unattended.
- **Phase 13**: Search (customer name/phone/message text) + filters (assigned agent, status, needs-response, unassigned, stage, date range) across conversations, optionally spanning every number you can access at once. A filter bar now sits above the Conversations pane, and each number shows a red needs-response count badge (Phase 13's scoped interpretation of "Notifications" — no push/email infrastructure, see Decisions). Nothing here needed live/costly verification.
- **Phase 12**: Admin Panel (`frontend/Admin.html`, at `?page=admin`) — Dashboard counts, Users, Teams, Numbers, Number Access, Assignment Rules (new `Phase12Api` — the only genuinely new backend piece, since `Number_Assignment_Config`/`Number_Assignment_Users` had no admin CRUD before), Lead Stages, Quick Replies, Templates, Audit Log. Also closed Phase 7's deferred reassignment-UI gap: a "Reassign…" button now in the main inbox detail header, backed by a new properly role-scoped `listAssignableUsers` endpoint. Nothing here needed live/costly verification (pure internal CRUD + authorization), but **you should click through the real deployed Admin Panel once** to confirm the UI itself renders and behaves as expected — see task list.
- **Phase 11**: Quick replies (admin-managed shortcut list, `SETTINGS_MANAGE`; any authenticated user can list/use — inserted into the compose textarea, not sent directly) and media messages (`Phase6Api.sendMediaReply`, new `Message_Media` tab for both outbound sends and inbound webhook ingestion when a `mediaUrl` is present). Quick-reply `<select>` and a "Media…" button added to the compose row. `sendMedia`/inbound media extraction are both unverified — no real media message has ever been sent or received on this integration. Nothing else here needed live/costly verification (quick replies are pure internal logic).
- **Phase 10**: Template draft → admin review → submit → sync workflow (`Phase10Api`), sending an approved template with variable substitution (`Phase6Api.sendTemplateReply`). `syncTemplatesFromProvider` reuses the already-live-confirmed `getTemplates()` call, but `submitTemplateForReview` (creates a real template on your WABA) and `sendTemplateReply` (a real send) are both held for you, same as Phase 6's plain-text sending. Template dropdown added to the compose row.
- **Phase 9**: Reminders (create/complete/cancel, personal "my reminders" list) and snooze (hides a conversation from Phase 5's active list until it auto-expires — no scheduled job, just a timestamp check). Reminders + snooze UI added. Nothing here needed live/costly verification.
- **Phase 8**: Lead stage definitions (admin-only, default 7-stage list ready to seed), per-customer current stage (its own new tab — `Customers` already has real data and `SheetRepository` can't safely migrate an existing schema, see `memory/DECISIONS.md`), internal remarks. Stage dropdown + remarks panel added to the UI. Nothing here needed live/costly verification.
- **Phase 7**: `Phase7Api` round-robin engine — eligibility (active + numberAccess + assignmentEligibility + availability, all independent), rotation with self-healing pointer, returning-customer inheritance, fallback/unassigned queue, working hours, full assignment history. Wired into Phase 4's ingestion (new leads now auto-assign for real). Manual `reassignConversation` works at the API level; no UI control yet (deferred to Phase 12, needs a properly-scoped user list endpoint). Nothing here needed live/costly verification — it's pure internal logic, fully covered by `tests/phase7-assignment-verification.js`.
- **Phase 6**: `Phase6Api.sendReply` — ADMIN or the assigned AGENT only (fixed a real ADMIN-scope gap in `AccessControl.requireConversationOperation` along the way, promoted team-scope resolution into a shared `AccessControl` method). Compose box added to the UI. Records `senderUserId`/`SENT`/`FAILED`. Not live-sent yet.
- **Phase 5**: Three-pane inbox UI, live-verified with real data.
- **Phase 4**: Webhook ingestion, live-verified with a real WhatsApp message.
- **Phase 3**: Numbers registered, `getTemplates()` live-verified.
- **Phase 2**: Repository layer, live-verified.

## Manual-action log (things only you could do) — historical

| Date | Item | Status |
|---|---|---|
| 2026-08-09 – 2026-08-10 | Bootstrap, spreadsheet, Exotel credentials, webhook config, all live-verification click-throughs for Phases 1–5 | ✅ Done by you |
| 2026-08-10 | Confirm `Test_V02`/ngrok URL safe to remove | ✅ Done — `Test_V02` deleted |
| — | Fill in provider fields for `Spreewalk - Raipur` / `ECHT Advisory` | ⬜ Open, whenever convenient |
| — | Remove the ngrok callback URL from all 10 numbers in Exotel | ⬜ Open, whenever convenient |

## Full wake-up task list (updated as the session progresses)

### Open

1. **Click through the whole redesigned panel, thoroughly.** This is the biggest single UI change so far — landing screen number picker, sidebar nav, Dashboard KPIs, Inbox/All Conversations/Unassigned, Reminders, Customers, Reports (all scoped to whichever number you pick), and every former Admin Panel section (Templates, Quick Replies, Teams, Users, WhatsApp Numbers, Settings, Audit Log, org-wide as before). Everything was ported from working code and reviewed carefully, but I have no way to actually render/click Apps Script's output myself — please exercise it for real before trusting it day-to-day.
2. **Media sending is broken — I need diagnostics.** Open Apps Script → Executions, find the `sendMediaReply` call, and share the raw request/response (or describe exactly what happens: error, hang, or silent no-arrival).
3. **Live-verify Phase 6 `sendText`** — reply to a real conversation, confirm it arrives, check Exotel's real response shape with me so I can fix `extractOutboundProviderMessageId_` if needed.
4. Create at least one quick reply — Settings-adjacent Quick Replies page — so the compose box's dropdown has something in it.
5. Fill in `Spreewalk - Raipur` / `ECHT Advisory` provider fields — WhatsApp Numbers page → Edit (optional).
6. Remove the ngrok callback URL from Exotel (optional).
7. **Read `docs/ZOHO_PHASE_2.md` and answer its 5 open questions** whenever you're ready to think about Zoho.

### Done (kept for history)

- ~~Round-robin needs Assignment Rules configured~~ — done via Admin Panel.
- ~~Seed default lead stages~~ — done.
- ~~Real security bug (`getCustomerStage` had no auth check)~~ — found and fixed, Phase 16.
- ~~Should conversations be resolvable?~~ — yes, any assigned agent/ADMIN; built and deployed.
- ~~Reports org-wide vs. team-scoped?~~ — scoped to admin-granted access; built and deployed.
- ~~Chatbot on 079-485-02810 hijacking every number's webhook~~ — Exotel-side config, fixed by you; confirmed not a code issue.
- ~~Card-style number/org-select landing screen~~ — built and deployed, confirmed working by you.
- ~~Speed (8 round-trips per conversation)~~ — fixed, down to 1 round-trip; confirmed working.
- ~~Inbox polish (names, sender names, media rendering, collapsible panels)~~ — built and deployed, see item 2 above to verify.
- ~~Backups~~ — built; **still needs your one-time click-through** in Admin Panel → Backup to confirm it works against the real spreadsheet (new OAuth consent screen expected).
- ~~Read `docs/DEPLOYMENT.md`~~ — go-live readiness checklist, available whenever useful.
- *(This list will keep evolving — check the bottom of this file for the latest.)*
