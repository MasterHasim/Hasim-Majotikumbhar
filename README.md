# WhatsApp Panel

Multi-number WhatsApp CRM. This repo now holds two **separate, non-mixing**
implementations side by side:

- **`apps-script/`** — the original, fully-featured Google Apps Script build
  (Phases 1-18: auth/roles/teams, numbers, customers, conversations, round-robin
  assignment, remarks, reminders, stages, templates, quick replies, media, admin
  panel, notifications, dashboard/analytics, audit/backup, live Firebase realtime
  messaging). This is the version currently in daily use. See `PROGRESS.md` at
  the repo root for overall status, and `apps-script/memory/CODEX_CONTEXT.md`
  before changing anything in this folder.
- **`webapp/`** — the new build, migrating the same functionality onto a free,
  faster stack (Cloudflare Workers backend + Firebase Realtime Database +
  React frontend) to remove the Apps Script constraints (shared script-wide
  lock, execution concurrency limits, cold starts) that limited responsiveness
  in the original build. See `webapp/README.md` once scaffolded for its own
  setup instructions.

**These two are deliberately kept apart** — no shared source files, no shared
build tooling — so the live Apps Script app keeps running untouched while the
new one is built and validated. The Apps Script app is not being decommissioned
until the new one is fully migrated, parallel-run, and validated (see
`PROGRESS.md` for the migration plan and status).

## Which one do I touch?

- Fixing a bug or tweaking something agents use *today* → `apps-script/`.
- Building the new version → `webapp/`.
- Don't move files between them or share code — that's the one thing we're
  explicitly avoiding here.
