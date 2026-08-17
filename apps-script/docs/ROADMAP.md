# WhatsApp Multi-Number CRM — Master Phase Index

Consolidated 2026-08-09. This supersedes the coarser phase numbering used in earlier
context notes (previously "Phase 2" meant WhatsApp/Exotel integration directly; it now
means the Core Database/Repository Layer, pushing integration to Phase 3 and onward).

Do not build phases out of order. Do not implement a future phase's functionality while
working on an earlier one.

```
PHASE 0  — Project Foundation & Architecture          STATUS: DONE
PHASE 1  — Authentication, Users & Authorization       STATUS: DONE (bootstrap executed 2026-08-09)
PHASE 2  — Core Database / Repository Layer            STATUS: NOT STARTED (next)
PHASE 3  — WhatsApp Numbers & Exotel Integration
PHASE 4  — Webhook & Message Ingestion
PHASE 5  — Conversations & Inbox
PHASE 6  — Agent Reply / Outbound Messaging
PHASE 7  — Assignment & Round-Robin Engine
PHASE 8  — CRM-lite: Customers, Stages, Remarks
PHASE 9  — Reminders, Snooze & Follow-up
PHASE 10 — WhatsApp Templates
PHASE 11 — Quick Replies & Media
PHASE 12 — Admin Panel & Configuration
PHASE 13 — Notifications, Search & Productivity
PHASE 14 — Dashboard & Analytics
PHASE 15 — Audit, Security, Backup & Reliability
PHASE 16 — Testing & QA
PHASE 17 — Production Deployment
PHASE 18 — Zoho Integration Preparation
PHASE 19 — Zoho CRM Integration
PHASE 20 — Production Hardening & Optimization
PHASE 21 — Final Documentation & Handover
```

Dependency chain: each phase depends on all prior phases being complete. Phase 3 must
not begin until Phase 2's repository abstraction exists; Phase 4 must not begin until
Phase 3's `WhatsAppProvider` abstraction exists; and so on down the chain.

## PHASE 0 — Project Foundation & Architecture (DONE)

`C:\DP\Whats App Panel` with `src/`, `frontend/`, `config/`, `data/`, `memory/`, `docs/`,
`tests/`; Git, CLASP, Apps Script project, project memory, architecture/database docs.

Source flow: GitHub (source of truth) → CLASP → Apps Script → Google Sheets (app data).

## PHASE 1 — Authentication, Users & Authorization (DONE)

Roles: `ADMIN`, `SUPERVISOR`, `SITE_MANAGER`, `AGENT`, `VIEWER`.
User lifecycle: `ACTIVE`, `INACTIVE`, `SUSPENDED`. Availability: `AVAILABLE`, `BUSY`,
`OFFLINE`, `ON_LEAVE`. Expected org: 1 Admin, 1 Supervisor, 4–6 Site Managers, ~15 Agents.
`Teams` / `Team_Members` scope Supervisor and Site Manager visibility.

Independent access concepts (must never be conflated):
- Can access number? (`User_Number_Access`)
- Can receive automatic assignments? (assignment eligibility)
- Is currently available? (availability)

Central authorization lives in `AccessControl` (`src/Phase1AccessControl.gs`). A user must
never gain access merely by manipulating the frontend or URL — backend authorization is
mandatory for every sensitive operation.

Bootstrap: `bootstrapPhase1({email: 'hasim@echt.co.in', displayName: 'Hasim'})` — executed
exactly once on 2026-08-09. See `memory/CHANGELOG.md` and `memory/DECISIONS.md` for the
execution method and verification.

## PHASE 2 — Core Database / Repository Layer (NEXT)

Core entities: `Users`, `Teams`, `Team_Members`, `WhatsApp_Numbers`, `User_Number_Access`,
`Number_Assignment_Config`, `Number_Assignment_Users`, `Customers`, `Conversations`,
`Conversation_Assignments`, `Messages`, `Remarks`, `Reminders`, `Lead_Stages`,
`WhatsApp_Templates`, `Quick_Replies`, `Audit_Log`.

Do not scatter `SpreadsheetApp.openById(...)` through the application. Use repository
classes: `UserRepository`, `TeamRepository`, `NumberRepository`, `AccessRepository`,
`CustomerRepository`, `ConversationRepository`, `MessageRepository`, `AssignmentRepository`,
`RemarkRepository`, `ReminderRepository`, `StageRepository`, `TemplateRepository`,
`AuditRepository`.

