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
| 12 | Admin Panel & Configuration | ⬜ Not started yet | |
| 13 | Notifications, Search & Productivity | ⬜ Not started yet | |
| 14 | Dashboard & Analytics | ⬜ Not started yet | |
| 15 | Audit, Security, Backup & Reliability | ⬜ Not started yet | |
| 16 | Testing & QA | ⬜ Not started yet | |
| 17 | Production Deployment | ⬜ Not started — needs your go-live decisions | |
| 18 | Zoho Integration Preparation | ⬜ Not started yet | |
| 19 | Zoho CRM Integration | ⬜ Not started — needs your Zoho credentials | |
| 20 | Production Hardening & Optimization | ⬜ Not started — needs real usage data | |
| 21 | Final Documentation & Handover | ⬜ Not started yet | |

## Recently shipped (brief — see `memory/CHANGELOG.md` for full detail)

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
2. **Round-robin won't actually assign anyone yet on your real numbers** — the engine (Phase 7) is done and tested, but no `Number_Assignment_Config`/`Number_Assignment_Users` records exist for your real 10 numbers (nobody's configured which agents participate). Until that's set up — either manually or once Phase 12's Admin Panel exists — real new leads will just land in the unassigned queue. Not urgent, just worth knowing.
3. **Seed the default lead stages once** — run `seedDefaultLeadStages()` (e.g. via the Apps Script editor, same one-time-wrapper pattern used for Phase 1/3's live setup) before the stage dropdown in the UI will show anything.
4. **Templates**: if you want to actually create/submit a real WhatsApp template, use `createDraftTemplate`/`updateDraftTemplate` then `submitTemplateForReview` (creates it on your real WABA, pending Meta review) — or run `syncTemplatesFromProvider(wabaId)` first to pull in templates that already exist on your account (e.g. the `otp_veri_code`/`otp` ones seen live in Phase 3) rather than recreating them.
5. **Live-verify Phase 11 media sending** — same pattern as Phase 6: use the new "Media…" button in the UI to send a real media message, confirm it arrives, and (ideally) get a customer to send a real media message back so we can check the Apps Script Executions panel for the real inbound webhook shape and fix `extractInboundMediaUrl_` if the field-name guess is wrong — no real inbound media webhook has ever been observed, only inbound text so far.
6. Create at least one quick reply (`createQuickReply`, e.g. via the Apps Script editor or once Phase 12's admin panel exists) so the compose box's "Quick reply…" dropdown has something in it — it's empty until an ADMIN adds one.
7. Fill in `Spreewalk - Raipur` / `ECHT Advisory` provider fields (optional).
8. Remove the ngrok callback URL from Exotel (optional).
9. *(This list will grow as I continue — check the bottom of this file for the latest.)*
