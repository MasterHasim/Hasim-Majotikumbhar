# Phase 1 data contracts

Administrative records are stored through the repository contract with UTC timestamps. `PropertiesRepository` is a low-volume administrative adapter only.

| Collection | Required contract |
| --- | --- |
| users | `email`, `displayName`, status (`active`/`inactive`/`suspended`), fixed-role `roleIds` |
| roles | Exactly `ADMIN`, `SUPERVISOR`, `SITE_MANAGER`, `AGENT`, `VIEWER`; immutable matrix from `Phase1RoleDefinitions` |
| teams | `name`, active/inactive status, `ownerUserId` referencing a `SITE_MANAGER` |
| teamMembers | active/inactive user/team membership and scoped `numberIds` |
| numberAccess | `userId`, opaque `numberId`, boolean `granted`, active/inactive status |
| assignmentEligibility | `userId`, `numberId`, `teamId`, boolean `eligible` |
| availability | `userId`, status (`available`/`busy`/`offline`/`on_leave`) |
| auditLog | actor when known, action, target, UTC timestamp, sanitized metadata |

`numberAccess`, `assignmentEligibility`, and `availability` are intentionally separate collections. No conversation or external-provider record is stored in Phase 1.

# Phase 2 data contracts

Phase 2 adds a second repository adapter, `SheetRepository` (`src/Phase2Persistence.gs`),
backed by a Google Spreadsheet — one tab per entity, one repository instance per tab —
conforming to the same `list/get/findOne/create/update/remove/replace/count` contract as
`PropertiesRepository`. `Users`, `Teams`, `Team_Members`, `User_Number_Access`, and
`Audit_Log` are **not** part of Phase 2; they remain on Phase 1's `PropertiesRepository`
by deliberate decision (see `memory/DECISIONS.md`). No repository below is wired to a
service or public endpoint yet — that happens as each entity's own phase arrives. The
backing spreadsheet ID is read from Script Property `SPREADSHEET_ID` (configured
2026-08-09, spreadsheet `1qugfpq7dfNd2phwb8GVh_6VEsDe1Kf0fd76w3JQcqt4`). The property is
named `SPREADSHEET_ID` rather than the `wap.*` namespaced style used elsewhere
(`wap.phase1.bootstrapAdminEmail`) because it was configured directly in the Apps Script
project before the naming convention was reconciled; the code was adjusted to match
rather than asking for a rename.

| Tab (`Phase2Schemas` key) | Repository | Columns beyond `id` |
| --- | --- | --- |
| `WhatsApp_Numbers` | `NumberRepository` | `displayName`, `phoneNumber`, `provider`, `providerAccountId`, `wabaId`, `providerNumberId`, `active`, `createdAt`, `updatedAt` |
| `Number_Assignment_Config` | `AccessRepository.config` | `numberId`, `roundRobinEnabled`, `fallbackUserId`, `workingHoursStart`, `workingHoursEnd`, `createdAt`, `updatedAt` |
| `Number_Assignment_Users` | `AccessRepository.users` | `numberId`, `userId`, `sequenceOrder`, `active`, `createdAt`, `updatedAt` |
| `Customers` | `CustomerRepository` | `phone`, `name`, `email`, `company`, `source`, `createdAt`, `updatedAt` |
| `Conversations` | `ConversationRepository` | `customerId`, `numberId`, `assignedUserId`, `status`, `needsResponse`, `lastMessageAt`, `createdAt`, `updatedAt` |
| `Conversation_Assignments` | `AssignmentRepository` | `conversationId`, `userId`, `assignedBy`, `assignedAt`, `reason` |
| `Messages` | `MessageRepository` | `conversationId`, `numberId`, `senderUserId`, `direction`, `messageType`, `messageText`, `providerMessageId`, `status`, `timestamp` |
| `Remarks` | `RemarkRepository` | `conversationId`, `authorUserId`, `text`, `createdAt` |
| `Reminders` | `ReminderRepository` | `conversationId`, `ownerUserId`, `text`, `dueAt`, `status`, `createdAt`, `updatedAt` |
| `Lead_Stages` | `StageRepository` | `key`, `name`, `sequenceOrder`, `active`, `createdAt`, `updatedAt` |
| `WhatsApp_Templates` | `TemplateRepository` | `wabaId`, `providerTemplateId`, `name`, `language`, `category`, `status`, `components`, `variables`, `createdAt`, `updatedAt`, `lastSyncedAt` |
| `Quick_Replies` | `QuickReplyRepository` | `shortcut`, `text`, `active`, `createdAt`, `updatedAt` |

