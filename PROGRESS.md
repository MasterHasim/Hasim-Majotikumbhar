# WhatsApp Multi-Number CRM — Progress Report

**Last updated:** 2026-08-10 (Phase 4 done — real inbound message live-verified end-to-end)
**Purpose:** single source of truth for "what's done, what's left, and what needs you personally." Updated after every phase/transition. See `docs/ROADMAP.md` for full phase scope and `memory/` for detailed decisions/changelog.

## Action needed from you right now

- Fill in `providerAccountId`/`wabaId`/`providerNumberId` for **`Spreewalk - Raipur`** and **`ECHT Advisory`** whenever convenient — not blocking anything.
- Remove the pre-existing **ngrok callback URL** (`https://chubby-overcrowd-system.ngrok-free.dev/webhooks/exotel/inbound`) from all 10 numbers in Exotel's Webhooks page whenever convenient — confirmed safe to remove (was just an Exotel demo), left as manual cleanup since it's per-number Exotel dashboard config, not scriptable from here.
- Nothing else is currently blocking. Phase 5 is starting now.

## Phase status

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Project Foundation & Architecture | ✅ Done | Repo, git, CLASP, memory/docs structure |
| 1 | Authentication, Users & Authorization | ✅ Done | Bootstrapped 2026-08-09; `hasim@echt.co.in` is ACTIVE ADMIN |
| 2 | Core Database / Repository Layer | ✅ Done, live-verified | `SheetRepository` + 11 repositories; live-tested against real spreadsheet |
| 3 | WhatsApp Numbers & Exotel Integration | ✅ Done | 10 numbers registered (8 fully, 2 partially); `getTemplates()` live-verified against a real account |
| 4 | Webhook & Message Ingestion | ✅ Done, live-verified | Real WhatsApp message ingested end-to-end: customer, conversation, message all created correctly |
| 5 | Conversations & Inbox | ⬜ Not started | Next up |
| 6 | Agent Reply / Outbound Messaging | ⬜ Not started | Will live-verify `sendText`/`sendMedia`/`sendTemplate`/`getMessageStatus`/status-callbacks here — deliberately deferred since testing them means real sends/costs |
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

## What Phase 4 actually shipped

- `src/Phase4Domain.gs` (`Phase4WebhookConfig`), `src/Phase4Services.gs` (`Phase4Api.ingestInboundMessage`, idempotent + status-callback handling), `src/Phase4Webhook.gs` (`doPost` — the project's first HTTP entry point)
- New dedicated deployment `phase4-webhook-ingestion` (`Execute as: Me`, `Access: Anyone`), authenticated via a shared secret token (`WEBHOOK_SECRET_TOKEN`) since Exotel has no Google identity for Phase 1's `AccessControl` to check
- Configured on all 10 numbers in Exotel's WhatsApp Console (alongside a pre-existing ngrok URL, left untouched)
- `Webhook_Debug_Log` sheet tab — every webhook call logged (params/body/outcome), kept as a permanent diagnostic
- **Live-verified completely**: real WhatsApp message → real `Customer` (name auto-populated from `profile_name`) → real `OPEN` `Conversation` → real `INBOUND` `Message`, all correctly linked. Two real bugs found and fixed along the way: message-id field is `sid` not `id`; number lookup needed to match on the actual phone number (`to` field), not the `providerNumberId` captured in Phase 3
- Status-callback handling remains unverified live — needs Phase 6 to actually send a message first

## What Phase 3 actually shipped

- `ExotelProvider`, authorized number CRUD, all 10 numbers registered for real
- **`getTemplates()` live-verified**: real request returned two real approved templates

## What Phase 2 actually shipped

- `SheetRepository` + 11 repositories, live-verified end-to-end against the real spreadsheet ([PR #1](https://github.com/MasterHasim/Hasim-Majotikumbhar/pull/1))

## Manual-action log (things only you could do)

| Date | Item | Status |
|---|---|---|
| 2026-08-09 | Bootstrap, OAuth consent, PR merge, spreadsheet + `SPREADSHEET_ID`, Phase 2/3 live smoke tests | ✅ Done by you |
| 2026-08-09 | Set Exotel credentials, locate WABA/Phone IDs, seed + populate numbers | ✅ Done by you |
| 2026-08-10 | Set `WEBHOOK_SECRET_TOKEN`, check Manage Deployments (caught the `webapp` manifest + `ANYONE` access bugs), configure webhook URL on all 10 numbers, send test WhatsApp messages | ✅ Done by you |
| 2026-08-10 | Confirm `Test_V02` and the ngrok URL are safe to remove (both were just Exotel demo/testing artifacts) | ✅ Done by you — `Test_V02` deleted; ngrok URL removal left as manual cleanup (below) |
| — | Fill in provider fields for `Spreewalk - Raipur` / `ECHT Advisory` | ⬜ **Open — whenever convenient** |
| — | Remove the ngrok callback URL from all 10 numbers in Exotel | ⬜ **Open — whenever convenient** |

## Next step

**Phase 5 — Conversations & Inbox**: the actual WhatsApp panel UI (three-pane layout: numbers / conversations / customer detail). This is the first phase with a frontend — Admin sees all 10 numbers, an agent sees only their assigned numbers. Real conversation/message data already exists in the sheets from Phase 4's live test, ready to display.
