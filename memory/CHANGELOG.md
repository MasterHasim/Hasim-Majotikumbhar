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
