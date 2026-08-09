# WhatsApp Multi-Number CRM — Progress Report

**Last updated:** 2026-08-09 (Phase 3 done — `getTemplates()` live-verified against a real account)
**Purpose:** single source of truth for "what's done, what's left, and what needs you personally." Updated after every phase/transition. See `docs/ROADMAP.md` for full phase scope and `memory/` for detailed decisions/changelog.

## Action needed from you right now

- Fill in `providerAccountId`/`wabaId`/`providerNumberId` for **`Spreewalk - Raipur`** and **`ECHT Advisory`** whenever convenient — not blocking anything.
- **Unexplained deployment `Test_V02`** — still unconfirmed, still harmless either way.
- Nothing else is currently blocking. Phase 4 can start when you're ready.

## Phase status

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Project Foundation & Architecture | ✅ Done | Repo, git, CLASP, memory/docs structure |
| 1 | Authentication, Users & Authorization | ✅ Done | Bootstrapped 2026-08-09; `hasim@echt.co.in` is ACTIVE ADMIN |
| 2 | Core Database / Repository Layer | ✅ Done, live-verified | `SheetRepository` + 11 repositories; live-tested against real spreadsheet |
| 3 | WhatsApp Numbers & Exotel Integration | ✅ Done | 10 numbers registered (8 fully, 2 partially); `getTemplates()` live-verified against a real account |
| 4 | Webhook & Message Ingestion | ⬜ Not started | Next up |
| 5 | Conversations & Inbox | ⬜ Not started | |
| 6 | Agent Reply / Outbound Messaging | ⬜ Not started | Will live-verify `sendText`/`sendMedia`/`sendTemplate`/`getMessageStatus` here — deliberately deferred from Phase 3 since testing them means real sends/costs |
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

## What Phase 3 actually shipped

- `src/Phase3Domain.gs` (`Phase3ProviderContract`, `Phase3ExotelConfig`), `src/Phase3ExotelProvider.gs` (`ExotelProvider`), `src/Phase3Services.gs`/`src/Phase3Endpoints.gs` (`createNumber`/`updateNumber`/`listNumbers`, ADMIN-only), `src/Phase3ExotelConfigStatus.gs` (non-secret credential-status tab)
- **All 10 WhatsApp numbers registered for real**; 8 have full `providerAccountId`/`wabaId`/`providerNumberId` (all share `providerAccountId: 'echt61'`), entered directly in the sheet (bypassed the audit log for those edits — noted in `memory/DECISIONS.md`, not a problem while you're the sole admin)
- All four Node test suites pass; `appsscript.json` gained `spreadsheets` and `script.external_request` OAuth scopes
- **`getTemplates()` is genuinely live-verified**, not just Node-mocked: real request against WABA `1359198589697291` returned two real approved templates (`otp_veri_code`, `otp`). Along the way, corrected a wrong assumed endpoint path (`whatsapp/templates` → `templates`) using a real curl example found via research.
- `sendText`/`sendMedia`/`sendTemplate`/`createTemplate`/`getMessageStatus` remain **unverified by design** — confirming those means sending a real message or creating a real template, deliberately deferred to Phase 6

## What Phase 2 actually shipped

- `src/Phase2Domain.gs`, `src/Phase2Persistence.gs` (`SheetRepository`), `src/Phase2Repositories.gs` (11 repositories)
- [PR #1](https://github.com/MasterHasim/Hasim-Majotikumbhar/pull/1) merged into `main`; backing spreadsheet `1qugfpq7dfNd2phwb8GVh_6VEsDe1Kf0fd76w3JQcqt4`
- **Live-verified end-to-end**: caught and fixed two real bugs (Apps Script alphabetical file-load order; Google Sheets silently coercing numeric-looking strings into numbers)

## Manual-action log (things only you could do)

| Date | Item | Status |
|---|---|---|
| 2026-08-09 | Run `bootstrapPhase1`, grant OAuth consent (multiple times as scopes were added) | ✅ Done by you |
| 2026-08-09 | Open + merge PR #1 on GitHub (`gh` CLI not installed locally) | ✅ Done by you |
| 2026-08-09 | Create backing spreadsheet + configure `SPREADSHEET_ID` Script Property | ✅ Done by you |
| 2026-08-09 | Run live smoke tests diagnosing/verifying Phase 2's two bugs | ✅ Done by you |
| 2026-08-09 | Run `seedPhase3NumbersOnce` — all 10 numbers registered | ✅ Done by you |
| 2026-08-09 | Set `EXOTEL_API_KEY`/`EXOTEL_API_TOKEN`/`EXOTEL_ACCOUNT_SID`/`EXOTEL_SUBDOMAIN` Script Properties | ✅ Done by you |
| 2026-08-09 | Locate WABA ID / Phone Number ID in Meta Business Manager, populate 8 of 10 numbers | ✅ Done by you |
| 2026-08-09 | Fill in provider fields for `Spreewalk - Raipur` / `ECHT Advisory` | ⬜ **Open — whenever convenient** |
| 2026-08-09 | Confirm origin of deployment `Test_V02` | ⬜ **Open — needs you (or tell me to ignore it)** |

## Next step

**Phase 4 — Webhook & Message Ingestion**: receive real inbound WhatsApp messages via a webhook, identify the number/customer, find-or-create a conversation, store the message idempotently (dedupe on provider message ID), and update the conversation. This is the first phase that adds an HTTP entry point (`doPost`) — deliberately not added in any earlier phase. `ExotelProvider.processWebhook()` (built in Phase 3) already has a best-effort payload parser that will need live verification once a real webhook actually fires.
