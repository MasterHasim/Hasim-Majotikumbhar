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

Phase 2 adds a second repository adapter, `SheetRepository` (`src/Phase2Repository.gs`),
backed by a Google Spreadsheet — one tab per entity, one repository instance per tab —
conforming to the same `list/get/findOne/create/update/remove/replace/count` contract as
`PropertiesRepository`. `Users`, `Teams`, `Team_Members`, `User_Number_Access`, and
`Audit_Log` are **not** part of Phase 2; they remain on Phase 1's `PropertiesRepository`
by deliberate decision (see `memory/DECISIONS.md`). No repository below is wired to a
service or public endpoint yet — that happens as each entity's own phase arrives. The
backing spreadsheet ID (Script Property `wap.phase2.spreadsheetId`) is intentionally left
unconfigured until Phase 3.

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
