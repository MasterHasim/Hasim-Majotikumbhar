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

## Deliberately not yet in the UI

No round-robin assignment UI (Phase 7's engine runs automatically on ingestion;
manual reassignment exists at the API level but the UI control is
deferred to Phase 12, which needs a properly role-scoped user-listing endpoint anyway).
No template authoring UI (Phase 10 — see above).

## Testing note

There is no local dev-server equivalent for Apps Script `HtmlService`. The only way to
see and use this UI is the real deployed Web App URL, opened in a browser signed into
a Google Workspace account within `echt.co.in`. Server-side authorization logic
(`Phase5Api`) is Node-tested (`tests/phase5-inbox-verification.js`); the actual
rendered page is verified live by the user, the same collaborative pattern used for
every other live-verification step in this project.
