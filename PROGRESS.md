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
| 7 | Assignment & Round-Robin Engine | ⬜ In progress (autonomous session) | |
| 8 | CRM-lite: Customers, Stages, Remarks | ⬜ Not started yet | |
| 9 | Reminders, Snooze & Follow-up | ⬜ Not started yet | |
| 10 | WhatsApp Templates | ⬜ Not started yet | |
| 11 | Quick Replies & Media | ⬜ Not started yet | |
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
2. Fill in `Spreewalk - Raipur` / `ECHT Advisory` provider fields (optional).
3. Remove the ngrok callback URL from Exotel (optional).
4. *(This list will grow as I continue — check the bottom of this file for the latest.)*
