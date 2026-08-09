# WhatsApp Multi-Number CRM — Progress Report

**Last updated:** 2026-08-10 (Phase 5 done — three-pane inbox UI live-verified with real data)
**Purpose:** single source of truth for "what's done, what's left, and what needs you personally." Updated after every phase/transition. See `docs/ROADMAP.md` for full phase scope and `memory/` for detailed decisions/changelog.

## Action needed from you right now

- Fill in `providerAccountId`/`wabaId`/`providerNumberId` for **`Spreewalk - Raipur`** and **`ECHT Advisory`** whenever convenient — not blocking anything.
- Remove the pre-existing **ngrok callback URL** from all 10 numbers in Exotel's Webhooks page whenever convenient — confirmed safe to remove.
- Optional: if you have a second ECHT Google account handy, signing in as a non-admin user (e.g. someone with AGENT role and limited `numberAccess`) and opening the UI would give extra confidence that per-user visibility works correctly live, not just for the admin view. Not required — the authorization logic itself is Node-tested — just a nice-to-have.
- Nothing else is currently blocking. Phase 6 can start when you're ready.

## Phase status

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Project Foundation & Architecture | ✅ Done | Repo, git, CLASP, memory/docs structure |
| 1 | Authentication, Users & Authorization | ✅ Done | Bootstrapped 2026-08-09; `hasim@echt.co.in` is ACTIVE ADMIN |
| 2 | Core Database / Repository Layer | ✅ Done, live-verified | `SheetRepository` + 11 repositories; live-tested against real spreadsheet |
| 3 | WhatsApp Numbers & Exotel Integration | ✅ Done | 10 numbers registered (8 fully, 2 partially); `getTemplates()` live-verified against a real account |
| 4 | Webhook & Message Ingestion | ✅ Done, live-verified | Real WhatsApp message ingested end-to-end: customer, conversation, message all created correctly |
| 5 | Conversations & Inbox | ✅ Done, live-verified | Three-pane UI live at the deployed URL, showing real numbers/conversations/messages |
| 6 | Agent Reply / Outbound Messaging | ⬜ Not started | Next up — will also live-verify `sendText`/`sendMedia`/`sendTemplate`/`getMessageStatus`/status-callbacks, deliberately deferred from Phase 3 since testing them means real sends/costs |
| 7 | Assignment & Round-Robin Engine | ⬜ Not started | |
| 8 | CRM-lite: Customers, Stages, Remarks | ⬜ Not started | |
| 9 | Reminders, Snooze & Follow-up | ⬜ Not started | |
| 10 | WhatsApp Templates | ⬜ Not started | |
| 11 | Quick Replies & Media | ⬜ Not started | |
| 12 | Admin Panel & Configuration | ⬜ Not started | |
| 13 | Notifications, Search & Productivity | ⬜ Not started | |
| 14 | Dashboard & Analytics | ⬜ Not started | |
| 15 | Audit, Security, Backup & Reliability | ⬜ Not started | |
| 16 | Testing & QA | ⬜ Not started | |
| 17 | Production Deployment | ⬜ Not started | |
| 18 | Zoho Integration Preparation | ⬜ Not started | |
| 19 | Zoho CRM Integration | ⬜ Not started | |
| 20 | Production Hardening & Optimization | ⬜ Not started | |
| 21 | Final Documentation & Handover | ⬜ Not started | |

## What Phase 5 actually shipped

- `src/Phase5Services.gs` (`Phase5Api` — `listMyNumbers`, `listConversations`, `getConversationDetail`), `src/Phase5Endpoints.gs` (`doGet`, the project's first HTML entry point), `frontend/Index.html` (three-pane plain HTML/CSS/JS UI, `google.script.run`-based)
- New deployment `phase5-admin-ui` — `Execute as: Me`, `Access: Anyone within ECHT` (domain-restricted, deliberately different from the public webhook deployment)
- Resolved a real gap: `Conversations` has no `teamId`, but Phase 1's authorization contract needed one for Supervisor/Site Manager — fixed by deriving team scope from number access on the fly, no schema change
- Testing caught a real design gap: `listConversations` needed an explicit upfront access-denial check (previously a completely inaccessible number silently returned an empty list instead of `FORBIDDEN`)
- Discovered `.claspignore` was silently excluding `frontend/**` entirely (Phase 0 leftover) — fixed before the first push, would have blocked the UI from ever deploying
- **Live-verified completely**: opened the real URL, saw all 10 real numbers, clicked into "Entartica - CRM," saw the real "OPEN • Needs response" conversation, clicked in, saw customer "Eva" and the real "Hola" message from Phase 4's test — all rendering correctly end to end
- Nothing to reply with yet (Phase 6) — this is view-only, and no stage/remarks/reminders panels (Phase 8/9, no service layer yet)

## What Phase 4 actually shipped

- `doPost` (first HTTP entry point), idempotent ingestion, live-verified with a real WhatsApp message creating a real customer/conversation/message

## What Phase 2 & 3 shipped

- `SheetRepository` + 11 repositories, live-verified ([PR #1](https://github.com/MasterHasim/Hasim-Majotikumbhar/pull/1)); `ExotelProvider` with live-verified `getTemplates()`; all 10 numbers registered

## Manual-action log (things only you could do)

| Date | Item | Status |
|---|---|---|
| 2026-08-09 | Bootstrap, OAuth consent, PR merge, spreadsheet + `SPREADSHEET_ID`, Phase 2/3 live smoke tests, Exotel credentials, WABA/Phone IDs, seed numbers | ✅ Done by you |
| 2026-08-10 | `WEBHOOK_SECRET_TOKEN`, webhook deployment checks, configure webhook URL on all 10 numbers, send test WhatsApp messages | ✅ Done by you |
| 2026-08-10 | Confirm `Test_V02`/ngrok URL safe to remove | ✅ Done by you — `Test_V02` deleted |
| 2026-08-10 | Check `phase5-admin-ui` deployment settings, open and confirm the live UI | ✅ Done by you |
| — | Fill in provider fields for `Spreewalk - Raipur` / `ECHT Advisory` | ⬜ **Open — whenever convenient** |
| — | Remove the ngrok callback URL from all 10 numbers in Exotel | ⬜ **Open — whenever convenient** |

## Next step

**Phase 6 — Agent Reply / Outbound Messaging**: add a compose/reply box to the UI, wire it to `ExotelProvider.sendText`/`sendMedia`/`sendTemplate`, record every outbound message with the sending agent's identity, and finally live-verify the send-side of `ExotelProvider` (deliberately deferred since Phase 3, since testing means a real message with real cost). Also the natural place to live-verify status-callback handling (`Phase4Api.applyStatusUpdate_`), since sending a real message is what triggers one.
