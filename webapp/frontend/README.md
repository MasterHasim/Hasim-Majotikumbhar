# WhatsApp Panel — Frontend (React)

Replaces the Apps Script `Index.html` single-file HtmlService app. A real SPA
— no server round trip needed to update the UI, no sandboxed-iframe overhead.

## One-time setup

1. Copy `.env.example` to `.env.local` and fill in the Firebase web app config
   (Firebase Console → Project Settings → General → "Your apps") — same
   Firebase project as the Apps Script build (`whatsapp-panel-db`).
2. `npm install`

## Commands

```bash
npm run dev        # local dev server at http://localhost:5173 (talks to the backend at http://localhost:8787 by default)
npm run build       # production build
npm run typecheck
npm run preview     # serve the production build locally
npm run deploy      # build, then `wrangler deploy` (Workers Static Assets — see wrangler.toml)
```

## Current state

**This section describes the initial build (Phases 1-15) and is a historical
snapshot, not a maintained feature list — a lot has shipped since (Phase 22:
Leads Kanban, Auto Dialer, per-lead Reminders, a Home overview page, and
more). `PROGRESS.md` at the repo root is the single source of truth for
current state; treat any specific counts below (e.g. tab/page counts) as
outdated on sight rather than trusted.**

The real Inbox UI is built, wired to the live backend, and **live-verified
end-to-end by a real user**: sign-in → bootstrap (first-run only) → number
picker (with an ADMIN-only "add a number" form, since the new backend starts
with zero numbers registered — a separate Firebase data model from the Apps
Script build's Sheets-based numbers) → sidebar-nav workspace shell → Inbox
page (conversation list with search, chat thread + text reply + resolve, and
a CRM detail panel — reassign, lead stage, remarks, reminders, snooze).
Design tokens and layout (`src/styles.css`) are ported directly from
`apps-script/frontend/Index.html`'s mockup-matched CSS, so the two builds
stay visually consistent.

**Live updates are real Firebase Realtime Database updates** (`lib/realtime.ts`),
not polling — a direct port of the Apps Script build's already-proven
`RealtimeListener` (same REST + `EventSource` approach: exchange the
backend-minted custom token for a real ID token via Identity Toolkit, then
stream `messages.json` filtered by `conversationId` as Server-Sent Events).
Deliberately REST rather than the Firebase JS SDK's `onValue` — the primary
Firebase app instance already holds the Google Auth session used for the
backend's Bearer token, and REST sidesteps needing a second app instance
entirely. On any push event the workspace is refetched (not merged from the
raw event) so sender-name enrichment and status stay consistent, exactly the
same "hide, don't error" correctness bar `WorkspaceApi` already holds
elsewhere. A relaxed 8s poll still covers the conversation *list* (previews/
badges for conversations other than the one currently open — same scope
limitation the Apps Script build's own listener has), plus a 20s safety-net
refetch of the open workspace in case the `EventSource` silently drops.

**The Leads page (Phase 22 UI) is also built** — a second sidebar nav item
alongside Inbox. Location/status filters, a lead table, an ADMIN/SITE_MANAGER-
only bulk upload (paste `Name, Phone, Location` lines), a lead detail modal
(stage, comments, Call, Send WhatsApp — the last one bridges into the Inbox
page, switching the active number if the lead's location resolves to a
different one), and an assignment-rules modal (mode, participants, and a
quick per-agent phone-number setter, since `initiateCall` needs one and
there's no Admin Users page yet). All wired to the already-tested
`Phase22Api` backend.

**Templates, quick replies, and media are also wired up.** The Inbox compose
box (`components/ChatPane.tsx`) now has a quick-reply picker, a template
picker (inline `{{n}}` variable inputs, only APPROVED templates offered),
a "send media by URL" form, and a "📁 Choose file" button that uploads a
local file straight to the R2-backed `uploadConversationMedia` endpoint and
auto-fills the URL/type fields on success; inbound/outbound media renders
inline in the thread (image preview or a link, depending on type).

**The Admin Panel (`components/Admin.tsx`) is built** — a new sidebar item
(ADMIN-only, replaces the old standalone Settings page). It has grown well
past its original 8 tabs since this section was last updated; see
`Admin.tsx`'s own `tabs` array for the current, authoritative list.

**Search/filters + needs-response badges (Phase 13) are wired up.** The
Inbox's conversation list gained a status filter (Open/Resolved/Any) and
needs-response/unassigned checkboxes — switches to the server-side
`searchConversations` endpoint only when a filter or search text is active
(spanning every status, not just the active inbox), otherwise keeps using
the faster plain active-list fetch. The number picker's cards and the
sidebar's current-number pill both show live needs-response count badges,
polled every 20s.

**The Dashboard (`components/Dashboard.tsx`) is built** — a new sidebar item
(hidden for AGENT-only users, matching the backend's `REPORTS_VIEW` gate): a
KPI row (totals, open, needs-reply, unassigned, resolved, assigned-to-me,
total customers, average first-response time), per-number and per-agent
breakdown tables, lead-stage-distribution and template-usage bar charts, a
lead-conversion summary, and a "this number / all numbers I can access"
scope toggle.

**A Backup tab in the Admin panel is built.** Downloads a full JSON export
of the entire database straight to the browser — the free-tier equivalent
of the source's Drive-backed `backupNow()` (no automatic scheduled version;
Cloudflare Cron Triggers are static deploy-time config, and there's nowhere
durable to store the output without R2 anyway — a deliberate, permanent
design difference, not a "will fix later" gap).

**The above was full Apps Script feature parity (Phases 1-15).** The webapp
has since become the primary system (parallel-run/cutover both complete) and
gained a large amount of Phase 22+ functionality — Leads Kanban board with
location-scoped assignment, an Auto Dialer roadmap (missed-call reminders,
"call now" prompts, Exotel Voice status callbacks), per-lead Reminders, a
Home overview page (pie/bar charts distinct from Dashboard's per-number
reporting), and more. See `PROGRESS.md` at the repo root for the real,
continuously-updated status.
