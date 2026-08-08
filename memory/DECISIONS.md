# Architecture & Product Decisions

| Date | Decision | Status |
|------|----------|--------|
| 2026-08-08 | Use Google environment as the initial platform direction | Accepted |
| 2026-08-08 | Support multiple WhatsApp numbers / WABAs | Accepted |
| 2026-08-08 | Existing Meta Business Portfolio and WABAs will be used | Accepted |
| 2026-08-08 | Keep conversations unread until the assigned user responds | Accepted |
| 2026-08-08 | Phase 1 authenticates through the active Google Workspace identity; no password or provider authentication is stored by the app | Accepted |
| 2026-08-08 | Use centralized permission checks and repository contracts; use Script Properties only as the initial administrative persistence adapter | Accepted |
| 2026-08-08 | Treat number IDs as opaque references until a later provider-integration phase | Accepted |
| 2026-08-08 | Phase 1 has exactly five fixed roles: ADMIN, SUPERVISOR, SITE_MANAGER, AGENT, and VIEWER; their permission matrix is code and documentation, not runtime-configurable | Accepted |
