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

`WhatsApp_Numbers` is now populated with real (partial) data: the 10 known numbers,
registered through the authorized `createNumber` endpoint (`src/Phase3Services.gs`),
not written directly to the repository. `providerAccountId`, `wabaId`, and
`providerNumberId` are seeded as empty strings until the user supplies the real Exotel
values, at which point `updateNumber` fills them in — no schema change needed.

Provider abstraction: `Phase3ProviderContract` (`src/Phase3Domain.gs`) is a plain array
of method names (`sendText`, `sendMedia`, `sendTemplate`, `getTemplates`,
`createTemplate`, `getMessageStatus`, `processWebhook`), matching Phase1/Phase2's
contract-array convention. `ExotelProvider` (`src/Phase3ExotelProvider.gs`) is the first
implementation. Credentials come from Script Properties `EXOTEL_API_KEY`,
`EXOTEL_API_TOKEN`, `EXOTEL_ACCOUNT_SID`, `EXOTEL_SUBDOMAIN` — never committed to Git.

**Every Exotel request/response field name in `ExotelProvider` is unverified** (Exotel's
detailed API reference pages returned 404 on fetch); only the base URL pattern and Basic
Auth scheme are confirmed from public docs. See `memory/DECISIONS.md` for what's
confirmed vs. assumed, and `PROGRESS.md` for the live-verification status.
