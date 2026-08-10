# WhatsApp Multi-Number CRM — Progress Report

**Last updated:** 2026-08-10 (working autonomously overnight per user's go-ahead — see `memory/DECISIONS.md`)
**Purpose:** single source of truth for "what's done, what's left, and what needs you personally." Updated after every phase/transition. See `docs/ROADMAP.md` for full phase scope, `memory/CHANGELOG.md` for full per-phase detail (this file stays intentionally brief per phase), and `memory/DECISIONS.md` for architectural reasoning.

## Action needed from you right now

- **Live-verify `sendText`** (Phase 6): code is written and Node-tested, but actually calling it means sending a real WhatsApp message with real cost — deliberately not done unattended. Once you're back: open the UI, reply to a conversation, and we'll check together whether it actually reaches the recipient and what Exotel's real response shape looks like (same live-verify-and-fix pattern as every other Exotel integration point).
- See the **full wake-up task list** at the bottom of this file for everything else queued up.

## Phase status

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Project Foundation & Architecture | ✅ Done | |
| 1 | Authentication, Users & Authorization | ✅ Done, live-verified | Hasim is ACTIVE ADMIN |
| 2 | Core Database / Repository Layer | ✅ Done, live-verified | |
| 3 | WhatsApp Numbers & Exotel Integration | ✅ Done, live-verified | 10 numbers registered (8 fully, 2 partially) |
| 4 | Webhook & Message Ingestion | ✅ Done, live-verified | |
| 5 | Conversations & Inbox | ✅ Done, live-verified | |
| 6 | Agent Reply / Outbound Messaging | 🟡 Code done, Node-tested — live send pending you | `sendText` request shape unverified until a real send happens |
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
| 17 | Production Deployment | ⬜ Not started — needs your go-live decisions | |
| 18 | Zoho Integration Preparation | ⬜ Not started yet | |
| 19 | Zoho CRM Integration | ⬜ Not started — needs your Zoho credentials | |
| 20 | Production Hardening & Optimization | ⬜ Not started — needs real usage data | |
| 21 | Final Documentation & Handover | ⬜ Not started yet | |

## Recently shipped (brief — see `memory/CHANGELOG.md` for full detail)

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

## Full wake-up task list (updated as the overnight session progresses)

1. **Live-verify Phase 6 sending** — reply to a real conversation in the UI, confirm the message actually arrives, check Exotel's real response shape with me so I can fix `extractOutboundProviderMessageId_` if the field name guess is wrong (same pattern as every other Exotel field-name fix this project has needed).
2. **Round-robin won't actually assign anyone yet on your real numbers** — the engine (Phase 7) is done and tested, but no `Number_Assignment_Config`/`Number_Assignment_Users` records exist for your real 10 numbers (nobody's configured which agents participate). **This is now easy to fix yourself**: open the Admin Panel (`?page=admin`) → Assignment Rules → pick a number → enable round robin and add participants. Until that's done, real new leads just land in the unassigned queue.
3. **Seed the default lead stages once** — either run `seedDefaultLeadStages()` via the Apps Script editor, or click "Seed default stages" in the new Admin Panel's Lead Stages section (same effect, now with a UI) — needed before the stage dropdown in the main inbox shows anything.
4. **Templates**: if you want to actually create/submit a real WhatsApp template, use the Admin Panel's Templates section (create draft → Submit for review, which creates it on your real WABA pending Meta review) — or run `syncTemplatesFromProvider(wabaId)` there first to pull in templates that already exist on your account (e.g. the `otp_veri_code`/`otp` ones seen live in Phase 3) rather than recreating them.
5. **Click through the new Admin Panel** (`?page=admin` on the same Web App URL) as `hasim@echt.co.in` — it's real, tested backend logic behind a brand-new UI I could never render/click myself (no local dev server for Apps Script `HtmlService`, same limitation as every other UI phase). This is also where items 2–4 above actually get done now.
6. **Live-verify Phase 11 media sending** — same pattern as Phase 6: use the "Media…" button in the main inbox to send a real media message, confirm it arrives, and (ideally) get a customer to send a real media message back so we can check the Apps Script Executions panel for the real inbound webhook shape and fix `extractInboundMediaUrl_` if the field-name guess is wrong — no real inbound media webhook has ever been observed, only inbound text so far.
7. Create at least one quick reply — Admin Panel → Quick Replies — so the compose box's "Quick reply…" dropdown has something in it; it's empty until an ADMIN adds one.
8. Fill in `Spreewalk - Raipur` / `ECHT Advisory` provider fields — now doable via Admin Panel → Numbers → Edit (optional).
9. Remove the ngrok callback URL from Exotel (optional).
10. **Product decision needed: should conversations ever be "resolved/closed"?** Building Phase 14's dashboard surfaced a real gap — no phase has ever added a way to mark a conversation resolved/closed; `status` has only ever been `'OPEN'`. This isn't something I should invent unattended (it's a workflow/UX decision, not a bug), but it means Phase 14's "resolved" metric will always show 0 until you decide. If you want it, tell me what "closing" should mean (who can do it — any assigned agent? admin only? — and whether a closed conversation can be reopened by a new inbound message) and I'll build it properly next time.
11. **Reports visibility is org-wide, not team-scoped** — `REPORTS_VIEW` (Phase 1's existing permission, now used by Phase 14) is a flat permission: a SUPERVISOR/SITE_MANAGER who has it sees dashboard metrics across the *entire* org, not just their own team, since Phase 1 never defined a team-scoped variant. If you'd rather Supervisors/Site Managers only see their own team's numbers, let me know and I'll add that scoping.
12. Check out the new **Reports** link (top of the Numbers pane in the main inbox) — conversation totals, per-agent workload, response times, stage distribution, template usage, lead conversion.
13. **Backups (Phase 15)** — open Admin Panel → Backup. Click "Back up now" once to confirm it actually works against your real spreadsheet (I could only test this against mocks, never the real Apps Script `SpreadsheetApp`/Drive APIs). You'll likely see a **new Google consent screen** the first time — I added two OAuth scopes (`drive.file`, `script.scriptapp`) needed for backups/triggers, so that's expected, not a bug. If it looks right, click "Enable daily backups" to turn on the automatic 2am copy.
14. *(This list will grow as I continue — check the bottom of this file for the latest.)*
