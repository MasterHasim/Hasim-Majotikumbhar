# Phase 1 service API

Public entry points derive identity from Google Workspace; callers cannot supply an actor ID. Roles are fixed and are exposed read-only by `listRoles`.

| Area | Methods |
| --- | --- |
| Bootstrap | `bootstrapPhase1(profile)` |
| Users | `createUser`, `updateUser`, `listUsers` |
| Roles | `listRoles` |
| Teams | `createTeam`, `updateTeam`, `addTeamMember`, `updateTeamMember`, `listTeams` |
| Number access | `grantNumberAccess`, `revokeNumberAccess`, `listNumberAccess` |
| Availability | `setAvailability`, `setUserAvailability`, `getAvailability` |
| Assignment eligibility | `setAssignmentEligibility`, `getAssignmentEligibility` |
| Future conversation authorization contract | `authorizeConversationOperation(action, context)` |
| Audit | `listAuditLog` |

`authorizeConversationOperation` checks a supplied future-adapter context (`numberId`, `teamId`, and `assignedUserId`) but never stores, sends, or modifies a conversation.
