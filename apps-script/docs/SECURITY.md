# Phase 1 security

Authentication uses `Session.getActiveUser().getEmail()` from Google Apps Script. Deployments must restrict execution to the intended Google Workspace users; consumer and anonymous contexts that do not expose an email are rejected.

Before the first bootstrap, an operator must configure Script Property `wap.phase1.bootstrapAdminEmail` with the intended administrator's normalized Google Workspace email. This prevents another permitted script executor from self-registering as the first administrator.

Bootstrap also creates a one-time, lock-protected claim before the administrator records are written. Concurrent first-run requests cannot create multiple administrators.

`AccessControl` is the sole authorization gateway. Permission checks are made before reads or mutations, except initial bootstrap. The only permitted roles are `ADMIN`, `SUPERVISOR`, `SITE_MANAGER`, `AGENT`, and `VIEWER`; their permission matrix is fixed in `Phase1RoleDefinitions`, and inactive roles do not grant permission.

Administrative changes, authentication outcomes, and authorization denials are audited. Audit events record actor when known, action, target, timestamp, and sanitized metadata. Secrets, authentication tokens, and external provider credentials must never be persisted in audit metadata or returned to clients.

The properties-backed repository uses `LockService` for writes. It is appropriate only for small administrative datasets. Scripts must not expose repository operations directly as public web endpoints without an authenticated service boundary.

# Phase 15/16: audit coverage, secrets hygiene, and a confirmed fix

The roadmap's minimum audited-event list (LOGIN, SEND_MESSAGE, ASSIGN_CONVERSATION,
CHANGE_STAGE, ADD_REMARK, ADD_REMINDER, CREATE_TEMPLATE, CREATE_USER, ASSIGN_NUMBER,
etc.) is fully covered — see the mapping table in `docs/DATABASE.md`'s "Phase 15 data
contracts" section. There is deliberately no LOGOUT event: authentication is Google's
own session cookie, not an app-controlled session.

Secrets hygiene was audited directly (grep across all source for hardcoded
key/token/secret-shaped literals): clean. Every credential is read from Script
Properties at runtime; `.gitignore` excludes `.clasp.json`, `.clasprc.json`, and any
credential-shaped filename.

**A confirmed authorization gap was found and fixed during the Phase 16 QA pass**:
`Phase8Api.getCustomerStage(customerId)` (`src/Phase8Services.gs`) had no
`AccessControl` check at all — any signed-in Google account, even one with no `Users`
record, could read any customer's lead stage. Fixed to require the same relationship
check `setCustomerStage` (the write path) already enforced. See `memory/DECISIONS.md`
for the full incident note. `tests/authorization-sweep-verification.js` is now a
permanent, static regression guard: it parses every public endpoint and confirms its
underlying method references `AccessControl`, directly or via a helper/delegate,
specifically to catch this class of mistake before it reaches a live deployment again.

Backups (`Phase15Api`, `src/Phase15Services.gs`) exist so that a mistake, a bad bulk
edit, or a Sheets-level accident isn't unrecoverable — see `docs/DEPLOYMENT.md` and
`PROGRESS.md` for enabling them.
