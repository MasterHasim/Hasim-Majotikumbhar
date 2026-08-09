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