Architecture: `UI → Service → Repository → Google Sheets` (later: `→ Database`, without
rewriting the application). Phase 1's `PropertiesRepository` remains a low-volume
administrative-data adapter only — it is not the Phase 2 repository layer.

## PHASE 3 — WhatsApp Numbers & Exotel Integration

Existing infra: 10 numbers, multiple WABAs, Exotel API access, existing Meta Business
Portfolio and credentials.

| # | Brand / Number |
|---|---|
| 1 | Entartica - Ho — 079-485-02801 |
| 2 | Entartica - Ho — 079-485-02802 |
| 3 | Marine — 079-485-02803 |
| 4 | Entartica - Raipur — 079-485-02804 |
| 5 | Entartica - Rajsamand — 079-485-02805 |
| 6 | Entartica - Prayagraj — 079-485-02806 |
| 7 | Spreewalk - Saraighat — 079-485-02807 |
| 8 | Spreewalk - Raipur — 079-485-02808 |
| 9 | ECHT Advisory — 079-485-02809 |
| 10 | Compliances — 079-485-02810 |

Do not hard-code Exotel throughout the application. Create a `WhatsAppProvider`
abstraction (`sendText`, `sendMedia`, `sendTemplate`, `getTemplates`, `createTemplate`,
`getMessageStatus`, `processWebhook`) with `ExotelProvider` as the first implementation,
leaving the architecture open for a direct Meta Cloud API provider later.

Each number needs: `number_id`, `display_name`, `phone_number`, `provider`,
`provider_account_id`, `waba_id`, `provider_number_id`, `active`. Credentials must never
be committed to Git.

## PHASE 4 — Webhook & Message Ingestion

Flow: WhatsApp Customer → Exotel → Webhook → Apps Script → identify number → identify
customer → find/create conversation → store message → update conversation → assignment.

Critical: every inbound message must be deduplicated on the provider/message ID
(idempotency) to survive webhook retries. The webhook handler itself must stay fast:
validate → store → update → respond. Heavy processing does not belong in the webhook path.

## PHASE 5 — Conversations & Inbox

Three-pane layout: Numbers | Conversations | Customer detail (customer info, stage,
assigned agent, reminder, remarks). Admin can select any of the 10 numbers; an agent sees
only numbers assigned to them (e.g. Rahul sees exactly "Sales 1" and "Support 1").

Conversation view shows: customer, phone, number, assigned agent, messages, timestamps,
direction, internal notes, stage, reminder, status.

## PHASE 6 — Agent Reply / Outbound Messaging

Flow: Agent → type message → access validation → conversation validation → number
validation → Exotel → WhatsApp → customer.

Every outbound message records: `message_id`, `conversation_id`, `number_id`,
`sender_user_id`, `direction = OUTBOUND`, `message_type`, `message_text`,
`provider_message_id`, `status`, `timestamp` — so Admin can see "Rahul replied at 2:41 PM,"
not just "Agent replied." Track delivery status where the provider supports it: `SENT`,
`DELIVERED`, `READ`, `FAILED`.

## PHASE 7 — Assignment & Round-Robin Engine

Confirmed rule: round robin + availability + working hours.

A **new lead** is a completely new/unknown phone number contacting the business for the
first time. An **existing customer** retains their current owner unless manually
reassigned — a conversation must never bounce between agents on every incoming message.

Assignment flow: new customer → identify number → round robin enabled? → get eligible
users → check number access + assignment eligibility + active status + availability +
working hours → round robin → assign. Example rotation (Rahul, Priya, Amit, Neha):
lead 1→Rahul, 2→Priya, 3→Amit, 4→Neha, 5→Rahul. Inactive/outside-hours/ineligible users
are skipped; if nobody is available the lead goes to an **unassigned queue**. Every
assignment/reassignment is recorded in history.

Concurrency: round-robin state updates must use Apps Script `LockService` (lock → read
pointer → select agent → update pointer → release) so two simultaneous leads can never
land on the same agent.

## PHASE 8 — CRM-lite: Customers, Stages, Remarks

Customer record: `customer_id`, `phone`, `name`, `email`, `company`, `source`.

Lead stages are admin-configurable, not hard-coded into application logic. Initial set:
New, Contacted, Interested, Quotation Sent, Negotiation, Won, Lost.

Remarks are internal notes, separate from customer messages, and must never be sent to
WhatsApp. Number access and conversation ownership remain separate concepts.

## PHASE 9 — Reminders, Snooze & Follow-up

