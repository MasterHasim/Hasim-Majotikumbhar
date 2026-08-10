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

| Panel entity | Panel source | Zoho module (assumed) | Zoho field(s) (assumed) | Direction |
| --- | --- | --- | --- | --- |
| Customer | `Customers` (`CustomerRepository`) | Lead or Contact (see open question below) | `Last_Name`/`Company` (from `name`), `Phone` (from `phone`), `Email`, `Lead_Source`/`Source` (from `source`) | Panel → Zoho (create/update on first sync); Zoho → Panel only if you want inbound enrichment (not required) |
| Company | `Customers.company` | `Account` (if Contact-based) or `Company` field (if Lead-based) | `Account_Name` | Panel → Zoho |
| Lead Stage | `Customer_Stage` + `Lead_Stages` (Phase 8) | `Lead_Status` (if Lead) or a Deal's `Stage` (if Deal-based) | depends on which Zoho object the customer maps to | Panel → Zoho initially; bidirectional later per the roadmap ("Stage sync is eventually bidirectional with a configurable mapping") — **not attempted in Phase 19's first pass** |
| Assigned User | `Conversations.assignedUserId` | `Owner` (standard Zoho ownership field on every module) | `Owner` | Panel → Zoho |
| Reminder | `Reminders` (Phase 9) | `Tasks` module | `Subject` (from `text`), `Due_Date` (from `dueAt`), `Status` (from `status`), `What_Id`/`Who_Id` (linked to the Zoho Lead/Contact) | Panel → Zoho |
| Remark | `Remarks` (Phase 8) | `Notes` (Zoho's generic notes-on-a-record feature) | `Note_Content` (from `text`), attached to the Lead/Contact record | Panel → Zoho |
| Conversation | `Conversations` | No standard Zoho module fits well — likely a related/custom record or just represented implicitly via its Remarks/Tasks | `Note_Content` summary, or a custom module if you want full conversation history in Zoho | Panel → Zoho, lowest priority |
| WhatsApp Number | `WhatsApp_Numbers` | A custom field on Lead/Contact (e.g. `WhatsApp_Number_Used`) | custom field, needs to be created in your Zoho org first | Panel → Zoho |

## Open questions only you can answer

1. **Lead vs. Contact**: does a new WhatsApp customer become a Zoho **Lead** (Zoho's
   pre-qualification object, later "converted" to Contact+Account+Deal) or go straight
   to **Contact**? This is a fundamental modeling decision your sales process already
   has an answer to — it changes nearly every row in the table above.
2. **Does "Won" mean a Zoho Lead conversion, or a Deal reaching a won stage?** Phase 8's
   `Lead_Stages` includes a `won` key (used by Phase 14's lead-conversion metric) — how
   that maps to Zoho's own conversion/stage model depends on question 1.
3. **Match/dedupe key**: the roadmap says "Zoho lookup → exists? update/link : create."
   What field is the reliable match key — phone number (most likely, given this is a
   WhatsApp-first system) or email (often missing for WhatsApp leads)? Phone-number
   formatting differences (the same `+91`/leading-zero/dash inconsistency Phase 4 had
   to solve for Exotel, see `normalizePhoneTail_` in `src/Phase4Services.gs`) will need
   the same normalization discipline on the Zoho side.
4. **Which Zoho edition/API version**, and does your org use custom modules or
   renamed standard fields? This determines whether the table above is usable as-is or
   needs real adjustment — same category of correction Exotel's integration needed
   after `getTemplates()` was first live-tested.
5. **Sync direction and conflict resolution**: if a field is ever edited in both
   places (e.g., stage changed in the panel AND in Zoho before a sync runs), which
   wins? The roadmap only commits to this being "eventually bidirectional... with a
   configurable mapping" — the first pass should probably stay one-directional
   (panel → Zoho) to sidestep this entirely, and that's the recommendation here, but
   it's your call.

## What Phase 19 will need from you before it can start

- A Zoho API console app / OAuth client (client ID + secret), scoped to whichever
  modules the answers above land on.
- Answers to the five questions above.
- A non-production Zoho org or sandbox to test against first, if available — same
  live-verify-and-fix discipline this project has used for every other external
  integration (Exotel's request/response shapes were wrong on the first guess more
  than once; Zoho's will be too).

Nothing above blocks any other phase — this document exists so that Phase 19, whenever
it starts, begins from an already-thought-through mapping instead of guessing from
scratch under time pressure.
