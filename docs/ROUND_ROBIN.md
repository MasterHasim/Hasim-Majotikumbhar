# ROUND_ROBIN

## Where

`Phase7Api` (`src/Phase7Services.gs`), invoked automatically by `Phase4Api.ingestInboundMessage`
(`src/Phase4Services.gs`) right after a brand-new conversation is created — outside
Phase 4's own lock, to avoid nesting two `LockService` locks in one execution.

## New lead vs. returning customer

A **new lead** is a genuinely new customer's first-ever conversation → goes through
round robin (`assignNewLead_`). A **returning customer**'s new conversation (e.g. after
a prior one closed) inherits their most recent prior `assignedUserId`
(`determinePriorOwner_`) instead — "existing customers retain their current owner
unless manually reassigned" (`docs/ROADMAP.md`). No round-robin pointer advance happens
for a returning customer.

## Eligibility

A participant (`Number_Assignment_Users`, Phase 2) is eligible for a new lead only if
**all** of these hold, each an independent, separately-managed concept per Phase 1:
- `Users.status === 'active'`
- An explicit `numberAccess` grant for that number (`granted: true`, `status: active`)
- An explicit `assignmentEligibility` grant for that user/number (Phase 1, unrelated to
  number access — a user can see a number without being eligible for new leads on it)
- `availability.status === 'available'`

Ineligible/inactive/unavailable participants are simply skipped in rotation — they stay
in `Number_Assignment_Users` but never receive a lead until they become eligible again.

## Rotation

`Number_Assignment_Config.lastAssignedUserId` (added in Phase 7 — unused by Phase 2's
original schema) tracks the pointer. The next assignee is whoever comes after
`lastAssignedUserId` in the current eligible list (ordered by `sequenceOrder`),
wrapping around. If `lastAssignedUserId` isn't in the current eligible list (removed,
newly ineligible, etc.) rotation just starts from the front — self-healing, no drift
tracking needed.

## Fallback and the unassigned queue

If round robin is disabled (`roundRobinEnabled !== true`), outside configured working
hours, or nobody is eligible, `Number_Assignment_Config.fallbackUserId` is used if set;
otherwise the conversation stays unassigned (`assignedUserId: ''`) — the "unassigned
queue" is simply the set of conversations with no assignee, not a separate collection.

Working hours (`workingHoursStart`/`workingHoursEnd`, `"HH:MM"` 24-hour strings,
`Asia/Kolkata`) are optional — if either is unset, there's no time restriction. String
comparison only; doesn't handle overnight ranges (e.g. `22:00`–`06:00`) since no
current number needs that.

## Concurrency

The whole read-pointer → select → update-pointer → record sequence runs inside one
`LockService.getScriptLock()` in `assignNewLead_`, per the roadmap's explicit
requirement — two near-simultaneous new leads can't land on the same agent.

## Manual reassignment & history

`reassignConversation(conversationId, newUserId)` reuses
`AccessControl.requireConversationOperation('reassign', ...)` — ADMIN globally,
SUPERVISOR/SITE_MANAGER within their team's number scope (`resolveTeamIdForNumber`).
Every assignment (`round_robin`, `returning_customer`, `fallback`, `manual`) is recorded
in `Conversation_Assignments` (`AssignmentRepository`, Phase 2) via `recordAssignment_`,
readable through `listAssignmentHistory(conversationId)`.

## Not yet in the UI

No reassignment control in `frontend/Index.html` yet — deferred to Phase 12 (Admin
Panel), which will need a properly role-scoped user-listing endpoint anyway (`listUsers`
today is ADMIN-only, but SUPERVISOR/SITE_MANAGER can also reassign within their team).
Building a one-off listing endpoint just for this now would be premature scope.
