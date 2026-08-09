# Architecture

## Status
Phase 1 and Phase 2 are implemented as a provider-neutral Google Apps Script domain layer. Detailed contracts are maintained in `docs/` and `data/schemas/`.

## Phase 1 boundaries

- Google Workspace identity is the authentication boundary.
- Authorization is centralized in `AccessControl`; services must not perform ad-hoc role checks.
- Persistence is behind repository contracts. The initial `PropertiesRepository` is suitable for low-volume administrative data only and can be replaced without changing domain services.
- Phone/WhatsApp numbers are opaque external identifiers. No provider API, webhook, message, conversation, or Exotel behavior exists in Phase 1.

## Phase 2 boundaries

- A second persistence adapter, `SheetRepository` (`src/Phase2Repository.gs`), backs the CRM-scale entities (numbers, customers, conversations, messages, remarks, reminders, stages, templates, quick replies, number-assignment config) — one Google Sheet tab per entity, one repository instance per tab, conforming to the same repository contract shape as `PropertiesRepository`.
- Phase 1's own collections (Users, Teams, Team_Members, User_Number_Access, Audit_Log) are unchanged and remain on `PropertiesRepository`; Phase 2 does not migrate them.
- No Phase 2 repository is wired to a service or public endpoint yet, and no real spreadsheet has been provisioned (`wap.phase2.spreadsheetId` is unset) — both are deferred to Phase 3, the first phase with a real caller.

## Planned Logical Areas
1. WhatsApp / Meta integration
2. Webhook ingestion
3. Conversation and message storage
4. Agent assignment / round robin
5. Frontend CRM panel
6. Templates
7. Authentication / authorization
8. Audit and operational logging
9. Future Zoho integration

## Principle
Keep external integrations isolated from core business logic so providers can be changed without rewriting the CRM domain.
