# Phase 1 security

Authentication uses `Session.getActiveUser().getEmail()` from Google Apps Script. Deployments must restrict execution to the intended Google Workspace users; consumer and anonymous contexts that do not expose an email are rejected.

Before the first bootstrap, an operator must configure Script Property `wap.phase1.bootstrapAdminEmail` with the intended administrator's normalized Google Workspace email. This prevents another permitted script executor from self-registering as the first administrator.

Bootstrap also creates a one-time, lock-protected claim before the administrator records are written. Concurrent first-run requests cannot create multiple administrators.

`AccessControl` is the sole authorization gateway. Permission checks are made before reads or mutations, except initial bootstrap. The only permitted roles are `ADMIN`, `SUPERVISOR`, `SITE_MANAGER`, `AGENT`, and `VIEWER`; their permission matrix is fixed in `Phase1RoleDefinitions`, and inactive roles do not grant permission.

Administrative changes, authentication outcomes, and authorization denials are audited. Audit events record actor when known, action, target, timestamp, and sanitized metadata. Secrets, authentication tokens, and external provider credentials must never be persisted in audit metadata or returned to clients.

The properties-backed repository uses `LockService` for writes. It is appropriate only for small administrative datasets. Scripts must not expose repository operations directly as public web endpoints without an authenticated service boundary.
