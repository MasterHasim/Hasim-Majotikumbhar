# TESTING

## Running the suite

Every `tests/*.js` file is a standalone Node script: it mocks the Apps Script globals
it needs (`PropertiesService`, `SpreadsheetApp`, `LockService`, `Session`,
`UrlFetchApp`, `ScriptApp`, etc.), loads all `src/*.gs` files in real Apps Script load
order (alphabetical — this matters, see `memory/DECISIONS.md`), and asserts against
real class instances. No network calls, no real Google services.

```
node tests/run-all.js
```

runs every suite and prints a pass/fail summary. Individual suites can also be run
directly, e.g. `node tests/phase7-assignment-verification.js`.

## Coverage against the roadmap's Phase 16 checklist

| Roadmap requirement | Covered by | Notes |
| --- | --- | --- |
| Authentication: all five roles | `phase1-role-verification.js` | ADMIN/SUPERVISOR/SITE_MANAGER/AGENT/VIEWER all exercised |
| Authentication: unknown identity | `phase1-role-verification.js` | a Google identity with no `Users` record → `UNAUTHENTICATED` |
| Authentication: inactive/suspended user | `phase1-role-verification.js` | both statuses → `UNAUTHENTICATED`, not just "denied" |
| Access: authorized vs. unauthorized number/team access | `phase1-*`, `phase5-inbox-*`, `phase7-assignment-*`, `phase12-admin-panel-*` | includes the ADMIN reply/reassign bypass regression found mid-project |
| Round robin: normal sequence, wraparound | `phase7-assignment-verification.js` | |
| Round robin: inactive/ineligible/unavailable participants skipped | `phase7-assignment-verification.js` | |
| Round robin: outside working hours | `phase7-assignment-verification.js` | |
| Round robin: manual reassignment, properly role-scoped | `phase7-assignment-verification.js`, `phase12-admin-panel-verification.js` | `listAssignableUsers`' three-way split |
| Round robin: concurrent leads | *(see limitation below)* | |
| Messaging: inbound ingestion, idempotency | `phase4-ingestion-verification.js` | duplicate `providerMessageId` is a no-op |
| Messaging: outbound send, failure handling | `phase6-reply-verification.js` | a simulated provider failure records `FAILED`, doesn't clear `needsResponse` |
| Messaging: delivery status callbacks | `phase4-ingestion-verification.js` | non-`INBOUND` payloads update the matching message's status |
| Messaging: template send | `phase10-templates-verification.js` | variable substitution, `APPROVED`-only gate |
| Messaging: media send + inbound media | `phase11-quick-replies-media-verification.js` | both directions, `Message_Media` records |
| CRM: stage, remark, reminder, snooze | `phase8-crm-lite-verification.js`, `phase9-reminders-verification.js` | |
| CRM: assignment history | `phase7-assignment-verification.js` | |
| Direct unauthorized API calls rejected server-side | every suite (spot-checked per endpoint) + `authorization-sweep-verification.js` (systematic, all 68 endpoints) | see below |

### The authorization sweep, and the bug it found

`tests/authorization-sweep-verification.js` is a static-analysis check, not a runtime
test — it parses every `src/Phase*Endpoints.gs` file to build the complete public
endpoint inventory, then parses each corresponding `src/Phase*Services.gs` method body
to confirm it references `this.access_` (directly, via a private helper that does, or
via a delegated `PhaseNApi` instance — e.g. Phase 13 composing Phase 5). It exists
because a Phase 16 QA audit found a real, confirmed gap this way:
**`Phase8Api.getCustomerStage(customerId)` had no authorization check at all** — any
signed-in Google account, even one with no `Users` record, could read any customer's
lead stage by calling it directly (not just through the UI, which happened to only
ever call it for a customer the caller could already see). Fixed to require ADMIN or
the same viewable-conversation relationship `setCustomerStage` already enforced (see
`memory/DECISIONS.md`, `src/Phase8Services.gs`). The sweep is a regression guard
against this specific class of mistake recurring on a future endpoint; it complements,
not replaces, the runtime authorization tests above.

### Known testing limitation: true concurrency

`LockService.getScriptLock()` is mocked as a no-op in every suite (`waitLock: () =>
{}, releaseLock: () => {}`) — Node's single-threaded execution model can't reproduce
real contention between two simultaneous Apps Script executions. What *is* tested is
the observable behavior the lock exists to guarantee (two sequential new leads land on
two different agents, the rotation pointer advances correctly) — the actual mutual
exclusion under real concurrent webhook calls can only be verified live, against the
real Apps Script runtime, which no phase has done. This is a standing limitation, not
a gap introduced by Phase 16.

### Post-Phase-18 additions

`tests/phase6-reply-verification.js` gained coverage for `resolveConversation`
(assigned AGENT/ADMIN allowed, others denied). `tests/phase5-inbox-verification.js`
gained coverage for a resolved conversation leaving `listConversations()` but still
appearing in `listConversationsAllStatuses()`. `tests/phase13-search-notifications-verification.js`
gained coverage for the same default-excludes-CLOSED-unless-requested behavior in
search. `tests/phase14-dashboard-verification.js` gained a scoped-user scenario
(a SUPERVISOR granted access to a number with zero data sees an empty dashboard even
though the org has real data elsewhere). `tests/workspace-verification.js` (new)
covers `WorkspaceApi.getConversationWorkspace`'s aggregation and its per-field
hide-on-denied behavior for a role with partial access.
