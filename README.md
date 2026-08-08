# Whats App Panel

Multi-number WhatsApp CRM / panel project.

## Current implementation

Phase 1 provides the access-management foundation: Google Workspace identity authentication, users, roles, teams, opaque-number access grants, assignment eligibility, availability, centralized authorization, repositories, and audit logging. Provider integrations are intentionally not implemented.

## Project structure

- `src` — Google Apps Script application source
- `data/schemas` — provider-neutral domain contracts
- `docs` — functional, security, API, and persistence specifications
- `memory` — persistent engineering context and decisions
- `tests` — test specifications

## Engineering context

Read `memory/CODEX_CONTEXT.md` before making implementation changes.
