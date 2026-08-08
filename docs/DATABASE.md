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