`AccessRepository` is the one composite: it holds two `SheetRepository` instances
(`.config` and `.users`) rather than extending `SheetRepository` itself, since a
number's round-robin configuration and its ordered participant list are two related but
distinct tabs.

# Phase 3 data contracts

`WhatsApp_Numbers` is now populated with real data: the 10 known numbers, registered
through the authorized `createNumber` endpoint (`src/Phase3Services.gs`). 8 of 10 now
have real `providerAccountId`/`wabaId`/`providerNumberId` values (all share
`providerAccountId: 'echt61'`), entered directly in the sheet rather than through
`updateNumber` — see `memory/DECISIONS.md` for the audit-trail note this leaves.
`Spreewalk - Raipur` and `ECHT Advisory` still have blank provider fields.

Provider abstraction: `Phase3ProviderContract` (`src/Phase3Domain.gs`) is a plain array
of method names (`sendText`, `sendMedia`, `sendTemplate`, `getTemplates`,
`createTemplate`, `getMessageStatus`, `processWebhook`), matching Phase1/Phase2's
contract-array convention. `ExotelProvider` (`src/Phase3ExotelProvider.gs`) is the first
implementation. Credentials come from Script Properties `EXOTEL_API_KEY`,
`EXOTEL_API_TOKEN`, `EXOTEL_ACCOUNT_SID`, `EXOTEL_SUBDOMAIN` — never committed to Git,
never stored in the spreadsheet either (see `memory/DECISIONS.md`, 2026-08-09).

`Exotel_Config_Status` is a non-secret status tab (`refreshExotelConfigStatus()` in
`src/Phase3ExotelConfigStatus.gs`) listing only the four `EXOTEL_*` property NAMES and
whether each is currently set — never the actual values.

**`getTemplates()` is live-verified** (2026-08-09, real account, real templates
returned) — endpoint path, required `waba_id` parameter, and full response shape are
confirmed, documented inline in `src/Phase3ExotelProvider.gs`. `sendText`/`sendMedia`/
`sendTemplate`/`createTemplate`/`getMessageStatus` remain unverified best-effort guesses
by design — verifying those means sending a real message or creating a real template,
deliberately deferred to Phase 6. See `memory/DECISIONS.md` for exactly what's confirmed
vs. assumed, and `PROGRESS.md` for current status.

# Phase 4 data contracts

No new entities — Phase 4 is the first real writer of `Customers`, `Conversations`, and
`Messages` (all defined in Phase 2, unused until now). See `docs/WEBHOOK.md` for the
full ingestion flow, idempotency, and authentication model.

# Phase 5 data contracts

No new entities — the first UI, reading `WhatsApp_Numbers`/`Conversations`/`Customers`/
`Messages` through the authorization-scoped `Phase5Api`. See `docs/UI_SPECIFICATION.md`.

# Phase 6 data contracts

