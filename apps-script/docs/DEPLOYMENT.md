# DEPLOYMENT

## Current state (as of 2026-08-10)

This project already runs against real infrastructure — it has since Phase 1. There is
no separate "staging" environment; the single Apps Script project and single Google
Sheet documented below **are** production, in the sense that real messages, real
customers, and real users already flow through them. What Phase 17 actually adds is a
deliberate go-live checklist and sign-off, not a new environment.

### Source flow

`GitHub (MasterHasim/Hasim-Majotikumbhar, branch main) → clasp push → Apps Script
project → Google Sheet`. Every phase's code has been pushed with `clasp push -f` and
committed/pushed to GitHub immediately after; there is no drift between what's in Git
and what's live in Apps Script as of this writing.

### Deployments (`clasp deployments`)

| Deployment | Purpose | Access | Executes as |
| --- | --- | --- | --- |
| `phase5-admin-ui` | Main UI (`doGet` → `frontend/Index.html`, or `frontend/Admin.html` at `?page=admin`) | Anyone within `echt.co.in` | User accessing the web app (so `Session.getActiveUser()` reports each visitor's real identity — required for `AccessControl` to work) |
| `phase4-webhook-ingestion` | Exotel webhook (`doPost`) | Anyone (anonymous — Exotel isn't a Google identity) | Me (script owner) |
| `phase1-bootstrap-execution-api-v2` | One-time Phase 1 bootstrap via the Execution API | Myself only | — |

Every deployment is a **versioned snapshot** — pushing new source with `clasp push`
does not update a live deployment until `clasp deploy --deploymentId ...` is run
against it. This project's practice has been to redeploy `phase5-admin-ui` (and
`phase4-webhook-ingestion` when ingestion logic itself changed) at the end of every
phase — see `memory/CHANGELOG.md` for the full history.

### Script Properties in use

| Property | Purpose | Set by |
| --- | --- | --- |
| `SPREADSHEET_ID` | The Phase 2 data spreadsheet | You, 2026-08-09 |
| `wap.phase1.bootstrapAdminEmail` | The one email allowed to run `bootstrapPhase1` | You, 2026-08-09 |
| `EXOTEL_API_KEY` / `EXOTEL_API_TOKEN` / `EXOTEL_ACCOUNT_SID` / `EXOTEL_SUBDOMAIN` | Exotel WhatsApp API credentials | You, 2026-08-09 |
| `WEBHOOK_SECRET_TOKEN` | Shared secret Exotel's webhook URL must include (`?token=...`) | You, 2026-08-10 |

None of these are committed to Git — they only ever live in Script Properties
(`PropertiesService`), read via each phase's own config helper
(`Phase2Spreadsheet.requireSpreadsheetId_()`, `Phase3ExotelConfig.require_()`,
`Phase4WebhookConfig.requireToken_()`). See `memory/DECISIONS.md` for the full
credential-handling history.

### Timezone

`appsscript.json`'s `timeZone` is `Asia/Kolkata` (set 2026-08-10 — see the
`chore: set project timezone to Asia Kolkata` commit) — this is what Phase 7's working-
hours check and Phase 15's daily backup trigger (2am) both run against.

### OAuth scopes

`script.storage`, `userinfo.email`, `spreadsheets`, `script.external_request`,
`drive.file` (Phase 15, backups), `script.scriptapp` (Phase 15, triggers). The last two
were added in Phase 15 and will trigger a fresh consent screen on next execution — see
`PROGRESS.md`'s wake-up list.

## Pre-go-live checklist (roadmap's Phase 17 list)

| Item | Status |
| --- | --- |
| Production spreadsheet | ✅ Set (`SPREADSHEET_ID`) — this **is** the spreadsheet in use since Phase 2; there is no separate prod/dev spreadsheet to switch |
| Production secrets (Exotel credentials, webhook token) | ✅ Set, never committed |
| Webhook config (Exotel → Apps Script) | ✅ Configured and live-verified (real inbound message received, Phase 4) |
| Allowed users/domain | ✅ `phase5-admin-ui` restricted to `echt.co.in`; `numberAccess`/roles gate everything beyond that |
| Timezone | ✅ `Asia/Kolkata` |
| Application logs (webhook errors, API errors, failed messages, assignment failures) | 🟡 Partial — every write path logs to `Audit_Log`/`auditLog`, and Apps Script's own Executions panel captures uncaught exceptions/console output. There's no dedicated "errors dashboard" beyond that; Phase 14's Reports overlay doesn't currently surface failed-message counts as its own metric (it's derivable — `Messages` with `status: 'FAILED'` — but not yet a named tile). Flagged as a possible small follow-up, not a blocker |
| Round-robin actually configured for real numbers | 🟡 Now possible via Admin Panel → Assignment Rules, but not yet done for most of your 10 numbers — see `PROGRESS.md`'s wake-up list |

## What "going live" actually means here, and why I didn't just do it

Given the table above, this system has effectively **been** live since Phase 4 — real
messages have flowed through it. There isn't a single switch to flip. What's left is
entirely your call, not a technical gap I should decide for you:

1. **Confirm you're ready for all ~15 agents/supervisors to actually use this daily**
   (as opposed to it being a project I've been building and you've been spot-checking).
2. **Decide whether/when to set up Assignment Rules for the remaining numbers** so
   round-robin actually assigns real leads instead of leaving them unassigned.
3. **Decide on a backup cadence** (Phase 15 built it, but enabling the daily trigger is
   your call, done from the Admin Panel).
4. Optionally, review the two still-unverified Exotel integration points (`sendText`'s
   real response shape, media send/receive) so nothing is quietly running on an
   unverified assumption once real usage scales up.

None of these are things I can or should decide unattended — "go live" is a business
readiness decision, not a code change. See `PROGRESS.md`'s wake-up task list for the
concrete next actions.
