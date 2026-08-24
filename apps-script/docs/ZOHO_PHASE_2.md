# ZOHO_PHASE_2

Preparation only — this document establishes the mapping and integration boundary
before any connection to Zoho is built. Per the roadmap's Phase 18 scope, nothing here
is implemented yet: no Zoho API calls, no credentials, no sync code. That's Phase 19,
and it's blocked on you providing real Zoho credentials/org access (see `PROGRESS.md`).

**Everything module/field-name-specific below is best-effort**, based on Zoho CRM's
standard/default module structure — not verified against your actual Zoho org, which
may use custom modules, renamed fields, or a different edition (Zoho CRM's field/module
names are also customizable per-org). Treat this the same way `ExotelProvider`'s
still-unverified request shapes were treated in Phases 3–11: a documented starting
assumption, to be corrected once there's real API access to check it against — not a
finished contract.

## Non-negotiable architecture rule

**The panel remains operationally independent**: `WhatsApp ↔ WhatsApp Panel ↔ Zoho`,
never `WhatsApp → Zoho → Panel`. Zoho is a downstream consumer of this panel's data,
not a dependency in the live messaging path — a Zoho outage must never block an agent
from receiving or replying to a WhatsApp message. Any sync code (Phase 19) needs to be
async/best-effort/non-blocking relative to the message-handling paths already built in
Phases 4 and 6.

## Entity mapping

| Panel entity | Panel source | Zoho module (adopted) | Zoho field(s) (assumed) | Direction |
| --- | --- | --- | --- | --- |
| Customer | `Customers` (`CustomerRepository`) | **Lead** (see decision #1 below) | `Last_Name`/`Company` (from `name`), `Phone` (from `phone`), `Email`, `Lead_Source`/`Source` (from `source`) | Panel → Zoho (create/update on first sync); Zoho → Panel only if you want inbound enrichment (not required) |
| Company | `Customers.company` | `Company` field on the Lead | `Company` | Panel → Zoho |
| Lead Stage | `Customer_Stage` + `Lead_Stages` (Phase 8) | `Lead_Status` (pre-conversion); Deal `Stage` post-conversion (see decision #2) | depends on which side of conversion the record is on | Panel → Zoho initially; bidirectional later per the roadmap ("Stage sync is eventually bidirectional with a configurable mapping") — **not attempted in Phase 19's first pass** |
| Assigned User | `Conversations.assignedUserId` | `Owner` (standard Zoho ownership field on every module) | `Owner` | Panel → Zoho |
| Reminder | `Reminders` (Phase 9) | `Tasks` module | `Subject` (from `text`), `Due_Date` (from `dueAt`), `Status` (from `status`), `What_Id`/`Who_Id` (linked to the Zoho Lead/Contact) | Panel → Zoho |
| Remark | `Remarks` (Phase 8) | `Notes` (Zoho's generic notes-on-a-record feature) | `Note_Content` (from `text`), attached to the Lead/Contact record | Panel → Zoho |
| Conversation | `Conversations` | No standard Zoho module fits well — likely a related/custom record or just represented implicitly via its Remarks/Tasks | `Note_Content` summary, or a custom module if you want full conversation history in Zoho | Panel → Zoho, lowest priority |
| WhatsApp Number | `WhatsApp_Numbers` | A custom field on Lead/Contact (e.g. `WhatsApp_Number_Used`) | custom field, needs to be created in your Zoho org first | Panel → Zoho |

## Decisions (adopted 2026-08-24)

Four of the five original open questions were genuinely design calls, not facts only
the account owner could look up — reasoned through and decided below so Phase 19 has
a real starting point instead of sitting fully blocked. All four are reversible: none
of Phase 19's future code is built yet, so changing course later is a design
discussion, not a migration.

1. **Lead vs. Contact → Lead.** A WhatsApp inbound message (from an ad, or organic) is
   an unqualified contact, not a vetted customer — that's exactly Zoho's Lead object,
   and it matches the panel's own terminology (this system already calls the entity a
   "Lead" in Phase 22, with locations/stages before anything resembling "won"). Contact
   would be the right call only if every WhatsApp inbound were already a confirmed
   customer relationship, which isn't how this panel treats them (see `Lead.status`
   progressing through `NEW`/`ASSIGNED`/etc. in `webapp/backend/src/domain/types.ts`).
2. **"Won" → Zoho Lead conversion.** Following from #1: the panel's `Lead_Stages.won`
   stage should trigger Zoho's Lead Conversion API (Lead → Contact + Account,
   optionally + Deal). If a Deal is created on conversion, a Deal later reaching a
   "Closed Won" stage is additional signal, not required for the panel's own `won`
   flag to sync — the conversion event itself is the trigger.
3. **Match/dedupe key → phone number.** Confirmed as the right call, not just the
   likely one: this is a WhatsApp-first system where email is frequently absent, and
   phone number is the one field guaranteed to exist on every Customer record. Reuses
   the exact same tail-normalization discipline as `normalizePhoneTail` (the webapp's
   TypeScript port of the original `normalizePhoneTail_`, used for both Exotel/WhatsApp
   number matching and the Customer↔Lead phone-tail heuristic) — no new logic needed,
   just applying the existing pattern to the Zoho lookup too.
5. **Sync direction → one-directional, panel → Zoho, for the first pass.** Confirmed:
   this was already the document's own recommendation, and it fully sidesteps conflict
   resolution rather than half-solving it. Revisit only if a real workflow need for
   editing in Zoho first ever comes up.

## What's still genuinely unanswerable without your Zoho account (question 4)

**Which Zoho edition/API version, and whether your org uses custom modules or renamed
standard fields** cannot be decided by reasoning the way 1/2/3/5 could — it's a fact
about your actual Zoho org, not a design choice, and there is no Zoho access available
to check it against right now. The entity mapping table above stays a **documented
starting assumption** (Zoho CRM's standard/default module structure, e.g. standard
`Leads`/`Contacts`/`Accounts`/`Deals`, current stable REST API version) — treated the
same way `ExotelProvider`'s request/response shapes were treated before the first real
webhook arrived: correct it against Phase 19's first real API call, not before.

## What Phase 19 still needs from you before it can start

- A Zoho API console app / OAuth client (client ID + secret), scoped to Leads/Contacts/
  Accounts/Deals/Tasks/Notes per the decisions above.
- A non-production Zoho org or sandbox to test against first, if available — same
  live-verify-and-fix discipline this project has used for every other external
  integration (Exotel's request/response shapes were wrong on the first guess more
  than once; Zoho's will be too).
- A sanity check on decisions #1/#2 above against your actual sales process, since
  they were reasoned from how this panel already models Leads, not from your Zoho
  org's real configuration — flag it if either doesn't match how your team actually
  works Zoho today.

Nothing above blocks any other phase — this document exists so that Phase 19, whenever
it starts, begins from an already-thought-through mapping instead of guessing from
scratch under time pressure.
