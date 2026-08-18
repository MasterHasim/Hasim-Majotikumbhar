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

Sign-in + backend round-trip validated (`App.tsx` calls `/api/whoami`). This
becomes the real landing screen once Phase 1 (auth/roles) is ported — see
`PROGRESS.md` at the repo root for the migration plan and status.