Reminders: text, due date/time, owner; statuses `PENDING`, `COMPLETED`, `CANCELLED`.
Snooze is distinct from a reminder — it removes a conversation from the active queue
until a given time, then returns it. Dashboard eventually surfaces Due Today / Overdue /
Upcoming.

## PHASE 10 — WhatsApp Templates

Workflow: Create Draft → Save Draft → Admin Review → Submit → Pending → Approved/Rejected.
Statuses: `LOCAL_DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `PAUSED`, `DISABLED`.

Fields: `template_id`, `waba_id`, `provider_template_id`, `name`, `language`, `category`,
`status`, `components`, `variables`, `created_at`, `updated_at`, `last_synced_at`.

Agent sending flow: Chat → Templates → select template → enter variables → preview → send.

## PHASE 11 — Quick Replies & Media

Quick replies (e.g. `/hello`, `/gst`, `/quotation`, `/payment`) are internal agent
shortcuts, distinct from Meta-approved templates. Message schema must support media types
beyond text: `IMAGE`, `DOCUMENT`, `AUDIO`, `VIDEO`, `LOCATION`, `CONTACT`, `TEXT`.

## PHASE 12 — Admin Panel & Configuration

Sections: Dashboard, Users, Teams, WhatsApp Numbers, Number Access, Assignment Rules,
Conversations, Lead Stages, Reminders, Templates, Quick Replies, Audit Logs, Settings.

Per number: name, brand, active flag, users with access, round-robin on/off, assignment
users/sequence/fallback, working hours. Per user: number checkboxes plus a **separate**
"can receive leads" (assignment eligibility) checkbox distinct from "can access number."

## PHASE 13 — Notifications, Search & Productivity

Search across customer name, phone, conversation, message; filters by number, agent,
stage, status, unread, needs-response, unassigned, date.

Confirmed rule: a conversation stays `needs_response = TRUE` until an agent actually
replies — opening/reading the conversation does **not** clear it. This is stronger than a
simple browser "read" flag.

## PHASE 14 — Dashboard & Analytics

Basic metrics: new/open/unassigned/needs-response/pending/resolved conversations, per
agent and per number. Later: first response time, average response time, resolution
time, lead conversion, stage distribution, template usage, agent workload.

## PHASE 15 — Audit, Security, Backup & Reliability

Minimum audited events: `LOGIN`, `LOGOUT`, `SEND_MESSAGE`, `ASSIGN_CONVERSATION`,
`REASSIGN_CONVERSATION`, `CHANGE_STAGE`, `ADD_REMARK`, `ADD_REMINDER`,
`COMPLETE_REMINDER`, `CREATE_TEMPLATE`, `UPDATE_TEMPLATE`, `SYNC_TEMPLATES`,
`CREATE_USER`, `DISABLE_USER`, `ASSIGN_NUMBER`, `REMOVE_NUMBER`.

Secrets are never committed to Git, Sheet cells, source code, or frontend code — use
secure configuration only. Application data needs scheduled backup/export capability.

## PHASE 16 — Testing & QA

Systematic coverage before production: authentication (all five roles + unknown/inactive),
access (authorized vs. unauthorized number/team access), round-robin (normal sequence,
inactive/busy/outside-hours users, reassignment, concurrent leads), messaging (inbound,
outbound, duplicate webhook, failed message, delivery status, template, media), CRM
(stage, remark, reminder, snooze, assignment), and direct unauthorized API calls (must be
rejected server-side).

## PHASE 17 — Production Deployment

GitHub (validated commit) → CLASP → Apps Script deployment. Set production spreadsheet,
production secrets, Exotel credentials, webhook config, allowed users/domain, timezone.
Configure Exotel → Apps Script production webhook endpoint. Maintain application logs,
webhook errors, API errors, failed messages, assignment failures.

## PHASE 18 — Zoho Integration Preparation

Establish the mapping before connecting anything:

| Panel | Future Zoho |
|---|---|
| Customer | Contact / Lead |
| Company | Account |
| Lead Stage | Lead/Deal Stage |
| Assigned User | Owner |
| Reminder | Task |
| Remark | Note |
| Conversation | Related/custom record |
| WhatsApp Number | Custom field |

The panel remains operationally independent: `WhatsApp ↔ WhatsApp Panel ↔ Zoho`, never
`WhatsApp → Zoho → Panel`.

## PHASE 19 — Zoho CRM Integration

Customer sync: new customer → panel → Zoho lookup → exists? update/link : create.
Map name/phone/email/company/source/owner/stage/WhatsApp number for
lead/contact sync. Map reminder → Zoho Task, remark → Zoho Note. Stage sync is eventually
bidirectional with a configurable mapping.

## PHASE 20 — Production Hardening & Optimization

After real usage: measure Apps Script execution time, Sheet read/write volume, webhook
latency, Exotel API latency, concurrent users, message volume — then optimize. Potential
future evolution: Google Sheets → repository abstraction → real database, without
rewriting frontend/business logic.

## PHASE 22 — Location Leads Upload, Assignment Rules & Exotel Click-to-Call (added 2026-08-17)

Added on top of the already-"done" 21-phase roadmap, user-directed — a second, independent
assignment workflow alongside Phase 7's per-WhatsApp-number round robin. Admins upload a
spreadsheet of call leads (`name`, `phone`, `location`) for six fixed locations (Raipur,
Rajsamand, Coimbatore, Prayagraj, Alibaug, Saraighat); each lead auto-assigns to a site
agent per a per-location rule: `single` (always the same agent), `round_robin` (rotates
through an ordered pool, same locking/self-healing rotation as Phase 7's engine), or
`manual` (admin assigns by hand). Leads are their own `Leads` tab, deliberately not
merged into `Customers` — a call lead is not a WhatsApp conversation, and two of the six
locations (Coimbatore, Alibaug) don't correspond to any existing WhatsApp number.

New entities: `Leads`, `Location_Assignment_Config`, `Location_Assignment_Users`,
`Call_Log` (schemas live in `Phase2Schemas`, `src/Phase2Domain.gs`, per that file's own
established convention for later-phase tabs). New permissions: `LEADS_MANAGE` (ADMIN +
SITE_MANAGER), `LEADS_VIEW_ASSIGNED` / `LEADS_CALL` (AGENT). Users gained an optional
`phone` field for click-to-call.

Click-to-call: `ExotelVoiceProvider` (`src/Phase22ExotelVoice.gs`) rings the agent's own
phone first, then connects to the lead via Exotel's Voice API — a separate product/domain
(`api.exotel.com`) and separate Script Properties from the existing WhatsApp
`ExotelProvider`. Flagged UNVERIFIED pending a real test call, same convention as Phase
3's own still-unverified methods.

See `memory/DECISIONS.md` (2026-08-17 entries) and `memory/CHANGELOG.md` for full detail.

## PHASE 21 — Final Documentation & Handover

Final `docs/`: `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API.md`,
`WEBHOOK.md`, `SECURITY.md`, `ROUND_ROBIN.md`, `TEMPLATES.md`, `UI_SPECIFICATION.md`,
`DEPLOYMENT.md`, `TROUBLESHOOTING.md`, `ZOHO_PHASE_2.md`. Final `memory/`:
`PROJECT_MEMORY.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `CHANGELOG.md`,
`CODEX_CONTEXT.md`. Must explain: local run, CLASP deployment, Apps Script config,
Exotel config, number config, user creation, round-robin mechanics, template workflow,
backups, webhook troubleshooting, Zoho integration, and how to safely modify the system.

