# UI_SPECIFICATION

## Stack

Plain HTML/CSS/JavaScript served via Apps Script `HtmlService` — no build step, no
frontend framework (per the project's established stack). Client-side JS talks to the
server via `google.script.run` (Apps Script's own RPC mechanism), not `fetch`/REST.

## Entry point

`doGet(e)` in `src/Phase5Endpoints.gs` renders `frontend/Index.html`. Served from a
domain-restricted Web App deployment (`Execute as: User accessing the web app`,
`Access: Anyone within ECHT`) — a real Google Workspace identity, so Phase 1's
`AccessControl` applies normally here (unlike the anonymous webhook deployment).

## Layout (Phase 5: view-only inbox)

Three-pane CSS grid: **Numbers | Conversations | Customer detail** — matches the
roadmap's mockup. Admin sees all registered numbers; everyone else sees only numbers
they hold an active `numberAccess` grant for.

- **Numbers pane**: `listMyNumbers()` (`src/Phase5Services.gs`) — display name + phone.
- **Conversations pane**: `listConversations(numberId)` — status, needs-response flag,
  last message time. Filtered per-conversation through
  `AccessControl.requireConversationOperation('view', ...)` (`src/Phase1AccessControl.gs`)
  — Agents see only conversations assigned to them; Supervisors/Site Managers see
  conversations on numbers their team covers (resolved on the fly, see
  `memory/DECISIONS.md`); Admin sees everything.
- **Detail pane**: `getConversationDetail(conversationId)` — customer name/phone,
  number, assigned agent (usually "Unassigned" until Phase 7 exists), status, and the
  full message thread (inbound left-aligned, outbound right-aligned — outbound styling
  exists in the CSS in advance of Phase 6, but nothing produces outbound messages yet).

## Deliberately not in Phase 5

No compose/reply box (Phase 6 — Agent Reply / Outbound Messaging). No stage, remarks,
or reminder panels (Phase 8/9 — those entities exist in storage from Phase 2 but have
no service layer yet; showing non-functional placeholder UI for them was ruled out as
a "half-finished implementation"). No round-robin assignment UI (Phase 7).

## Testing note

There is no local dev-server equivalent for Apps Script `HtmlService`. The only way to
see and use this UI is the real deployed Web App URL, opened in a browser signed into
a Google Workspace account within `echt.co.in`. Server-side authorization logic
(`Phase5Api`) is Node-tested (`tests/phase5-inbox-verification.js`); the actual
rendered page is verified live by the user, the same collaborative pattern used for
every other live-verification step in this project.
