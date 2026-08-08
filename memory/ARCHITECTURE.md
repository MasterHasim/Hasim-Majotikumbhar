# Architecture

## Status
Phase 1 is implemented as a provider-neutral Google Apps Script domain layer. Detailed contracts are maintained in `docs/` and `data/schemas/`.

## Phase 1 boundaries

- Google Workspace identity is the authentication boundary.
- Authorization is centralized in `AccessControl`; services must not perform ad-hoc role checks.
- Persistence is behind repository contracts. The initial `PropertiesRepository` is suitable for low-volume administrative data only and can be replaced without changing domain services.
- Phone/WhatsApp numbers are opaque external identifiers. No provider API, webhook, message, conversation, or Exotel behavior exists in Phase 1.

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
