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
```

## Current state

The real Inbox UI is built and wired to the live backend: sign-in → bootstrap
(first-run only) → number picker → sidebar-nav workspace shell → Inbox page
(conversation list with search, chat thread + text reply + resolve, and a
CRM detail panel — reassign, lead stage, remarks, reminders, snooze). Design
tokens and layout (`src/styles.css`) are ported directly from
`apps-script/frontend/Index.html`'s mockup-matched CSS, so the two builds
stay visually consistent.

Live updates are **polling-based for now** (`components/Inbox.tsx`, every 4s)
rather than a real Firebase Realtime Database subscription — the backend's
`RealtimeListenApi`/custom-token minting already exists
(`src/services/realtimeListenApi.ts`), but wiring an actual `onValue`
listener needs a second Firebase app instance (the primary one already holds
the Google Auth session) and hasn't been built yet; it's a deliberate
fast-follow once this page's core flow is confirmed working end-to-end by a
real user, not an oversight.

Not built yet: templates/quick-replies/media send, dashboard/reports, admin
panel (users/teams/numbers/settings), and the Phase 22 leads page — see
`PROGRESS.md` at the repo root for the full migration plan and status.
