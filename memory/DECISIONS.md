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
| 2026-08-09 | Consolidated the master 21-phase roadmap (`docs/ROADMAP.md`); Phase 2 is redefined as the Core Database/Repository Layer, inserted before WhatsApp/Exotel integration (now Phase 3). Supersedes the earlier coarser phase numbering | Accepted |
| 2026-08-09 | `appsscript.json` declares `executionApi.access = MYSELF` and explicit `oauthScopes` (`script.storage`, `userinfo.email`) so the Apps Script API can run administrative one-off functions under the developer's own identity | Accepted |
| 2026-08-09 | Phase 1 bootstrap must be executed via the Apps Script editor's Run button (temporary wrapper function, deleted after use), not `clasp run` — the script is bound to Apps Script's auto-managed default GCP project, and `scripts.run` (Execution API) rejects calls against that project regardless of granted OAuth scopes. A standard user-managed GCP project would be required to use `clasp run` instead | Accepted |
