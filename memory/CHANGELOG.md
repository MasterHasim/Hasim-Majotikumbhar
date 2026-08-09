# Changelog

## 2026-08-08
- Created initial project foundation.
- Created memory and documentation structure.
- Added baseline Git / CLASP project files.
- Implemented Phase 1 access-control foundation: authentication context, users, roles, teams and team members, number access, availability, eligibility, repositories, audit logging, and central authorization.
- Verified and enforced the approved fixed five-role Phase 1 permission matrix, including team scope, explicit number grants, eligibility, availability, and server-side authorization contracts.

## 2026-08-09
- Consolidated the master 21-phase roadmap into `docs/ROADMAP.md` (Phase 0 Foundation through Phase 21 Handover), superseding the earlier coarser phase numbering. Phase 2 is now the Core Database/Repository Layer; WhatsApp/Exotel integration moves to Phase 3.
- Configured `appsscript.json` with `executionApi.access = MYSELF` and explicit `oauthScopes` (`script.storage`, `userinfo.email`) so the Apps Script API can execute administrative functions.
- Created deployment `phase1-bootstrap-execution-api` (`AKfycbxFvVo9BtvKtP-GWT_626AH0JACKGHweKKezoBriHZ4N6tz0PeEfcjgZhmAESVsmn0nOQ`), separate from the existing `Test_V01` web app deployment.
- Executed `bootstrapPhase1({email: 'hasim@echt.co.in', displayName: 'Hasim'})` exactly once, via a temporary Apps Script editor-run wrapper (`src/Phase1BootstrapTemp.gs`, deleted immediately after use) — `clasp run` / Execution API could not authorize because the script is bound to Apps Script's auto-managed default GCP project rather than a standard one.
- Verified: Hasim is `ACTIVE` `ADMIN` (`user_68a11404-202f-4109-b52a-ead4c83e98b5`), all five fixed roles created, and the audit log contains `phase1.bootstrapped` plus the prior `authentication.denied` / `UNKNOWN_USER` entries from pre-bootstrap test calls.
- **Phase 1 is now operationally verified end-to-end.** Phase 2 (Core Database/Repository Layer) is next per `docs/ROADMAP.md`.
- Discovered an undocumented deployment `Test_V02` (`AKfycbxbvO6FMXsaRJHHDoPZFsGZVeHv0xRm1CloaBLwKpsvayXgVOtNoPhRek04Z8o4tBWpgg`) not recorded in any prior project memory — origin unconfirmed, flagged for owner review.
- Implemented Phase 2 Core Database/Repository Layer: `SheetRepository` (`src/Phase2Repository.gs`), a second persistence adapter backed by Google Sheets, conforming to the same repository contract as `PropertiesRepository`. Added eleven concrete repositories (`src/Phase2Repositories.gs`) covering `WhatsApp_Numbers`, `Number_Assignment_Config`/`Number_Assignment_Users` (via `AccessRepository`), `Customers`, `Conversations`, `Conversation_Assignments`, `Messages`, `Remarks`, `Reminders`, `Lead_Stages`, `WhatsApp_Templates`, and `Quick_Replies`, with column schemas in `src/Phase2Domain.gs` and contracts documented in `docs/DATABASE.md` and `data/schemas/phase2-contracts.json`.
- Verified with `tests/phase2-repository-verification.js` (Node-mocked `SpreadsheetApp`): CRUD round-trip, header auto-creation, `CONFLICT`/`NOT_FOUND` errors, and `CONFIGURATION_ERROR` when `wap.phase2.spreadsheetId` is unset. `tests/phase1-role-verification.js` still passes — Phase 1 files untouched.
- **Phase 2 ships storage and schema contracts only** — no services, no public endpoints, no real spreadsheet provisioned, no live Apps Script execution. Phase 3 (WhatsApp Numbers & Exotel Integration) is next, and is expected to provision the real spreadsheet.
