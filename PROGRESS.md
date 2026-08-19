# WhatsApp Multi-Number CRM — Progress Report

**Last updated:** 2026-08-18 (webapp migration reached full Apps Script feature parity, Phases 1-15 — see below; Phase 22 was added to the live `apps-script/` build on 2026-08-17)
**Purpose:** single source of truth for "what's done, what's left, and what needs you personally." Updated after every phase/transition. See `docs/ROADMAP.md` for full phase scope, `memory/CHANGELOG.md` for full per-phase detail (this file stays intentionally brief per phase), and `memory/DECISIONS.md` for architectural reasoning.

## ✅ New: Phase 22 — Location Leads Upload, Assignment Rules & Exotel Click-to-Call (2026-08-17)

Built into the live `apps-script/` build (not the webapp — see migration section below).
Admins can now upload a spreadsheet of call leads (name/phone/location) for Raipur,
Rajsamand, Coimbatore, Prayagraj, Alibaug, and Saraighat; each lead auto-assigns to a
site agent by a per-location rule (single agent / round robin / manual, configurable
under the new **Location Leads → Assignment Rules** admin tab). Agents see their own
leads under a new **My Leads** page with a one-click **Call** button.

**Action needed from you before click-to-call works:**
1. Set four Script Properties in the Apps Script editor (Project Settings → Script
   Properties): `EXOTEL_VOICE_ACCOUNT_SID`, `EXOTEL_VOICE_API_KEY`,
   `EXOTEL_VOICE_API_TOKEN`, `EXOTEL_VOICE_CALLER_ID` (the ExoPhone the calls should
   come from). If your Exotel Voice API uses the same account as your existing WhatsApp
   integration, these can be the same Account SID/Key/Token you already set for
   `EXOTEL_*` — just the CallerId is new.
2. For each agent, open **Users → Edit** and fill in their **Phone** field — this is the
   number Exotel rings first before connecting the call to the lead.
3. Place one real test call once the above are set — the exact Exotel Voice API
   request/response shape is flagged UNVERIFIED in `src/Phase22ExotelVoice.gs` (modeled
   on public docs, not yet exercised against a real account), same as how the WhatsApp
   provider's less-common methods started out.
4. Upload a test batch of leads and set an assignment rule per location before agents
   go looking for their leads — a location with no rule configured leaves leads
   `UNASSIGNED` in the admin table until manually assigned.

All 24 backend test suites pass (`cd apps-script && node tests/<name>.js` for any one,
or see `memory/CHANGELOG.md` for the full list), including the pre-existing suites —
nothing else in the app regressed.

## ✅ Migration: full Apps Script feature parity reached on the new stack

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

**Messaging core (numbers/customers/conversations/messages/webhook/send)
ported, tested, and live.** Direct port of `apps-script/src/Phase{3,4,5,6}
Services.gs` + `WorkspaceServices.gs` — numbers CRUD, the Exotel webhook
ingestion pipeline (confirmed-live payload parsing carried over as-is),
authorized conversation listing/detail, sendReply with the bookkeeping-
isolation fix from the Apps Script build carried over, and the workspace
aggregator (now gating the realtime token behind `includeRealtime` from the
start, instead of learning that lesson the hard way again). 35 automated
tests total (17 new), including a mocked Exotel endpoint proving both the
success path (SENT, needsResponse cleared) and the failure path (FAILED
status saved, no throw, needsResponse untouched). Deployed live and smoke-
tested — every route, the webhook's shared-secret auth, and the "always
200, real status in the body" behavior all confirmed working on the actual
deployed URL, not just locally.

**CRM core (assignment, remarks, reminders, stages) ported, tested, and live.**
Direct port of `apps-script/src/Phase{7,8,9}{Domain,Services}.gs` — the
round-robin engine (`Phase7Api`/`NumberAssignmentConfigApi`: eligibility +
availability + numberAccess gating, self-healing rotation pointer,
returning-customer inheritance to their prior owner, fallback/unassigned
queue, working-hours restriction, full assignment history), lead stages +
per-customer stage + internal remarks (`Phase8Api`), and reminders + snooze
(`Phase9Api` — snoozed conversations now correctly disappear from Phase 5's
active inbox list). Wired into the two places the Apps Script build wired
them: Phase4Api's webhook ingestion now auto-assigns every brand-new
conversation, and Phase5Api's active-conversation list now filters out
anything currently snoozed. `WorkspaceApi` restored to its full field set
(stage/remarks/reminders/snoozeStatus/assignableUsers), matching the
original aggregator exactly. 24 new automated tests (59 total) covering
round-robin rotation across multiple eligible agents, the
eligible-but-unavailable-is-skipped case, returning-customer routing once
their prior conversation is closed, config/participant CRUD and its
authorization gates, stage/remark/customer visibility scoping, and
reminder/snooze lifecycle including the "hidden from active inbox, visible
in all-statuses view" behavior. Exposed via 25 new routes in a new
`src/routes/crm.ts`, deployed live, and smoke-tested (every new route
correctly requires auth — 401 without a token, not 404 — confirming the
whole set is live and wired).

