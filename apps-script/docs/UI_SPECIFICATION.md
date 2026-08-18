# UI_SPECIFICATION

This describes the **current** UI. For how it got here (three-pane inbox → landing
screen → this unified sidebar app), see `memory/CHANGELOG.md`'s dated entries —
this file is kept current, not a running history.

## Stack

Plain HTML/CSS/JavaScript served via Apps Script `HtmlService` — no build step, no
frontend framework. Client-side JS talks to the server via `google.script.run` (Apps
Script's own RPC mechanism), not `fetch`/REST. Everything lives in one file,
`frontend/Index.html`, served by `doGet` (`src/Phase5Endpoints.gs`) from deployment
`phase5-admin-ui` (`Execute as: Me`, `Access: Anyone within ECHT` — domain-restricted
access still lets `Session.getActiveUser()` report each visitor's real identity, so
Phase 1's `AccessControl` applies normally).

## Overall structure (2026-08-10 redesign, refined same day)

The app opens on a **number-picker landing screen** (`#landingScreen` — a card grid,
`listMyNumbers()`, with needs-response badges per card via `getNeedsResponseCounts()`)
before anything else. Picking a card (`enterWorkspace(numberId)`) sets `selectedNumberId`
and reveals `#app` — the sidebar shell described below. This was the very first version
of this redesign's own decision (drop the landing screen, since `searchConversations`
can aggregate across every accessible number), **reversed same day per explicit user
instruction**: "not everything mixed" — the user wants to pick a number first, then
work entirely within that one number's context, with no cross-number blending anywhere
in Dashboard/Inbox/Customers/Reminders/Reports. See `memory/DECISIONS.md` for both the
original reasoning and the reversal.

Once inside a number's workspace, `#app` is a single-page shell matching a reference
commercial WhatsApp CRM's layout the user shared screenshots of: a dark-green sidebar
with icon+label navigation (plus a "current number" pill at the top, click to go back
to the landing screen — `showLanding()`), a top bar, and a swappable content area.
There is no longer a separate Admin Panel page (`frontend/Admin.html` and the
`?page=admin` route are retired) — every section, including what used to be
admin-only pages, is a client-side view within this one shell (`showPage(key)` toggles
`.page` visibility and calls that page's load function).

**Every conversation-data endpoint call is scoped to `selectedNumberId`**: `Phase14Api.
getDashboardMetrics(numberId)`, `Phase8Api.listCustomers(numberId)`, `Phase9Api.
listMyReminders(numberId)`, and every `searchConversations({..., numberId})` call all
take/pass it explicitly now (all three gained the optional parameter same day as this
reversal — see `memory/DECISIONS.md`). Only the org-wide admin pages (Users, Teams,
WhatsApp Numbers, Templates, Quick Replies, Settings, Audit Log) stay unscoped, since
those are genuinely cross-number configuration, not conversation data.

Sidebar nav items, in order: **Dashboard, Inbox, All Conversations, Unassigned,
Reminders, Customers, Reports** (visible only if `REPORTS_VIEW` is probed successfully,
same "call the real endpoint and hide on denial" pattern used throughout), then
ADMIN-only: **Templates, Quick Replies, Teams, Users, WhatsApp Numbers, Settings, Audit
Log**. Sidebar visibility is decided by `whoAmI()`'s `roleKeys` for the ADMIN-only
split, and by whether `getDashboardMetrics()` succeeds for the Reports item — never a
hardcoded assumption about which literal role has which permission.

The top bar has: page title, an **Availability** dropdown (wired to Phase 1's
pre-existing but previously-never-exposed `setAvailability`/`getAvailability` —
AVAILABLE/BUSY/OFFLINE/ON_LEAVE), and a notification bell showing conversations that
need a response (`searchConversations({needsResponse: true})`).

## Dashboard / Inbox / All Conversations / Unassigned — one shared view

These four nav items are the same underlying list+chat+customer-detail three-column
view, always additionally filtered to `numberId: selectedNumberId` (the number chosen
on the landing screen — see above), plus default filters passed to
`searchConversations`: Dashboard/All Conversations add none beyond that, Inbox adds
`needsResponse: true`, Unassigned adds `unassigned: true`. Dashboard additionally shows
a KPI row above the view (`getDashboardMetrics(selectedNumberId)` — Total
Conversations, Assigned to me, Unassigned, Closed, Total Customers, all for this one
number; **no trend deltas** like "+18% vs yesterday" — the user chose real-counts-only
over building historical snapshot tracking for now, see `memory/DECISIONS.md`). There
is no per-list number filter anymore — that was removed the same day it was added,
once the landing screen came back and made it redundant (a conversation list is always
already scoped to exactly one number by construction).

**Architecturally important**: there is exactly **one** DOM instance of the
list+chat+detail split, ever (`window.__splitEl`, built once by `ensureSplitBuilt()`).
Switching between Dashboard/Inbox/All Conversations/Unassigned moves this single
element into that page's slot via `appendChild` (which the DOM API defines as "remove
from wherever it was, insert here") rather than each page building its own copy. This
was a real bug caught before shipping: building 4 independent copies would have left
3 hidden-but-present in the DOM at once, and every `document.getElementById('messagesList')`
(and `assignSelect`, `stageSelect`, `composeBody`, etc.) would have ambiguously
resolved to whichever copy was built first, not necessarily the visible one. The
single-shared-element approach makes plain `getElementById` calls throughout the chat/
compose/detail code safe by construction — there is only ever one of each id in the DOM.

### Chat panel

Header: customer name, status pill, an inline **Assign** `<select>` (populated from
`Phase7Api.listAssignableUsers`, same properly role-scoped list Phase 12 built —
ADMIN sees everyone, SUPERVISOR/SITE_MANAGER see their team, changing it calls
`reassignConversation` directly, no `prompt()` needed anymore), **Snooze…**, and
**Resolve** (hidden once already `CLOSED`) buttons.

Message thread: date-divider rows (`renderMessagesWithDates`), sender name on outbound
bubbles (`WorkspaceApi`'s `senderName` — the roadmap's "Rahul replied," not just
"Agent replied"), inline image rendering or an icon+link for other media types
(`WorkspaceApi`'s `media` join against `Message_Media`), and a simple
✓ (sent) / ✓✓ (read) suffix on outbound message timestamps derived from `status`.

Compose: **Reply**/**Note** tabs above the input. Reply has the textarea + send
button, plus a toolbar (Quick reply select, Template select + Send, Media… button —
the same `sendReply`/`sendTemplateReply`/`sendMediaReply` endpoints as before). Note
is a separate textarea that calls `addRemark` — the same underlying Remarks data the
Customer Details panel's Notes section reads, just two entry points into it (matching
the reference UX, which has both a compose-area Note tab and a panel-level Notes list
backed by the same data).

### Customer Details panel (right column)

Avatar (initials-in-circle — no photo storage), name, phone/email/company, "Customer
since" (`Customers.createdAt`), "Assigned to" (`WorkspaceApi.assignedUserName`), and
an **Edit details** button (`updateCustomer` — name/email/company only; phone stays
read-only since it's the identity Phase 4's ingestion matches inbound messages
against). Below that, three collapsible `<details>` sections: **Previous
Conversations** (count + list, `searchConversations({customerId, status: 'ANY'})` —
the `ANY` status bypass added specifically for this, so resolved conversations still
show up in someone's history), **Notes** (Remarks, shown/added the same as the Reply/
Note tab), **Reminders** (per-conversation, same `createReminder`/
`updateReminderStatus` as before).

## Customers page

A flat directory scoped to the current number (`Phase8Api.listCustomers(selectedNumberId)`
— ADMIN sees everyone with a conversation on this number, others see only customers
they have at least one viewable conversation with on it, same relationship gate
`setCustomerStage` already used). "View conversations" jumps into All Conversations
and opens that customer's most recent conversation on this number.

## Reminders page

The signed-in user's own pending reminders on this number's conversations
(`listMyReminders(selectedNumberId)`, pre-existing endpoint, previously unused in any UI).

## Reports page

Full-page version of what was previously an overlay: conversation totals, per-number
and per-agent breakdowns, average first-response time, stage distribution, template
usage, lead conversion rate — all from `Phase14Api.getDashboardMetrics(selectedNumberId)`,
scoped to the current number (and, within that, only numbers the signed-in user
actually has access to — not org-wide —
see `memory/DECISIONS.md` for the same-day reversal of the original Phase 14 decision).

## Admin-only pages (Templates, Quick Replies, Teams, Users, WhatsApp Numbers, Settings, Audit Log)

Directly ported from the retired `frontend/Admin.html` — same backend calls, same
`prompt()`/`confirm()` row-edit pattern (deliberately kept: a heavier modal/dialog
system isn't worth building for a low-traffic admin surface), just reskinned into the
new shell's visual language. **Settings** consolidates what used to be three separate
Admin Panel sections (Number Access, Assignment Rules, Backup) plus Lead Stages into
one page with sub-tabs, since the reference layout has a single "Settings" nav item
rather than one per admin concern.

## Deliberately not yet in the UI

No push/email notifications (bell is in-app only — see `memory/DECISIONS.md`'s
original Phase 13 scoping decision, still the reasoning). No manual "reopen" for a
resolved conversation (a new inbound message from that customer starts a fresh one
automatically). No "Mentions" nav item from the reference mockup — there's no
`@mention` concept anywhere in this system's data model, and inventing one wasn't
part of what was asked; omitted rather than faked. No real avatar photos (initials
only — no image storage exists). No KPI trend deltas ("+18% vs yesterday") — would
need new daily-snapshot infrastructure the user chose to defer.

## Testing note

There is no local dev-server equivalent for Apps Script `HtmlService`. The only way to
see and use this UI is the real deployed Web App URL, opened in a browser signed into
a Google Workspace account within `echt.co.in`. Server-side authorization logic is
Node-tested (`tests/*.js`); the actual rendered page is verified live by the user, the
same collaborative pattern used throughout this project. A syntax check
(`node --check` against the extracted `<script>` block) is run before every deploy as
a minimum sanity gate, but it cannot catch DOM-structure or wiring bugs — those were
caught by careful code review this round (see the shared-split-element note above).
