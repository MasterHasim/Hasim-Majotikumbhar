# UI_SPECIFICATION

## Stack

Plain HTML/CSS/JavaScript served via Apps Script `HtmlService` — no build step, no
frontend framework (per the project's established stack). Client-side JS talks to the
server via `google.script.run` (Apps Script's own RPC mechanism), not `fetch`/REST.

## Entry point

`doGet(e)` in `src/Phase5Endpoints.gs` renders `frontend/Index.html`. Served from
deployment `phase5-admin-ui` (`Execute as: Me`, `Access: Anyone within ECHT`) — see
`memory/DECISIONS.md` for why `Execute as: Me` (not "User accessing the web app") is
the architecturally correct choice. Domain-restricted access means
`Session.getActiveUser()` still correctly reports each visitor's real identity, so
Phase 1's `AccessControl` applies normally here (unlike the anonymous webhook
deployment).

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

## Phase 6: reply

A fixed compose box at the bottom of the detail pane (`#composeText`/`#composeSend` in
`frontend/Index.html`) calls `sendReply(conversationId, text)`
(`src/Phase6Services.gs`). On success, both the detail pane and the conversation list
are reloaded (to reflect the cleared `needsResponse` flag and the new message). On
failure (including authorization denial for a non-assigned agent), an inline error
shows under the compose box rather than a full-page error — the box itself isn't
hidden based on role, since the backend enforces authorization regardless and adding a
"can I reply" pre-check endpoint wasn't needed for that. Failed sends render with a
red-tinted message bubble (`.message.FAILED`) and "Failed to send" label.

## Phase 8: stage & remarks

A `<select>` in the detail header (`#stageSelect`) lists all lead stages
(`listStages()`) and shows the customer's current one (`getCustomerStage`); changing
it calls `setCustomerStage`. A remarks mini-panel (`#remarksPane`, yellow-tinted,
clearly distinct from the WhatsApp message thread) shows existing remarks and a small
add-remark input, calling `addRemark`/`listRemarks`. If the signed-in user lacks
remarks access (e.g. VIEWER — has neither `REMARKS_VIEW` nor `REMARKS_MANAGE`), the
panel just hides itself rather than showing an error, since that's an expected,
role-based absence, not a failure.

## Phase 9: reminders & snooze

A blue-tinted reminders mini-panel (`#remindersPane`, same hide-on-denied pattern as
remarks) lists pending reminders with a "Done" button (`updateReminderStatus` →
`COMPLETED`) and an add form (text + `datetime-local` input → `createReminder`). A
"Snooze…"/"Un-snooze" button in the detail header (`#snoozeBtn`) calls
`getSnoozeStatus` first to decide which action applies; snoozing prompts for a number
of hours and calls `snoozeConversation`, which also reloads the conversation list so
the now-hidden conversation disappears immediately. A yellow banner
(`#snoozeBanner`) shows "Snoozed until …" when applicable.

## Phase 10: send a template

A `<select>` (`#templateSelect`) in the compose row lists `APPROVED` templates only
(`listTemplates()`, filtered client-side). Selecting one and clicking "Send Template"
prompts once per `{{n}}` placeholder found in the template's `BODY` component, then
calls `sendTemplateReply`. No template-authoring UI (draft/submit/sync) — that's an
admin-configuration workflow better suited to Phase 12's Admin Panel; `Phase10Api`'s
draft/submit/sync methods exist and are tested at the API level.

## Phase 11: quick replies & media

A `<select>` (`#quickReplySelect`) in the compose row lists active quick replies
(`listQuickReplies()`). Selecting one inserts its text into the compose textarea
(appended, not replacing existing text) rather than sending immediately — the agent
can still edit before hitting Send, and it reuses the exact same `sendReply` path,
so no separate send code path was needed for quick replies. No quick-reply authoring
UI (create/edit shortcuts) — that's admin configuration, same reasoning as Phase 10's
template authoring being deferred to Phase 12's Admin Panel; `Phase11Api`'s
`createQuickReply`/`updateQuickReply` exist and are tested at the API level.

A "Media…" button (`#mediaSend`) prompts for media type, URL, and an optional caption
(three sequential `prompt()` calls — the same minimal, no-modal-dialog UI style already
used for snooze duration), then calls `sendMediaReply`. This mirrors the "Send Template"
button's pattern rather than adding a persistent form, since media sending is expected
to be occasional, not the primary compose action.

## Phase 12: reassignment & Admin Panel

The reassignment UI deferred from Phase 7 is now in the inbox detail header: a
"Reassign…" button (`#reassignBtn`) calls the new `Phase7Api.listAssignableUsers(numberId)`
(`src/Phase7Services.gs`) — ADMIN gets every active user, SUPERVISOR/SITE_MANAGER get
active members of the team that covers that number, anyone else gets `FORBIDDEN` and
the button just hides (same hide-on-denied pattern as remarks/reminders). Picking a
user (via a numbered `prompt()` list, consistent with this project's minimal-UI
convention) calls `reassignConversation`.

A separate page, `frontend/Admin.html`, served at `?page=admin` (routed in `doGet`,
`src/Phase5Endpoints.gs`) is the roadmap's Admin Panel. It's client-side-gated by a new
`whoAmI()` endpoint (`src/Phase1Services.gs` — returns the signed-in user's own id/role
keys, never used as the actual authorization decision, only to decide what the UI shows)
and linked from the main inbox header only when the signed-in user is ADMIN. Every
section is real server-enforced ADMIN-only regardless of the client-side gate. Sections:

- **Dashboard** — small landing counts (`getDashboardSummary`, `src/Phase12Services.gs`)
  — numbers/users/open/unassigned/needs-response totals only, deliberately not
  Phase 14's trend/response-time analytics, so this doesn't step on that future phase.
- **Users / Teams / Numbers / Number Access / Audit Log** — thin UI over each entity's
  own existing service layer (Phase 1 and Phase 3 — nothing new here except the new
  `listTeamMembers(teamId)` endpoint the Teams section needed and didn't have before).
- **Assignment Rules** — the one genuinely new backend piece: `Number_Assignment_Config`/
  `Number_Assignment_Users` (Phase 2's schema) had no admin-facing CRUD at all before
  now — only Phase 7's engine read them, only tests ever wrote them. `Phase12Api`
  (`src/Phase12Services.gs`) adds `getNumberAssignmentConfig`/`setNumberAssignmentConfig`
  (upsert) and `listAssignmentParticipants`/`addAssignmentParticipant`/
  `updateAssignmentParticipant`, gated on `NUMBERS_ADMIN` (the same permission Phase 3's
  number CRUD already uses).
- **Lead Stages / Quick Replies / Templates** — thin UI over Phase 8/11/10's existing
  service layers. Template authoring in the admin panel closes the gap Phase 10 left
  open ("no template authoring UI... better suited to Phase 12's Admin Panel").

Row-level edits throughout Admin.html use sequential `prompt()`/`confirm()` calls
rather than inline edit forms, matching the project's established minimal-UI style
(already used for snooze duration, media type/URL/caption) rather than building a
heavier modal/dialog system for a low-traffic admin surface.

## Phase 13: search, filters & needs-response badges

A filter bar (`.filter-bar`) sits under the Conversations pane header: a search input
(`#searchQuery`, debounced only by being typed-triggered via `oninput`, no separate
button) plus "Needs response" and "Unassigned" checkboxes. Any of the three active
switches `loadConversations()` from `listConversations(numberId)` (Phase 5, unfiltered)
to `searchConversations(filters)` (Phase 13, `src/Phase13Services.gs`) — same result
shape either way, so `renderConversations` handles both without a branch. Search results
additionally carry `customerName`/`numberDisplayName` (useful once cross-number search
is wired up further), shown in place of the plain status/date row when present.

Each number in the Numbers pane shows a small red needs-response count badge
(`getNeedsResponseCounts()`), refreshed whenever the conversation list reloads (i.e.
after every send/reassign/snooze action, not just on page load) — this is Phase 13's
"Notifications": deliberately scoped to an in-UI badge, not push/email, since Apps
Script has no clean push channel and building one wasn't asked for — see
`memory/DECISIONS.md`.

## Phase 14: Reports overlay

A "Reports" link appears next to "Admin Panel" in the Numbers pane header, but its
visibility isn't role-checked client-side — it's shown only if a probe call to
`getDashboardMetrics()` succeeds on load (mirrors the hide-on-denied pattern already
used for the remarks/reminders panels), since `REPORTS_VIEW` is what actually gates it
server-side, not any specific role name. Clicking it opens a full-page overlay
(`#reportsOverlay`) with tables for conversation totals, per-number and per-agent
breakdowns, average first-response time, stage distribution, template usage, and lead
conversion rate — all from `Phase14Api.getDashboardMetrics()`
(`src/Phase14Services.gs`). A plain overlay rather than a third page (like
`Admin.html`) since reports are a read-only, occasional lookup, not a distinct workflow
surface.

## Phase 15: Backup section (Admin Panel)

A new "Backup" nav section in `frontend/Admin.html` — a "Back up now" button
(`backupNow()`, shows the created copy's name + a link to open it in Drive) and an
enable/disable control for the daily automatic backup trigger
(`installDailyBackupTrigger()`/`removeDailyBackupTrigger()`, with current status shown
via `getBackupTriggerStatus()`).

## Post-Phase-18 follow-up (2026-08-10, user-directed)

**Performance**: a single new endpoint, `getConversationWorkspace(conversationId)`
(`WorkspaceApi`, `src/WorkspaceServices.gs`), replaced 8 separate `google.script.run`
calls that used to fire every time a conversation was opened (detail, stage, remarks,
reminders, snooze status, templates, quick replies, reassignment eligibility) — each
one is a full Apps Script execution with real cold-start latency, which was the actual
cause of reported slowness, not rendering. `frontend/Index.html`'s `selectConversation`
now makes exactly one call; templates and quick replies (not conversation-specific)
are cached client-side after their first load per page session, and stage
definitions were already cached this way since Phase 8.

**Resolve**: a "Resolve" button (`#resolveBtn`) appears in the detail header for any
open conversation, calling the new `resolveConversation` (`Phase6Api`, same
authorization as reply — assigned AGENT or ADMIN). A resolved conversation
disappears from the active conversation list (same as a snoozed one) but is still
reachable via search with an explicit `status: 'CLOSED'` filter.

**Reports scoping**: superseded the original Phase 14 decision to leave `REPORTS_VIEW`
org-wide — see `docs/DATABASE.md`'s "Post-Phase-18 follow-up" section for the reversal.

## Deliberately not yet in the UI

No push/email notifications (Phase 13's own scoping decision — see above). No manual
"reopen" action for a resolved conversation (a new inbound message from that customer
naturally starts a fresh one instead — see above).

## Testing note

There is no local dev-server equivalent for Apps Script `HtmlService`. The only way to
see and use this UI is the real deployed Web App URL, opened in a browser signed into
a Google Workspace account within `echt.co.in`. Server-side authorization logic
(`Phase5Api`) is Node-tested (`tests/phase5-inbox-verification.js`); the actual
rendered page is verified live by the user, the same collaborative pattern used for
every other live-verification step in this project.