Deferred to later phases on purpose (matches the task breakdown):
sendTemplateReply/sendMediaReply/file upload (templates & media — needs a
Drive-equivalent host, likely Cloudflare R2, not set up yet).

**Phase 22 (location leads + Exotel click-to-call) ported, tested, and live.**
Direct port of `apps-script/src/Phase22{Domain,Services,ExotelVoice,Endpoints}.gs`
— a second, independent assignment workflow alongside the CRM core's per-number
round robin: `Phase22Api` covers lead upload (per-row validation, duplicate
skipping, individual-row error reporting so one bad row doesn't abort a whole
paste), per-location assignment config (single fixed agent / round-robin /
manual, same rotation-with-self-healing-pointer logic as the CRM core's round
robin, just keyed by location), lead reassignment, lead stage + remarks
(reusing Phase8Api's exact ownership rule — a manager can touch any lead, an
agent only their own), click-to-call (`ExotelVoiceProvider`, a new port of
`Phase22ExotelVoice.gs` — separate credentials/domain from the WhatsApp
Exotel integration, still UNVERIFIED against a real account, same flag the
source carried), and the "start WhatsApp from a lead" bridge that finds/creates
a Customer+Conversation on the WhatsApp number matching the lead's location
(matched by a location-name substring in the number's display name) and hands
the frontend straight into the existing inbox UI. Added a `phone` field to
`User` (missing until now — needed so click-to-call knows which number to ring
first) and its own `src/domain/phase22.ts` for the six fixed locations and
validation rules. 31 new automated tests (90 total) covering round-robin/
single/manual assignment modes, lead visibility scoping, config/participant
CRUD, call placement (including the location-caller-ID override and the
missing-agent-phone/missing-Voice-credentials error paths, via a new mocked
Exotel Voice endpoint in the test harness), stage/remark ownership gating, and
the WhatsApp-bridge's idempotency + numberAccess gating. Exposed via 16 new
routes in a new `src/routes/phase22.ts`, deployed live and smoke-tested (every
route correctly requires auth). The Exotel Voice secrets you provided earlier
are now set on the live backend — click-to-call is wired end-to-end, not just
returning a configuration error — but the request/response shape itself is
still unverified against a real Exotel account (see the task list).

**✅ The real frontend Inbox UI is built, live, and confirmed working by you
end-to-end.** Until now every phase above was backend-only (API routes +
business logic) — there was nothing to click on. `webapp/frontend/` now has:
sign-in → bootstrap (first run) → number picker → sidebar-nav workspace
shell → **Inbox page** — conversation list (search by name/phone), chat
thread with text reply + resolve, and a CRM detail panel (reassign, lead
stage, remarks, reminders, snooze), all wired to the live backend above.
Design tokens/layout (`src/styles.css`) are ported directly from
`apps-script/frontend/Index.html`'s mockup-matched CSS so the two builds
look the same. You registered all 10 real WhatsApp numbers via the new
"Add a WhatsApp number" form (ADMIN-only), and confirmed live: the number
picker, the Inbox shell, a real inbound test message (sent through the
actual webhook ingestion pipeline, not faked), and — the big one — **a real
reply sent successfully through Exotel** (green "SENT" bubble, no failure).
One transient "conversation list briefly empty" glitch self-corrected within
seconds (Cloudflare edge-propagation lag right after a secret rotation, same
kind of transient seen elsewhere this session) — not a real bug.

**Real bug found and fixed during this verification**: setting secrets via
PowerShell's `"value" | wrangler secret put` pipeline silently appends a
trailing newline, corrupting the secret. This broke `WEBHOOK_SECRET_TOKEN`
(caught immediately — 401s until fixed) and had also corrupted all four
`EXOTEL_VOICE_*` secrets set earlier the same way. All five have been
re-set correctly via a newline-safe method (`printf '%s' ... | wrangler
secret put`) — click-to-call should now actually reach Exotel instead of
silently failing auth.

**✅ Real-time updates are now live.** The Inbox's open conversation updates
the instant a new message lands — a direct port of the Apps Script build's
already-proven `RealtimeListener` (`webapp/frontend/src/lib/realtime.ts`):
exchange the backend-minted custom token for a real Firebase ID token via
Identity Toolkit, then stream `messages.json` filtered by `conversationId`
as Server-Sent Events. No Firebase console changes needed — same project,
same collection paths (`conversations`/`messages`), same `numberIds` custom
claim shape as the Apps Script build's token, so its existing security
rules already authorize the new backend's tokens too. Replaces the old
4-second blind poll for the open conversation; a relaxed 8s poll still
covers the conversation list (other conversations' previews/badges — same
scope limit the Apps Script listener has), plus a 20s safety-net workspace
refetch in case the stream silently drops.

**✅ The Leads page (Phase 22 frontend) is built** — a second sidebar nav
item alongside Inbox. Location/status filters, a lead table (scoped
server-side: managers see everything, agents see only their own leads,
same rule `Phase22Api` already enforces), an ADMIN/SITE_MANAGER-only bulk
upload (paste `Name, Phone, Location` lines, per-row errors reported
without aborting the batch — same UX the backend was built for), a lead
detail modal (stage, comments, Call, Send WhatsApp — which bridges straight
into the Inbox page, switching the active WhatsApp number automatically if
the lead's location resolves to a different one), and an assignment-rules
modal (mode/participants/caller-ID per location, plus a quick per-agent
phone-number setter since `initiateCall` needs one on file and there's no
Admin Users page yet to set it otherwise). Typechecks clean, production
build clean, verified rendering with no console/network errors in a fresh
browser load.

**✅ Templates, quick replies, and media (Phase 10/11) are ported — backend
and frontend both.** Direct port of `apps-script/src/Phase{10,11}Services.gs`
plus the media half of `Phase6Services.gs`: `Phase10Api` (draft → submit →
sync template workflow, ADMIN-only, real `ExotelProvider.createTemplate`/
`getTemplates` calls, same "built and tested, not invoked live unattended"
boundary as `sendReply`), `Phase11Api` (quick-reply CRUD, admin-managed,
anyone can list), and `Phase6Api.sendTemplateReply`/`sendMediaReply`
(variable substitution into `{{n}}` placeholders, media send by URL).
Inbound media (`mediaUrl` from Exotel's webhook) is now persisted into a
`messageMedia` collection and shown inline in the chat thread. The Inbox
compose box got a quick-reply picker, a template picker (with inline
variable inputs), and a "send media by URL" form.
12 new backend tests (102 total), deployed and smoke-tested live; frontend
typechecks/builds clean, verified rendering with no console errors.

**✅ Admin Panel (Phase 12) is built — frontend only, since the backend CRUD
for almost all of it already existed.** A new **Admin** sidebar item
(ADMIN-only) with 8 tabs: **Users** (create, edit phone/status, toggle
roles via checkboxes), **Teams** (create, expand a team to manage members
and their per-number scope), **Numbers** (create/edit/deactivate — this
already existed via the number-picker's add form, now also manageable
here), **Number Access** (grant/revoke per user × number), **Assignment
Rules** (per-number round-robin: enabled toggle, fallback agent, working
hours, ordered participant list — `NumberAssignmentConfigApi` was actually
built ahead of schedule during the CRM-core phase specifically so this
moment wouldn't need new backend work), **Quick Replies** and **Templates**
(moved here from the old standalone Settings page, which no longer exists
as a separate nav item), and **Audit Log** (read-only, newest first, capped
at 300 rows shown). Typechecks/builds clean, verified rendering with no
console errors on a fresh load.

**✅ Search/filters + needs-response badges (Phase 13) are ported —
backend and frontend both.** Direct port of
`apps-script/src/Phase13Services.gs`'s `Phase13Api`: `searchConversations`
(spans every number the caller can access unless one is specified, filters
by assignee/customer/stage/status/needs-response/unassigned/date range,
free-text `query` matching customer name/phone or message text, all
composed on top of `Phase5Api`'s already-enforced authorization rather than
reimplementing it) and `getNeedsResponseCounts` (open + needs-response
conversation counts per number). The Inbox's conversation list gained a
status filter and needs-response/unassigned checkboxes (switches to the new
search endpoint only when a filter or search text is active, otherwise
keeps using the faster plain active-list fetch); the number picker and the
sidebar's current-number pill both show live needs-response badges, polled
every 20s. 8 new backend tests (110 total), deployed and smoke-tested live;
frontend typechecks/builds clean, verified rendering with no console errors.

**✅ Dashboard & Analytics (Phase 14) is ported — backend and frontend
both.** Direct port of `apps-script/src/Phase14Services.gs`'s `Phase14Api`:
conversation totals/open/unassigned/needs-response/resolved, total
customers, "assigned to me," per-number and per-agent breakdowns, average
first-response time (createdAt → first OUTBOUND message), lead-stage
distribution, template usage (parsed from a message's `"[Template: name]"`
display-text marker, since `Message` has no `templateId` field of its own
— same constraint the source documents), and lead conversion rate — all
scoped through `Phase5Api.listMyNumbers()`, gated on `REPORTS_VIEW`
(SUPERVISOR/SITE_MANAGER/VIEWER/ADMIN; AGENT does not have it, same as the
source). A new **Dashboard** sidebar item (hidden for AGENT-only users)
with a KPI row, per-number and per-agent tables, and bar-chart-style stage/
template-usage breakdowns — a "this number / all numbers I can access"
scope toggle mirrors the source's optional `numberId` narrowing. 7 new
backend tests (117 total), deployed and smoke-tested live; frontend
typechecks/builds clean, verified rendering with no console errors.

**✅ Backup (Phase 15) is ported — the part of it that actually has a
free-tier equivalent.** The source's `backupNow()` was a Google Sheets/
Drive-specific `SpreadsheetApp.copy()` — no 1:1 port exists since this
backend has no spreadsheet. The genuinely useful, zero-new-dependency
equivalent: `Phase15Api.backupNow()` pulls a full Firebase Realtime
Database JSON export (same admin credentials every other read already
uses — Firebase's REST API supports this at the database root) and a new
**Backup** tab in the Admin panel downloads it straight to the browser as
a file. Audit coverage and secrets hygiene (the other two thirds of the
source's Phase 15) needed no new code at all — every prior phase's own
`audit.write(...)` calls already satisfy the same audited-event list, and
no secret is ever hardcoded here. 3 new backend tests (120 total),
deployed and smoke-tested live; frontend typechecks/builds clean, verified
rendering with no console errors.

**Not built: an automatic scheduled backup.** Apps Script's
`installDailyBackupTrigger`/`removeDailyBackupTrigger` (toggle a daily
trigger on/off via an API call) has no equivalent — Cloudflare Cron
Triggers are static `wrangler.toml` config set at deploy time, not
something togglable at runtime, and there's nowhere durable to store an
automatic backup's output without R2 anyway. This is a genuine, permanent
architectural difference from the Apps Script build, not a "blocked, will
fix" item — the manual "Backup Now" button is the intended free-tier
design for this stack, not a placeholder.

**This closes out full Apps Script feature parity** (Phases 1-15, matching
the original build's own phase numbering) for the new stack — the only
still-open item is local-file media upload (`uploadConversationMedia`),
which needs you to enable Cloudflare R2 once in the dashboard (see below);
everything else has a working equivalent, ported, tested, and live.

**Deliberately not built yet: file upload for media** (Apps Script's
`uploadConversationMedia` used Drive; the free-tier equivalent here is
Cloudflare R2, and **R2 needs to be enabled once in the Cloudflare
dashboard before I can create a bucket** — `wrangler r2 bucket create`
failed with `Please enable R2 through the Cloudflare Dashboard [code:
10042]`. `sendMediaReply` itself works today with any already-hosted URL;
only "pick a local file and have the panel host it for you" is blocked on
this one manual step — see the task list.

**How to see it**: run `npm run dev` in `webapp/frontend/` (or it may already
be running — check `http://localhost:5173`) and sign in with your Google
Workspace account. It already talks to the live backend, no local backend
server needed.

### Setup status — everything is now set

1. ✅ Cloudflare account created, `wrangler login` done.
2. ✅ `FIREBASE_WEB_API_KEY` secret set.
3. ✅ `FIREBASE_SERVICE_ACCOUNT_JSON` secret set (fresh key, independent from the Apps Script build's).
4. ✅ `BOOTSTRAP_ADMIN_EMAIL` secret set.
5. ✅ `WEBHOOK_SECRET_TOKEN` set (generated automatically, not reused from the Apps Script build). **Not pointed at Exotel yet on purpose** — that's a deliberate later cutover step, not something to do now.
6. ✅ Exotel WhatsApp credentials set (`EXOTEL_API_KEY`/`API_TOKEN`/`ACCOUNT_SID`/`SUBDOMAIN`) — `sendReply` and the webhook can now actually reach WhatsApp.
7. ✅ Exotel Voice credentials set (`EXOTEL_VOICE_ACCOUNT_SID`/`API_KEY`/`API_TOKEN`/`CALLER_ID`) — click-to-call (Phase 22) can now actually reach Exotel's Voice API. **Unverified**: no real call has been placed yet, so the exact request/response field names (carried over from the Apps Script build's own unverified version) aren't confirmed — see the task list for a one-time real-call test.

### ✅ First admin account created — full pipeline confirmed live

You've completed bootstrap and confirmed `/api/whoami` returns real data
(`ADMIN`, your actual name/email). This is the first genuine end-to-end proof
on real infrastructure: Google sign-in → Firebase ID token → Workers backend
→ Realtime Database → back to the browser, no mocks anywhere in that chain.

### 🆕 New feature found: location leads + click-to-call (Phase 22)

While looking into the Exotel Voice credentials, I found `apps-script/src/
Phase22*.gs` — a real, separate feature added to the Apps Script build:
uploading call leads per site location, auto-assigning them (single agent /
round-robin / manual per location), click-to-call through Exotel's Voice API,
and a bridge that lets an agent jump from a lead straight into a WhatsApp
conversation with that same person. Added it to the migration plan as its own
phase, sequenced right after CRM core (it reuses that phase's round-robin and
stage/remarks patterns directly, so porting it right after keeps the code
consistent rather than duplicating the pattern early). Also added its 3 new
permissions (`leads.manage`/`leads.view.assigned`/`leads.call`) to the new
backend's role definitions now, while the system is still unbootstrapped —
means a fresh bootstrap picks them up automatically, no separate fixup script
ever needed (the Apps Script build needed one, since its roles were already
persisted before the feature existed).

Full setup details are in `webapp/backend/README.md` and
`webapp/frontend/README.md`. Phase-by-phase plan, same order as the original
build:

1. ~~Foundation (backend + frontend scaffolding, auth pipeline proven)~~ ✅ done
2. ~~Phase 1 — auth, roles, teams, number access~~ ✅ done, tested
3. ~~Messaging core — numbers, customers, conversations, messages, webhook, send~~ ✅ done, tested, live
4. ~~CRM core — assignment, remarks, reminders, stages~~ ✅ done, tested, live
5. ~~Location leads + click-to-call (Phase 22)~~ ✅ done, tested, live (Voice call itself still needs a one-time real-call verification — see task list)
6. ~~Templates, quick replies, media~~ ✅ done, tested, live (media *file upload* specifically waits on you enabling R2 — see task list)
7. Admin panel ✅ · notifications/search ✅ · dashboard ✅ · backup ✅ (all done, live — Phases 1-15 parity reached)
8. Parallel-run validation, then cutover (Apps Script stays live and untouched the entire time) — **next**

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
8. ~~[webapp] Click through the new Inbox UI~~ — ✅ done by you 2026-08-18. Registered all 10 numbers, confirmed the Inbox shell, a real inbound test message via the actual webhook pipeline, and a real reply sent successfully through Exotel.
9. **[webapp] Place one real Exotel Voice call to verify Phase 22's click-to-call.** The Exotel Voice secrets are now set on the live backend, but `ExotelVoiceProvider`'s request/response field names are still UNVERIFIED (carried over from the Apps Script build's own unverified version) — a real agent needs a `phone` set (Admin Panel → Users, once that page exists on the new backend, or via the API directly for now) and a lead assigned to them, then click-to-call once so I can confirm/fix the response parsing against what Exotel actually returns.
10. **[webapp] Enable R2 in the Cloudflare dashboard** (Cloudflare's own account-level gate — `wrangler r2 bucket create` fails with `Please enable R2 through the Cloudflare Dashboard [code: 10042]` until this is done once). Cloudflare's R2 free tier itself needs no credit card, but the dashboard flow to switch it on has to be done by you, the account owner — I can't do this via the API. Once enabled, tell me and I'll create the bucket, bind it, and wire up the local-file media upload that's currently the one missing piece of Phase 10/11.

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
