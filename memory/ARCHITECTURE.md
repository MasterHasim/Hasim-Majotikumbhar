# Architecture

## Status
Initial foundation. Detailed architecture is maintained in docs\REQUIREMENTS.md and related specification files.

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
