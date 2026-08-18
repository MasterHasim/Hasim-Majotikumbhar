# Phase 1 requirements

## Scope and exclusions

Phase 1 is the provider-neutral access-control foundation. It has no WhatsApp, Meta, Exotel, webhook, conversation persistence, messaging, template, routing, or Phase 2 implementation. Conversation permissions are authorization contracts for a future adapter only.

## Fixed roles and permission matrix

Only these exact roles exist. Roles cannot be created, renamed, or assigned arbitrary permissions at runtime.

| Role | Server-enforced permissions |
| --- | --- |
| `ADMIN` | Global numbers and conversation access; users, templates, settings, reports, reassignment, round-robin configuration, audit, and all team administration. |
| `SUPERVISOR` | Authorized numbers; conversations and reassignment in actively assigned teams; reminders; remarks view; reports. Cannot administer users, settings, or number grants. |
| `SITE_MANAGER` | Authorized numbers; owns and controls its team; that team's conversations and reassignment; remarks, reminders, basic reports, and team eligibility. |
| `AGENT` | Authorized numbers; only assigned conversations; reply to assigned conversations; use templates; remarks, reminders, lead stages, and self availability. |
| `VIEWER` | Authorized conversation view, customer-detail view, and reports only. It cannot reply, assign/reassign, manage templates, or manage settings. |

The machine-readable role matrix is `Phase1RoleDefinitions` in `src/Phase1Domain.gs`; roles persisted at bootstrap are copies of that matrix.

## Independent access concepts

- User status is one of `active`, `inactive`, or `suspended`. Only `active` users authenticate.
- Number access is a separate boolean grant (`granted`). Missing, inactive, or false grants deny non-admin number and conversation operations.
- Assignment eligibility is a separate explicit boolean record per user/number/team. It does not become true solely because the user is available.
- Availability is one of `available`, `busy`, `offline`, or `on_leave`. It determines whether an otherwise eligible user is assignable now.
- A team has one `ownerUserId`, which must be a `SITE_MANAGER`. Active `Team_Members` scope `SUPERVISOR` operations; the owner scopes `SITE_MANAGER` operations; `ADMIN` is global.

## Security and audit rules

`AccessControl` is the sole authorization boundary for all non-bootstrap endpoints. Every mutation is audited; authentication outcomes and authorization denials are audited. Before bootstrap, Script Property `wap.phase1.bootstrapAdminEmail` must match the signed-in Google Workspace identity.