No new entities — `Phase6Api.sendReply` (`src/Phase6Services.gs`) is the first writer
of `direction: 'OUTBOUND'` `Messages`. `senderUserId` records who actually sent it
(the roadmap's explicit rule: "Rahul replied at 2:41 PM," not just "Agent replied").
`status` is `SENT` on a successful provider call, `FAILED` on a provider/network error
(the message is still recorded, for visibility/retry — `needsResponse` is only cleared
on `SENT`). `ExotelProvider.sendText`'s request/response shape used here is
**unverified** — see `memory/DECISIONS.md`.

# Phase 7 data contracts

No new entities — the first real writer of `Conversation_Assignments`
(`AssignmentRepository`, Phase 2) and of `Conversations.assignedUserId`. Added
`lastAssignedUserId` to `Number_Assignment_Config`'s schema (a genuinely new column on
an until-now-unused, empty tab — no migration risk). See `docs/ROUND_ROBIN.md`.

# Phase 8 data contracts

One new entity: `Customer_Stage` (`CustomerStageRepository`,
`customerId, stageId, setByUserId, updatedAt`) — deliberately its **own tab**, not a
new column on `Customers`, since `Customers` already holds real live data and
`SheetRepository` has no safe header-migration mechanism (a new column on an existing
schema would misalign already-written rows — `appendRow_`/`writeRow_` build row values
positionally from the schema array). One record per customer (`replace`-upserted), not
a history log. `Lead_Stages` (already defined in Phase 2, unused until now) holds the
admin-configurable stage definitions; `Phase8DefaultStages`
(`src/Phase8Domain.gs`) is a one-time seed list, not hardcoded business logic — the
roadmap's suggested initial set (New, Contacted, Interested, Quotation Sent,
Negotiation, Won, Lost), seeded via `seedDefaultLeadStages()` and freely editable by an
admin afterward. `Remarks` (Phase 2, unused until now) is now written via `addRemark`.

# Phase 9 data contracts

`Reminders` (Phase 2, unused until now) is now written via `createReminder`/
`updateReminderStatus`. One new entity: `Conversation_Snooze`
(`ConversationSnoozeRepository`, `conversationId, snoozedUntil, snoozedByUserId,
createdAt`) — its own tab for the same reason as Phase 8's `Customer_Stage`
(`Conversations` already has real live data). Snooze auto-expires by comparison
(`isConversationSnoozed_`, `src/Phase9Domain.gs`) — once `snoozedUntil` is in the past
the conversation is active again on the next read, no scheduled job needed. One record
per conversation (`replace`-upserted).

# Phase 10 data contracts

No new entities — `WhatsApp_Templates` (Phase 2, unused until now) is now written via
`createDraftTemplate`/`submitTemplateForReview`/`syncTemplatesFromProvider`, and read
via `Phase6Api.sendTemplateReply`. See `docs/TEMPLATES.md` for the full workflow and
what's still unverified live.

# Phase 11 data contracts

`Quick_Replies` (Phase 2, unused until now) is now written via `createQuickReply`/
`updateQuickReply` (ADMIN-only, `SETTINGS_MANAGE` — same authorization level as Phase
8's `Lead_Stages`) and read via `listQuickReplies` (any authenticated user; the compose
box's shortcut picker). One new entity: `Message_Media` (`MessageMediaRepository`,
`messageId, mediaType, mediaUrl, caption`) — its own tab for the same reason as
Phase 8/9's `Customer_Stage`/`Conversation_Snooze` (`Messages` already has real live
data, and `SheetRepository` has no safe header-migration mechanism). Unlike those two,
`Message_Media` is a plain `create` (one row per media message, keyed by its own id),
not a `replace`-upsert — a message's media never changes after the fact.

Written from two directions: `Phase6Api.sendMediaReply` (`src/Phase6Services.gs`)
creates the `OUTBOUND` `Messages` row via the existing `sendOutbound_` helper, then
writes the `Message_Media` row on success or failure alike (the send attempt itself is
still real, so the record stays for visibility/retry, matching how a `FAILED` text
message is still recorded). `Phase4Api.ingestInboundMessage` (`src/Phase4Services.gs`)
writes a `Message_Media` row only when the normalized webhook payload carries a
`mediaUrl`.