## Cross-cutting rules (apply to every phase)

1. **Centralized authorization** — all sensitive operations go through `AccessControl`.
2. **Server-side enforcement** — never trust the frontend for security decisions.
3. **New lead vs. existing customer** — a new lead is a completely unknown phone number;
   existing customers keep their owner unless explicitly reassigned.
4. **`needs_response`** — cleared only by an actual agent reply, never by opening the chat.
5. **Number access ≠ conversation ownership** — keep these separate everywhere.
6. **Provider abstraction** — no hard-coded Exotel calls in business logic; go through
   `WhatsAppProvider`.
7. **Repository abstraction** — no scattered `SpreadsheetApp` calls; go through
   repositories.
8. **Webhook idempotency** — dedupe on provider/event ID.
9. **Round-robin locking** — use Apps Script `LockService` around round-robin state.
10. **Template workflow** — Create Draft → Admin Review → Submit → Pending →
    Approved/Rejected.
11. **No secrets in Git**, source, frontend, or plain data sheets.
12. **Do not redesign previously approved architecture** (database schema, authentication,
    authorization, Exotel integration, round robin, template handling, Zoho mapping)
    without first documenting the proposed change in `memory/DECISIONS.md` and getting
    approval.

## Per-phase execution model

For every phase: read `memory/`, read relevant `docs/`, inspect existing code, identify
dependencies, implement only that phase, write/update tests, run tests, update
documentation, update `memory/CHANGELOG.md`, report changed files, prepare a clean commit.
Do not implement future phases prematurely.
