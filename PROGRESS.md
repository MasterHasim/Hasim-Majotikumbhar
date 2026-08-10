# WhatsApp Multi-Number CRM — Progress Report

**Last updated:** 2026-08-10 (overnight autonomous run through Phase 18, then a same-day live session with you actively testing and giving direct feedback — see `memory/DECISIONS.md`)
**Purpose:** single source of truth for "what's done, what's left, and what needs you personally." Updated after every phase/transition. See `docs/ROADMAP.md` for full phase scope, `memory/CHANGELOG.md` for full per-phase detail (this file stays intentionally brief per phase), and `memory/DECISIONS.md` for architectural reasoning.

## Action needed from you right now

- **Media sending is still broken** — you reported it, but I need specifics to fix it blind-safely: does `sendMediaReply` error out immediately, hang, or send-but-never-arrive? If you can grab the raw request/response from Apps Script → Executions for that call and share it, I can very likely fix it in one pass (same pattern as every other Exotel field-name mismatch this project has hit).
- **Speed should be much better now** — diagnosed the real cause (8 server round-trips per conversation open) and fixed it (down to 1). Please confirm it actually feels faster in daily use.
- **Resolve button** is live in the inbox detail header — any assigned agent or ADMIN can use it now.
- **Reports are now scoped** to what each Supervisor/Site Manager actually has access to, per your instruction.
- Next up (not started yet): a card-style number/org-select landing screen before the inbox, matching the Superfone screenshot you shared — see the bottom of this file.
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
| 17 | Production Deployment | 🟡 Readiness checklist done (`docs/DEPLOYMENT.md`) — go-live is your decision | This system has effectively been live since Phase 4; nothing left is a code gap |
| 18 | Zoho Integration Preparation | ✅ Done — mapping documented (`docs/ZOHO_PHASE_2.md`) | 5 open questions only you can answer before Phase 19 can start |
| 19 | Zoho CRM Integration | ⬜ Blocked — needs your Zoho credentials + answers to Phase 18's open questions | |
| 20 | Production Hardening & Optimization | ⬜ Blocked — needs real usage data that doesn't exist yet | |
| 21 | Final Documentation & Handover | ⬜ Deliberately not started — depends on Phases 17/19/20 per the roadmap's "do not build out of order" rule, and those are blocked on you | |

## Recently shipped (brief — see `memory/CHANGELOG.md` for full detail)

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

1. **Media sending is broken (you reported this) — I need diagnostics.** Open Apps Script → Executions, find the `sendMediaReply` call, and share the raw request/response (or just describe exactly what happens: error, hang, or silent no-arrival). I haven't guessed a fix blind since the request shape has always been unverified and I'd rather fix it right the first time than guess again.
2. **Live-verify Phase 6 `sendText`** — reply to a real conversation, confirm it arrives, check Exotel's real response shape with me so I can fix `extractOutboundProviderMessageId_` if needed.
3. **Confirm speed actually feels better** — the 8-round-trips-per-conversation issue is fixed (down to 1), but I can't feel the real UX myself; let me know if it's still slow anywhere.
4. **Card-style number/org-select landing screen** (like your Superfone screenshot) — not started yet; next planned UI work.
5. Create at least one quick reply — Admin Panel → Quick Replies — so the compose box's dropdown has something in it.
6. Fill in `Spreewalk - Raipur` / `ECHT Advisory` provider fields — Admin Panel → Numbers → Edit (optional).
7. Remove the ngrok callback URL from Exotel (optional).
8. **Read `docs/ZOHO_PHASE_2.md` and answer its 5 open questions** whenever you're ready to think about Zoho.

### Done (kept for history)

- ~~Round-robin needs Assignment Rules configured~~ — done via Admin Panel.
- ~~Seed default lead stages~~ — done.
- ~~Real security bug (`getCustomerStage` had no auth check)~~ — found and fixed, Phase 16.
- ~~Should conversations be resolvable?~~ — yes, any assigned agent/ADMIN; built and deployed.
- ~~Reports org-wide vs. team-scoped?~~ — scoped to admin-granted access; built and deployed.
- ~~Backups~~ — built; **still needs your one-time click-through** in Admin Panel → Backup to confirm it works against the real spreadsheet (new OAuth consent screen expected).
- ~~Read `docs/DEPLOYMENT.md`~~ — go-live readiness checklist, available whenever useful.
- *(This list will keep evolving — check the bottom of this file for the latest.)*