`ExotelProvider.sendMedia` and the new `extractInboundMediaUrl_` helper
(`src/Phase3ExotelProvider.gs`) are both **UNVERIFIED** — no real media message has
ever been sent or received through this integration. `sendMedia`'s request shape
mirrors the same best-effort convention as `sendText`/`sendTemplate` (unverified since
Phase 3, still pending a live test — see `memory/DECISIONS.md`). `extractInboundMediaUrl_`
is modeled on the WhatsApp Cloud API's inbound-media shape (`content.<type>.link` or
`.url`) since no real inbound media webhook has ever been observed (only inbound text,
confirmed 2026-08-10) — flagged clearly in code, to be corrected once a real media
message arrives, same live-verify-and-fix pattern used throughout this project.

# Phase 12 data contracts

No new entities. `Number_Assignment_Config`/`Number_Assignment_Users` (Phase 2,
defined but only ever written by Phase 7's engine or directly by tests until now) get
their first admin-facing CRUD via `Phase12Api` (`src/Phase12Services.gs`) — gated on
`NUMBERS_ADMIN`, the same permission Phase 3's `WhatsApp_Numbers` CRUD already uses.
`setNumberAssignmentConfig` is an upsert keyed by `numberId` (create-if-missing,
patch-if-present) rather than requiring the caller to know whether a config row already
exists. `Users`/`Teams`/`Team_Members` (Phase 1) gained one new read endpoint,
`listTeamMembers(teamId)`, that the Admin Panel's Teams section needed and nothing
before it had exposed.

# Phase 13 data contracts

No new entities. `Phase13Api` (`src/Phase13Services.gs`) adds `searchConversations`
and `getNeedsResponseCounts`, both composing Phase 5's already-authorized
`listMyNumbers()`/`listConversations()` rather than re-implementing any access-control
logic — search/filtering happens only within the conversation set a user is already
allowed to see. `searchConversations` matches `Customers.name`/`.phone` and
`Messages.messageText` (case-insensitive substring), plus filters on
`assignedUserId`/`status`/`needsResponse`/`unassigned`/`stageId` (via Phase 8's
`Customer_Stage`)/`dateFrom`/`dateTo` (against `lastMessageAt`).

# Phase 14 data contracts

No new entities. `Phase14Api` (`src/Phase14Services.gs`) computes dashboard metrics
entirely from existing data, gated on `REPORTS_VIEW` — a permission Phase 1 already
defined (SUPERVISOR/SITE_MANAGER/VIEWER/ADMIN have it, AGENT does not) but nothing used
before now. Template usage is parsed from `Messages.messageText`'s `"[Template: name]"`
marker rather than a `templateId` column, since `Messages` already has real live data
and gaining a new column isn't safe (the same constraint documented since Phase 8).
`resolved` and the scoping rules below were both later revised — see "Post-Phase-18
follow-up" at the end of this file.

# Phase 15 data contracts

No new entities. Audit coverage: the roadmap's minimum audited-event list is already
satisfied by every prior phase's own `audit_.write(...)` calls —

| Roadmap event | Actual audit action(s) | Where |
| --- | --- | --- |
| LOGIN | `authentication.accepted` | `src/Phase1AccessControl.gs` |
| LOGOUT | *(none — see below)* | — |
| SEND_MESSAGE | `message.sent` / `message.sendFailed` / `message.ingested` | Phase 6 / Phase 4 |
| ASSIGN_CONVERSATION / REASSIGN_CONVERSATION | `conversation.assigned` (reason: `round_robin`/`returning_customer`/`fallback`/`manual`) | Phase 7 |
| CHANGE_STAGE | `customer.stageChanged` | Phase 8 |
| ADD_REMARK | `remark.added` | Phase 8 |
| ADD_REMINDER / COMPLETE_REMINDER | `reminder.created` / `reminder.statusChanged` | Phase 9 |
| CREATE_TEMPLATE / UPDATE_TEMPLATE / SYNC_TEMPLATES | `template.draftCreated`/`.draftUpdated`/`.submitted` / `templates.synced` | Phase 10 |
| CREATE_USER | `user.created` | Phase 1 |
| DISABLE_USER | `user.updated` (generic — `updateEntity_` doesn't special-case a status change) | Phase 1 |
| ASSIGN_NUMBER / REMOVE_NUMBER | `numberAccess.granted` / `numberAccess.revoked` | Phase 1 |

There is no LOGOUT event: authentication is Google's own session cookie, not an
app-level session the code controls, so there is nothing to log a logout against.

Secrets hygiene: verified clean this phase (grepped all source for hardcoded
key/token/secret-shaped literals — found none; every credential reads from Script
Properties; `.gitignore` already excludes `.clasp.json`/`.clasprc.json`/credential
files).

Backup: `Phase15Api.backupNow()` (`src/Phase15Services.gs`, `SETTINGS_MANAGE`) makes a
full timestamped copy of the application spreadsheet into Drive.
`installDailyBackupTrigger()`/`removeDailyBackupTrigger()` manage a time-driven Apps
Script trigger (`runScheduledBackup`, 2am Asia/Kolkata) that calls the same backup logic
directly — bypassing `AccessControl` entirely, since a trigger has no Google Workspace
identity to authenticate (same reasoning as Phase 4's webhook ingestion; see
`memory/DECISIONS.md`). Requires two new OAuth scopes added to `appsscript.json`
(`drive.file`, `script.scriptapp`) — a real manifest change that will trigger a fresh
consent screen the next time it runs.

# Post-Phase-18 follow-up (2026-08-10, user-directed)

No new entities. Two real behavior changes, both from explicit user decisions after
reviewing the deployed system:

- **`Phase6Api.resolveConversation(conversationId)`** is the first writer of
  `Conversations.status: 'CLOSED'` — any assigned AGENT or ADMIN can mark a
  conversation resolved once they feel it's handled (same `'reply'` authorization tier
  as `sendReply`/`sendTemplateReply`/`sendMediaReply` — no new permission invented).
  `Phase5Api.listConversations()` now excludes `CLOSED` conversations from the active
  inbox, same as snoozed ones; `listConversationsAllStatuses()` (new) returns every
  status, used by `Phase13Api.searchConversations` so a resolved conversation is still
  findable (defaults back to `OPEN`-only unless a specific `status` filter is given).
  No explicit "reopen" — a customer's next inbound message just starts a new `OPEN`
  conversation, since ingestion has always only ever reused a conversation with
  `status: 'OPEN'`.
- **`Phase14Api.getDashboardMetrics()` is now scoped**, not org-wide: it composes
  `Phase5Api.listMyNumbers()` (ADMIN sees every number; SUPERVISOR/SITE_MANAGER/VIEWER
  see only their admin-granted numbers) and restricts every metric — conversation
  totals, agent workload, response time, stage distribution, template usage, lead
  conversion — to that set. Supersedes the original Phase 14 decision to leave
  `REPORTS_VIEW` flat/org-wide; see `memory/DECISIONS.md` for both the original
  reasoning and the reversal.

**Workspace enrichment (2026-08-10, user-directed inbox polish)**: `WorkspaceApi.getConversationWorkspace` now also returns `assignedUserName` (resolved from `Conversations.assignedUserId`) and, per message, `senderName` (resolved from `Messages.senderUserId` — the roadmap's "Rahul replied at 2:41 PM," not just an opaque ID) and `media` (`{mediaType, mediaUrl, caption}` joined from `Message_Media`, or `null`). `Phase5Api.listConversations`/`listConversationsAllStatuses` now also return `customerName`/`customerPhone` per conversation (same enrichment `Phase13Api.searchConversations` already did, now applied at the source so the default conversation list shows the customer's name instead of just its status). No schema changes — all joins against existing tables, computed at read time.

Also new: **`WorkspaceApi.getConversationWorkspace(conversationId)`**
(`src/WorkspaceServices.gs`) — a pure performance aggregator, not a new phase or new
authorization concept. It composes `Phase5Api.getConversationDetail` +
`Phase8Api.getCustomerStage`/`listRemarks` + `Phase9Api.listReminders`/
`getSnoozeStatus` + `Phase7Api.listAssignableUsers` into a single response, catching
per-field authorization denials into `null`/`[]` rather than failing the whole call
(same hide-on-denied UX the individual panels already had). Added because opening one
conversation in the UI was firing 8 separate `google.script.run` round-trips — each a
full Apps Script execution with real cold-start latency — which was the actual
reported cause of "slow transitions," not rendering. See `memory/DECISIONS.md`.

# Unified-app redesign (2026-08-10, user-directed)

No new entities. Backend additions to support the new unified sidebar app
(`frontend/Index.html`, replacing the separate `frontend/Admin.html`):

- **`Phase8Api.listCustomers()`** — the Customers directory page. ADMIN sees every
  customer; anyone else sees only customers they have at least one viewable
  conversation with (`canSeeCustomer_`, the same relationship gate `setCustomerStage`/
  `getCustomerStage` already used).
- **`Phase8Api.updateCustomer(customerId, patch)`** — edits `name`/`email`/`company`
  only. `phone` is deliberately not editable here — it's the identity Phase 4's
  ingestion matches inbound messages against, so changing it through this endpoint
  would risk silently splitting a customer's message history across two records.
- **`Phase13Api.searchConversations`** gained a `customerId` filter and a
  `status: 'ANY'` bypass (skips the OPEN-only default entirely) — both needed for the
  Customer Details panel's "Previous Conversations" list, which should show a
  customer's full history including resolved conversations, not just their currently
  active ones.
- **`Phase14Api.getDashboardMetrics()`** gained `totalCustomers` (distinct customers
  across the scoped conversation set, reusing the `customerIds` map already computed
  for stage distribution/lead conversion) and `assignedToMe` (the signed-in user's own
  open-conversation count) for the new Dashboard KPI cards.

`WorkspaceApi.getConversationWorkspace` also gained `assignedUserName` (resolved from
`Conversations.assignedUserId`) and, per message, `senderName` and `media` — these
were actually added in the earlier "inbox polish" round (see above) and are reused
as-is by the new chat panel design.

`doGet` (`src/Phase5Endpoints.gs`) no longer branches on `?page=admin` — it always
serves `frontend/Index.html`, since there is only one app now.  `doGetAdmin()`
(`src/Phase12Endpoints.gs`) was removed along with `frontend/Admin.html`.

# Number-scoping reversal (2026-08-10, same day, user-directed)

No new entities. The unified-app redesign above originally dropped the number-picker
landing screen (reasoning: `searchConversations` already aggregates across every
accessible number). The user reversed this same day — "not everything mixed" — so the
landing screen is back as the mandatory entry point, and three endpoints gained an
optional `numberId` parameter to keep the whole workspace scoped to it once picked:

- `Phase14Api.getDashboardMetrics(numberId)` — narrows `listMyNumbers()` down to the
  one requested id before computing every metric. An inaccessible `numberId` yields
  empty metrics (filtered list is empty), not a bypass.
- `Phase8Api.listCustomers(numberId)` — narrows the directory to customers with at
  least one conversation on that number.
- `Phase9Api.listMyReminders(numberId)` — narrows to reminders on that number's
  conversations, joined through `Conversations`.

All three default to their original (unscoped, aggregate) behavior when `numberId` is
omitted — nothing about the underlying authorization changed, only what gets asked for.
`Phase13Api.searchConversations` didn't need a change; it already accepted an optional
`numberId` filter from Phase 13, the client just always supplies it now.
