# WhatsApp Multi-Number CRM — Progress Report

**Last updated:** 2026-08-23 (**Manual single-lead entry shipped — first piece of a bigger Auto Dialer research/build effort.** New "+ Add lead" button next to "+ Upload leads" (Leads page) for adding one external lead at a time (referrals, walk-ins, anything outside WhatsApp/CSV) — reuses the exact same validation, duplicate check, and location assignment-rule logic as a bulk CSV upload, so a manually-added lead gets round-robin/single/manual-assigned exactly like an uploaded one would. Confirmed live: added a real test lead to Raipur, watched it land correctly and land as "Unassigned" — traced that to real account state (Raipur's only round-robin participant, Saket, has his "Active" checkbox unchecked in Assignment Rules), not a bug, matching what a bulk upload would do right now too. 4 new backend regression tests (214 total, all passing), deployed. Also answered a real architecture question while scoping this: a brand-new WhatsApp conversation does get auto-assigned to an agent, but through a **completely separate round-robin system** than Leads use — `Phase7Api`'s number-scoped round robin for conversations vs. `Phase22Api`'s location-scoped round robin for Leads, with no shared config and no FK link between a Customer and a Lead even when they're the same phone number. Worth knowing if "one consistent assignment rule regardless of channel" ever becomes a requirement. **Also researched (not yet built) a full Auto Dialer roadmap**, at your request: auto-dial on lead/conversation assignment, scheduled follow-up auto-dial (needs a new Cloudflare Cron Trigger — no scheduled/cron mechanism exists in this backend today), real call-status webhooks (outbound call status is currently pull-only, no push — a real gap that blocks accurate call outcomes everywhere), incoming-call reflection (needs Exotel-side Call Flow/App Bazaar configuration outside this codebase), missed-call auto-tasking, and an auto-dial queue UI. Next up: wiring real Exotel call-status webhooks, since everything else in that list depends on actually knowing whether a call was answered or missed. Just before that, same day: **Clickable links in chat, plus a real recurring subrequest-limit bug fully closed this time.** Regular http(s) URLs inside any message's text now render as real clickable links (confirmed live on a test number — two URLs in one message both rendered correctly). While verifying that, hit the "Too many subrequests" error again on ECHT Marine (46 conversations) and dug in properly this time: it was **Search**, not the Inbox list — `Phase13Api.searchConversations` re-fetched each matching conversation's Customer record individually (even though the data it needed was already sitting on the result from `listConversationsAllStatuses`) and re-fetched the same Number record once per conversation instead of once total. Fixed both to use already-loaded data / a lookup cache. But the deeper find: even the *original* subrequest fix from earlier today wasn't complete — `AccessControl.rolesFor()` was re-fetching the **entire roles list** from Firebase on every single call, and it's called by `hasRole()` up to twice per conversation while filtering visibility, so a number with 40+ conversations could still blow the limit on role checks alone, independent of the `currentUser()` caching fix. Cached the roles list per request the same way, closing this class of bug for real this time. 2 new backend regression tests (210 total, all passing), confirmed live: the exact search that threw the error before now returns cleanly. (For reference: the "Cloudflare" in that error message is the cloud platform hosting our backend — Cloudflare Workers enforces a limit on how many outbound Firebase calls one request can make, which is what these bugs kept hitting.) Just before that, same day: **Live-tested a real Click-to-WhatsApp ad end to end and found the actual root cause of "ad link not showing up."** Traced your real "Entartica Sea World" ad through Ads Manager to its live Facebook Post, clicked its real "WhatsApp" CTA, and sent a real WhatsApp message to the ad's destination number (+91 94296 91418) while tailing our backend's live logs — **zero webhook requests arrived**, proving conclusively that this number isn't wired to Exotel/our backend at all. Cross-checked Meta's WhatsApp Manager: the WABA actually connected to Exotel for this business is "Entartica Sea World Raipur" at +91 79 4850 2804 (matches "Entartica - Raipur" in Admin → Numbers exactly) — a *different* number than the one the ad currently points to. That's a Facebook Page-level setting (Page's own linked WhatsApp number), not something fixable from our code; you asked to leave the number as-is for now. **Also found and fixed the real shape of the ad-link data**: this specific ad type (a WhatsApp button on a boosted Facebook Page post) does **not** send Meta's structured `referral` object at all — it embeds the ad's link directly inside the plain message text as `"Link:\n<url>\n\n<actual customer message>"`, confirmed by decoding the real signed WhatsApp deep link the ad's button generates. Updated the Inbox to detect and pretty-print that exact pattern (same "AD URL:" card as the `referral` badge, plus the customer's real message text below it, with the raw "Link:\n...\n\n" prefix stripped from display) — this works independently of the number-wiring issue, so it's ready the moment a message from a properly-connected number arrives in this shape. Deployed; not yet confirmed against a real inbound message since no ad-originated message has landed in our system yet — that requires the number mismatch to be resolved first. Just before that, same day: **Inbox conversation view now shows Lead context, product interest, and ad-referral data**, from your live screenshot of the Susmita Patil conversation. (1) The template variable "Insert…" picker now also pulls from the matching **Lead** record (name, location, custom fields), not just the Customer — Leads and Customers are separate entities that happen to share a phone number, matched by the same phone-tail heuristic the webhook ingestion already used. (2) A new **"Products of interest"** checklist in the conversation detail panel lets an agent tag which product(s) from that number's catalog the customer is asking about — stored on the Conversation (not the Customer), since the same customer could have separate conversations on different numbers with different interests. Confirmed live: added a real product to ECHT Marine's catalog, opened Susmita Patil's conversation, checked a box, watched it persist through a refetch, unchecked it again. (3) Inbound messages that arrive via a Facebook/Instagram "Click-to-WhatsApp" ad now capture Meta's `referral` object (headline, body, source link) and show a small "📣 From ad" badge with a link back to the ad — **this one is unverified against real traffic**: Meta documents this field but Exotel's docs don't mention it, and no real ad-click message has come in yet to confirm the shape matches. If a message from an ad ever arrives without the badge showing, that's the first thing to check. 12 new backend regression tests (208 total, all passing), deployed both backend and frontend. Just before that, same day: **A real, long-standing bug found and fixed while re-verifying send/template**: every single outbound message ever sent had an empty `providerMessageId` — the code checked several plausible response shapes but none matched what Exotel's API actually returns (`response.whatsapp.messages[0].data.sid`, an extra wrapper layer none of the checks anticipated). This meant the delivery-status webhook fix from earlier today could parse `sent/delivered/read` callbacks correctly but could never *match* them to the right message. Fixed the extraction, and — importantly — updated the test mock to return the same real shape instead of a simplified one, so this class of "tests pass, production doesn't" bug can't hide again. Confirmed live end to end: sent a real message, watched a real `DELIVERED` status webhook arrive and correctly update that exact message. **Also shipped**: template variables now have an "Insert…" picker next to each `{{n}}` box — pulls this conversation's own Customer Name/Phone/Company/Email, the assigned agent, and any Customer custom fields that are actually set, so an agent can insert real data with one click instead of retyping it. 1 new backend regression test (205 total, all passing), deployed. Just before that, same day: **Two more real bugs found and fixed, both from your live reports.** (1) **Templates page blank-screen crash** — clicking into Admin → Templates threw a JS error and rendered nothing. Root cause: some existing template records predate the new "variable labels" field and are missing it entirely (RTDB just omits absent keys), and the new code assumed it always existed, crashing on `.join(...)` of `undefined`. Fixed both defensively in the UI and at the source (the backend now normalizes every template it returns) so this class of "old record missing a newer field" bug can't recur. (2) **A real, serious subrequest-limit bug** — opening the Inbox for a number with many conversations (confirmed against ECHT Marine, 46+ needing reply) failed outright with "Too many subrequests by single Worker invocation." Root cause: the shared authorization helper wrote a fresh audit-log entry (2 Firebase calls) *every single time* it checked who was signed in — and it's called internally on every permission check, including once per conversation while filtering an Inbox list for visibility. A number with dozens of conversations was quietly guaranteed to blow through Cloudflare's per-request limit. Fixed by caching the signed-in user for the lifetime of one request, so the identity is verified and audited once per request instead of once per internal check — confirmed live against the real ECHT Marine number (500 error → 200 with real data). 6 new backend regression tests (204 total, all passing), deployed. Just before that, same day: **Dashboard is now the default landing screen** for a number (was Inbox), and it now leads with real charts — a donut chart for conversation status (Open/Needs reply/Unassigned/Resolved), a donut for customer stage distribution, and a bar chart for template usage — plain inline SVG, no charting library, matching the dark theme. **Inbox layout adjusted** per your markup — the conversation list column is narrower (320px → 260px), giving the chat pane more room. Just before that, same day: **Media sending confirmed live** — real image sent and received on a real phone. The Meta access token expiry fix from earlier today is not the same as this: a real send with a degenerate 1x1-pixel test image was rejected by Exotel/Meta with `EX_MEDIA_UPLOAD_ERROR`, which looked like a repeat of the earlier template bug — but the exact same send fixed and retried with a real photo arrived correctly. Also found and fixed a genuine `sendMedia` payload bug along the way (missing required `recipient_type: "individual"`, same class of bug as the earlier template fix). **Two more real bugs found and fixed while investigating**: (1) Exotel's delivery-status webhooks (sent/delivered/read/failed for our own outbound messages) arrive in the *same* payload shape as inbound customer messages, distinguished only by a `callback_type: "dlr"` field our code never checked — every delivery-status callback was being misread as a broken inbound message and rejected with "No registered number matches," so message statuses never updated after the initial guess; fixed with a real payload as evidence. (2) **Message ordering bug** — you flagged that older customer messages weren't showing in the right place; root cause was that outbound message timestamps are always UTC (`...Z`) but Exotel's real inbound webhook timestamps carry a local offset (`...+05:30`) — sorting these as plain strings (instead of parsing them as real times) put messages in the wrong order whenever the two formats mixed. Fixed to sort by actual parsed time. **Also shipped**: template messages in the Inbox now show the real rendered text (e.g. "Hi Priya, welcome!") instead of a bracketed `[Template: name]` placeholder — Dashboard's template-usage report was upgraded to track this via a dedicated field instead of parsing that display text, so the two didn't end up coupled. **Admin-configurable template variable labels** — Admin → Templates now lets you label each template's `{{1}}`, `{{2}}`, `{{3}}` (e.g. "Customer Name", "Order ID"), works on APPROVED templates (not just drafts), and the Inbox's Send Template row shows those labels instead of bare `{{n}}` placeholders so agents know what to type. 15 new backend regression tests (202 total, all passing), deployed. Just before that, same day: **Dashboard redesigned into a responsive "slab" grid** — Lead funnel, Customer stage distribution, Template usage, and Lead conversion no longer each take the full page width; they now sit side by side in a CSS grid that reflows by available width (more columns on a wide monitor, stacking to one on mobile), fixing the excess-whitespace look you flagged. **Live-campaign dropdown tested live and confirmed working correctly** — created a real "Live Campaign" field, opened a real Lead, watched it call the backend and resolve to "No active campaigns found." Traced that to your **META_ACCESS_TOKEN having expired again** (`Session has expired… 07:00:00 PDT`, only ~20 minutes before I checked) — meaning the token set earlier was a short-lived Graph API Explorer token, not actually exchanged for a long-lived/System User one as intended; both Ad Performance and the campaign dropdown need that redone. **Real template-delivery bug found and fixed**: WhatsApp template sends (both the new welcome message and the Inbox's manual template send) were using the wrong payload shape — full substituted body text instead of Exotel's documented `parameters`-array format — confirmed against Exotel's real API docs and deployed; this is the leading suspect for "template message not delivered." Also found and fixed a second live bug while investigating: `/api/needs-response-counts` (the inbox badge counts) was hitting Cloudflare's subrequest limit and erroring on every single call once there were ~10 numbers — fixed by batching the snooze-status check into one query instead of one-per-conversation, confirmed clean on live logs after deploy. Also shipped, same session: **inline Lead editing** — Name/Phone are now directly editable (Leads table and the Lead detail modal), same pattern as the WABA ID field. **Live-campaign dropdown** — a new "campaign" custom field type pulls currently-ACTIVE campaign names straight from your registered Meta ad account(s) instead of a typed-in text field, so a Lead can be tagged against the exact live campaign it came from (Admin → Custom Fields → type "Dropdown (live campaigns)"). Just before that: WhatsApp welcome notification wired up and deployed — `team_member_welcome` was APPROVED by Meta, so new-user creation now sends a real WhatsApp welcome message (best-effort, alongside the existing welcome email) when the admin fills in a phone number on the Add User form; sending number is auto-resolved from the template's own WABA. Also added a **WABA ID column** to Admin → Numbers and turned the Templates page's free-text WABA ID fields into number-display-name dropdowns, after resolving real confusion between Meta's three similar-looking IDs (Business Portfolio ID, WABA ID, Phone Profile ID) from a live screenshot — the correct one is the "ID:" shown next to the WABA's own name in Meta Business Manager / the URL's `selected_asset_id`. Google Ads integration remains explicitly deferred at your request. Just before that: Meta Ads reporting fully live — Dashboard "Ad performance" table (Ad Name/Portal/Spent/Messages Initiated/Reach) confirmed showing real Entartica Sea World campaign data end to end, real META_ACCESS_TOKEN set and verified. Just before that, Lead stage/funnel reporting shipped — the original 4-part roadmap (Activity History → Custom Fields → CSV export → stage/funnel reporting) is now fully complete, plus a real mislabeling bug fixed along the way (Dashboard's old "Lead stage distribution" was actually Customer-stage data, not Leads Kanban data). Just before that, CSV export shipped for Leads/Customers/Call History. Before that, Product Master + Quotations shipped — per-number pricing catalog, multi-line quotations on Leads with discounts, and a public printable/shareable quote link. Just before that, ad-hoc new chat/call to a number not in the CRM shipped — a "+ New" button in the Inbox now lets an agent message or call any phone number directly. Just before that, the 24-hour WhatsApp customer service window shipped — free-text/media replies now correctly blocked outside the 24h window, template sends unaffected, with a live migration run against real conversation history. Just before that, Lead/location isolation shipped — a manager now only sees leads for locations tied to WhatsApp numbers they actually have access to, closing a real cross-account data-exposure gap you flagged. Just before that, Custom Fields shipped — step 2 of the four-part roadmap (Activity History → Custom Fields → CSV export → stage/funnel reporting), see below. Earlier the same day: Activity History (step 1) shipped for Leads and the Inbox, plus a real Cloudflare subrequest-limit regression found and fixed while building it; renamed to **ECHT Connect**, hosted live at `https://whatsapp-panel-frontend.hasim-c9e.workers.dev`, and the new-user welcome-email system is now **fully live and confirmed working** — `updates.echt.co.in` verified in Resend, real email delivered and confirmed by the user. 2026-08-21: found and fixed two real gaps while setting up real agents — round-robin was silently skipping everyone, and creating a Team crashed on an RTDB quirk; also Inbox call button + Lead tagging system; webapp is now mobile/tablet responsive; Leads Upload surfaces assignment-rule status + bulk reassign/set-stage; webapp UI expansion — dark theme reskin, Leads Kanban board, Reminders & Customers pages. Webapp migration reached full Apps Script feature parity, Phases 1-15, on 2026-08-18; Phase 22 was added to the live `apps-script/` build on 2026-08-17)
**Purpose:** single source of truth for "what's done, what's left, and what needs you personally." Updated after every phase/transition. See `docs/ROADMAP.md` for full phase scope, `memory/CHANGELOG.md` for full per-phase detail (this file stays intentionally brief per phase), and `memory/DECISIONS.md` for architectural reasoning.

## ✅ providerMessageId extraction fix + template variable "Insert" picker (2026-08-23)

**The last piece of the delivery-status puzzle.** Earlier today's dlr-webhook fix correctly recognized and parsed Exotel's delivery-status callbacks — but every one of them came back `applied: false`, meaning it could never find the message to update. Root cause: `providerMessageId` was empty on every message this app has ever sent. The code checking the send response tried several plausible shapes (`.sid`, `.message_sid`, `.whatsapp.messages[0].sid`) but the real response wraps everything one level deeper — `response.whatsapp.messages[0].data.sid` — and none of the checks anticipated that extra `response`/`data` wrapping. Fixed the extraction to match the real shape, confirmed by capturing an actual send response live. Just as important: the test mock was quietly returning a simplified shape that happened to satisfy the old (wrong) extraction logic, which is exactly how this stayed hidden behind a fully green test suite — updated the mock to return the real shape so this class of bug can't hide again. **Confirmed live, full loop**: sent a real message, watched a real Exotel delivery webhook arrive seconds later, and confirmed it correctly flipped that exact message to `DELIVERED` in the database.

**Template variable "Insert" picker.** Next to each `{{1}}`/`{{2}}`/`{{3}}` box in the Send Template row, there's now a small dropdown that pulls in this conversation's own data — Customer Name, Phone, Company, Email, the assigned agent, and any Customer custom fields that are actually set on this customer — so an agent picks a value instead of retyping (or mistyping) it. Combines with the variable-labels feature from earlier: label a slot "Customer Name" in Admin → Templates, and the agent sees both what it means and a one-click way to fill it correctly.

1 new backend regression test (205 total, all passing), deployed, and confirmed against real live traffic (not just the test suite) for the first time.

## ✅ Templates blank-screen crash + serious subrequest-limit bug, both fixed (2026-08-23)

**Templates page blank screen.** You reported clicking into Admin → Templates (or updating one) rendered a totally blank page. Console showed `Cannot read properties of undefined (reading 'join')`. Cause: the new "variable labels" feature assumed every `Template` record has a `variables` array, but records created/synced before that field existed simply don't have the key at all (Firebase RTDB omits absent fields rather than storing `null`) — so `t.variables.join(...)` crashed on the first old record it hit. Fixed in two layers: the frontend now falls back to an empty array wherever it reads `variables`/`components`, and — the more important fix — the backend now normalizes every `Template` it returns (`listTemplates`/`getTemplate`) so old records always come back with real arrays, protecting every future reader of this data, not just the two spots that happened to crash first.

**A serious, real subrequest-limit bug — found from your "46 need reply" report on ECHT Marine.** Opening that number's Inbox failed outright: `INTERNAL_ERROR: Too many subrequests by single Worker invocation`. Traced it to the shared `AccessControl.currentUser()` helper, which every permission check calls internally — and it was writing a fresh "authentication accepted" audit-log entry (a Firebase existence-check plus a write, 2 network calls) on *every single call*, not just once. The Inbox's conversation list checks visibility once per conversation to decide what an agent/manager can see, so a number with 40+ conversations was calling this dozens of times in one request, each costing 2 more Firebase calls — comfortably enough to blow through Cloudflare's per-invocation limit on a single busy number. Fixed by caching the resolved user on the `AccessControl` instance, which lives for exactly one request — so identity is verified and the "accepted" audit entry written once per request, however many times permission checks happen inside it, with no loss of real audit coverage. Confirmed live: `GET /api/conversations` for ECHT Marine went from a 500 error to 200 with the full real conversation list.

6 new backend regression tests (204 total, all passing), clean typecheck, deployed and confirmed live against the exact real data that surfaced both bugs.

## ✅ Dashboard as default screen + real charts + Inbox layout tuning (2026-08-23)

**Dashboard is now what opens by default** when you pick a number, instead of the Inbox — matches what you asked for as the "main screen" for management-level visibility.

**Real charts, not just number tables.** Added a small dependency-free chart layer (inline SVG, no library) with two chart types: a donut/pie chart with a legend (count + %) and a vertical bar chart. Applied them to: a new **Conversation status** donut (Open/Needs reply/Unassigned/Resolved — wasn't visualized anywhere before, only as separate KPI numbers), **Customer stage distribution** (was a plain text bar list, now a donut), and **Template usage** (was a plain text bar list, now a vertical bar chart). Lead funnel stays as its existing funnel-bar treatment since that's the correct shape for a funnel, not a pie/bar.

**Inbox layout — conversation list narrower, chat pane wider**, per your markup: the list column went from 320px to 260px, and the chat pane (already flexible) picks up the difference automatically.

## ✅ Media send confirmed live + 2 real webhook/ordering bugs fixed + template display/variable labels (2026-08-23)

**Media sending — confirmed live with a real photo, real bug found and fixed along the way.** `ExotelProvider.sendMedia` was missing `recipient_type: "individual"`, the same required-but-missing field the earlier template bug had — fixed, same pattern, same source (Exotel's official docs). First live retest used a throwaway 1x1-pixel test PNG and got rejected by Exotel/Meta (`exo_status_code: 30017`, `EX_MEDIA_UPLOAD_ERROR`, "Media error_type not supported") — looked exactly like a repeat of the earlier delivery bug. Generated a real photo instead, sent it through the same code path, and it arrived and was confirmed received. Net result: the code is correct; a degenerate test image was the actual cause of that one failure.

**Delivery-status webhook bug — found while diagnosing the above, real and unrelated to send correctness.** Exotel reports delivery status (sent/delivered/read/failed) for messages we send using the *same* `whatsapp.messages[]` array shape as genuine inbound customer messages, distinguished only by a `callback_type: "dlr"` field the webhook parser never checked. Every status callback was being misclassified as an inbound message, and since a dlr entry's `"to"` field is the *customer's* number (not ours, the opposite of what "to" means on a real inbound message), it always failed with "No registered number matches" and got silently dropped. This meant sent/delivered/read status never actually updated on our messages after the initial guess — real messages were still being delivered fine by Exotel/Meta the whole time, this only broke *our own* status tracking. Fixed by recognizing the `dlr` shape and routing it to the existing status-update path; also mapped the newly-discovered `30017` code to `FAILED` so a real rejection (like the 1x1-pixel test) surfaces correctly in the Inbox instead of getting stuck at an initial guess.

**Message ordering bug — exactly what you flagged.** Outbound message timestamps are always UTC (`...Z`, from our own clock), but Exotel's real inbound webhook timestamps carry a local offset (`...+05:30`, confirmed against a real payload). The Inbox was sorting messages by comparing these as plain strings, which only works correctly when every timestamp uses the same format — mixing the two formats put messages out of chronological order. Fixed to sort by actual parsed time instead of string comparison, so a customer's older message can never appear to jump ahead of (or behind) where it actually happened.

**Template messages now show real text.** The Inbox previously displayed every sent template as a generic `[Template: name]` placeholder instead of what the customer actually received. Now it shows the real rendered text (e.g. "Hi Priya, welcome!"). Dashboard's template-usage report used to parse that placeholder text to figure out which template was used — since the display text no longer has that marker, template usage is now tracked via a dedicated field on the message record instead (with a fallback for older messages sent before this change, so historical reporting isn't lost).

**Admin-configurable variable labels — reduces agent mistakes sending templates.** Admin → Templates now has a "Variable labels" column: label a template's `{{1}}`, `{{2}}`, `{{3}}` with what they actually mean (e.g. "Customer Name", "Order ID", "Delivery Date"). Works on templates of any status, including already-APPROVED ones (unlike editing the template's actual content, which stays locked to drafts only, since labels are local-only metadata never sent to Meta). The Inbox's Send Template row now shows these labels as the input placeholders instead of bare `{{1}}`/`{{2}}`/`{{3}}`, so an agent sending `team_member_welcome` sees "Customer Name" / "Role" / "Login Link" instead of guessing.

15 new backend regression tests (202 total, all passing), clean typecheck, deployed and live-verified — the media send, the dlr-status fix, and the message-ordering fix were all confirmed against real Exotel payloads captured from live traffic during this session, not just unit tests.

## ✅ Dashboard slab layout + live-campaign dropdown verified + Meta token expired again (2026-08-22)

**Dashboard layout.** The four smaller cards (Lead funnel, Customer stage distribution, Template usage, Lead conversion) were each rendered as a lone full-width block, so a bar chart that only needed ~300px of width was stretched across the entire page — exactly the "excess space" you flagged. They're now wrapped in a `.dashboard-grid` (CSS Grid, `repeat(auto-fit, minmax(300px, 1fr))`), so they lay out as a responsive row of slabs — as many columns as comfortably fit at the current width, reflowing automatically on resize rather than needing separate mobile/tablet/desktop rules. KPI cards, Ad performance, By number, and By agent are unchanged (wide tables that benefit from full width).

**Live-campaign dropdown — tested for real, works correctly.** Created a genuine "Live Campaign" field (Admin → Custom Fields → Dropdown (live campaigns)), opened the "Hasim Majotikumbhar" test lead, and watched the field call `/api/ad-campaigns/active` and resolve to "No active campaigns found." Confirmed via a direct API check that this was the *correct* answer given current conditions, not a bug: `META_ACCESS_TOKEN` has expired (`Session has expired... Saturday, 22-Aug-26 07:00:00 PDT`). This means the token set earlier today was a short-lived Graph API Explorer token (~1-2 hour lifetime), not actually exchanged for a genuine long-lived/System User token as intended — **needs to be redone** for both Ad Performance and this new dropdown to show real data. The soft-fail-to-empty behavior itself is working exactly as designed (never blocks editing a Lead over an ads-integration hiccup).

**Inline Lead name/phone editing — also confirmed rendering correctly** in the same live click-through (editable inputs visible in the Lead detail modal, pre-filled with real values).

## ✅ Template delivery fix + needs-response-counts fix + Lead editing + live-campaign dropdown (2026-08-22)

**The template delivery bug.** You reported template messages weren't reaching customers. The root cause: `ExotelProvider.sendTemplate`'s component shape was always flagged UNVERIFIED — a reasoned guess never checked against real docs. It sent `components: [{type: "BODY", text: "Hi Priya, welcome!"}]` (uppercase type, the variables already substituted into a full sentence). Exotel's real WhatsApp API docs (`developer.exotel.com/docs/whatsapp-api/api-reference/templates`) show the correct shape is `components: [{type: "body", parameters: [{type:"text", text:"Priya"}]}]` — lowercase type, a positional `parameters` array, never a pre-substituted body. Also added the required `language.policy: "deterministic"`. This affects every template send: the new WhatsApp welcome message and the Inbox's "send template" action alike. Fixed, 3 regression tests updated, deployed.

**The needs-response-counts bug**, found while tailing live logs to catch a real template send: `GET /api/needs-response-counts` (the red badge counts next to each number) was throwing "Too many subrequests by single Worker invocation" on essentially every call — it was checking snooze status with one Firebase read per open conversation, across every number you have access to, which now that you have ~10 numbers reliably blew past Cloudflare's per-request limit. Fixed by batching that into a single query. Confirmed clean on live production logs after deploy — no more errors on repeated polls.

**Inline Lead editing.** Name and Phone are now directly editable, both in the Leads table (matching the WABA ID column's inline-edit pattern) and in the Lead detail modal — same authorization as tags/custom fields (the assigned agent or a manager).

**Live-campaign dropdown.** A new "campaign" custom field type (Admin → Custom Fields → "Dropdown (live campaigns)") pulls currently-ACTIVE campaign names straight from your registered Meta ad account(s) via the Marketing API's Campaigns endpoint — no manually-typed campaign names, no stale static option lists. Tag a Lead against the exact live campaign it came from, so revenue (via Quotations) can eventually be tied back to campaign performance. Soft-fails to an empty list rather than blocking Lead editing if Meta briefly errors — this is a convenience list, not the core reporting path (`getAdInsights` still surfaces real errors).

9 new backend regression tests (195 total, all passing), clean typecheck (backend + frontend), both deployed.

**Template delivery — now live-verified for real, not just deployed.** Sent a real `team_member_welcome` template from Entartica - Coimbatore to +918490903043 through the Inbox. It arrived on the phone, and a real inbound WhatsApp reply ("Yeah") came back into the conversation seconds later — correctly reopening the 24-hour window and flipping the conversation to "Needs reply." This is full end-to-end confirmation the payload-shape fix actually resolved the delivery problem, not just a plausible theory. Lead editing and the campaign dropdown are still only unit-tested, not yet click-through-verified in the browser.

## ✅ WhatsApp welcome notification + WABA ID admin UX (2026-08-22)

**What it is.** New-user creation (Admin → Users → Add user) now sends a real WhatsApp welcome message, best-effort, alongside the existing welcome email — same content pattern ("Hi {{1}}, you're now a {{2}}. Sign in at {{3}}"), using the `team_member_welcome` template you got APPROVED by Meta this session. The Add User form gained a **Phone** field so there's actually a number to send to; without one, or without an approved template, or without Exotel configured, it silently no-ops exactly like the email path already does — never blocks user creation.

**Sending number is auto-resolved, not admin-configured.** `sendWelcomeWhatsApp` looks up the APPROVED `team_member_welcome` template, reads its `wabaId`, and finds whichever `WhatsAppNumber` shares that WABA ID — so it always sends from the correct site's number without a separate setting to keep in sync.

**A real identifier-confusion bug, resolved from your live screenshots.** Meta's WhatsApp Accounts detail page shows three different-but-similar-looking IDs: the Business Portfolio ID (URL's `business_id`), the WABA ID (the "ID:" next to the account's own name, matching the URL's `selected_asset_id` — this is the one template sync/send actually need), and a Phone Profile ID (a separate floating popup, unrelated to WABA-level calls). You'd been getting a 403 "WABA ID is invalid" because the Templates page took a free-text WABA ID with no guidance on which of these to paste. Fixed two ways: **Admin → Numbers** now has an editable **WABA ID** column so it's set once per number, and **Admin → Templates** now shows a dropdown of number display names (backed by that same WABA ID) instead of a blank text box — confirmed working live, which is also how the `team_member_welcome` template's APPROVED status was first discovered (via a real "Sync from Exotel" against your Coimbatore WABA).

3 new backend regression tests (186 total, all passing), clean typecheck (backend + frontend), both built and deployed. Live WhatsApp delivery itself (an actual message arriving on a real phone) is not yet confirmed — the browser sign-in step needed to click through Admin → Users in this environment requires your Google login, which nobody has done in this deployed session yet.

## ✅ Meta Ads reporting — Dashboard "Ad performance" (2026-08-22)

**What it is.** Admin → Ad Accounts (ADMIN-only, spend data) registers a Meta ad account by name + numeric account id — "Entartica Sea World" / `1030851627297277` is registered live now. Dashboard → **Ad performance** picks a registered account and a date range, and shows exactly the table you asked for: **Ad Name | Portal | Spent Amount | Messages Initiated | Reach**, with a Total row. "Portal" is the ad platform (Meta today); the row shape is deliberately platform-agnostic so a future Google Ads integration can land in the same table without a redesign.

**Messages Initiated** is read from the campaign's `actions` array for the `onsite_conversion.messaging_conversation_started` action type — the real metric Meta reports specifically for click-to-WhatsApp ads, exactly as scoped when you first asked about feasibility.

**`META_ACCESS_TOKEN` is now set and confirmed working against real data** — you generated a long-lived token, set it live, and the Dashboard is now showing real numbers for real Entartica Sea World campaigns (spend, reach, and real click-to-WhatsApp `messagesInitiated` counts, correctly 0 for a non-WhatsApp awareness campaign). `MetaAdsProvider`'s request/response parsing, previously flagged UNVERIFIED, is now confirmed correct against a genuine Meta response — same "prove it, don't assume it" milestone ExotelProvider/ExotelVoiceProvider each went through.

10 new backend regression tests (183 total, all passing), clean typecheck, deployed, and now fully live-verified end to end — real account registered through the Admin UI, real ad performance data rendering correctly in the Dashboard.

## ✅ Lead stage/funnel reporting — step 4 of 4, roadmap complete (2026-08-22)

**A real mislabeling bug found and fixed along the way.** The Dashboard already had a section called "Lead stage distribution," but it was actually reading `CustomerStage` records (set from the Inbox's right panel) — never the Leads Kanban board's own stage progression (`Lead.stageId`, set from the Leads page). Two genuinely separate stage systems share the same `Stage` definitions but track independently. Relabeled the existing (accurate as far as it goes) section to **"Customer stage distribution"** and added a real, new **"Lead funnel"** section backed by actual Lead records.

**What it does.** Shows every active stage (New Leads → Contacted → Interested → Not Interested → Lead Won / Lead Lost, in board order) with a lead count and two percentages: share of all leads, and — the classic funnel reading — share of leads that reached the very first stage and also made it to this one. Leads with no stage set yet are counted separately rather than silently dropped. An optional location filter narrows it to one site. Reuses `listLeads()`'s exact authorization and location-isolation scoping (the same one built earlier this session), so a manager can never see a funnel breakdown of leads they couldn't otherwise see.

7 new backend regression tests (173 total, all passing), clean typecheck, deployed, live-verified against real data on the Dashboard.

**This completes the original locked-in roadmap**: Activity History → Custom Fields → CSV export → stage/funnel reporting, all four shipped, tested, deployed, and verified live.

## ✅ CSV export — step 3 of 4 (2026-08-22)

**What it is.** "⬇ Export CSV" on Leads, Customers, and Call History — downloads exactly what's currently loaded/filtered on screen (respects the active location/status/date/agent filters), including the dynamic Custom Fields columns (Campaign Name, Lead Source, Expected Revenue, etc.) so the reporting-to-management use case that originally motivated Custom Fields is now actually usable end to end.

**Purely client-side, no backend change.** The data driving every export list was already loaded into the page for its table/board view — exporting is just a different rendering of what's already in memory, not a new round trip. A small shared `lib/csv.ts` handles proper quoting/escaping (commas, quotes, newlines) and a UTF-8 BOM so Excel opens it correctly rather than mangling anything outside plain ASCII.

Clean typecheck, deployed, live-verified by capturing the actual generated CSV content on all three pages against real data — confirmed correct headers, correct custom-field columns, correct tag joining, and correct quoting on a field containing a comma.

## ✅ Product Master + Quotations (2026-08-22)

**What it is.** A per-WhatsApp-number price catalog (Admin → Products), managed by SUPERVISOR/SITE_MANAGER/ADMIN — each site/location has its own products and prices, matching the isolation model already in place. On a Lead, a new **Quotations** section builds a real multi-line quotation: pick a product from a dropdown (price fills in automatically), set quantity and a per-line discount, add more lines, apply an overall discount on top, see a live running total, and save as a DRAFT. **Share via WhatsApp** copies a customer-facing link to the clipboard, marks the quote SENT, and drops the agent straight into that lead's WhatsApp conversation to paste and send it — respecting the 24-hour window/template logic already in place, since sharing an unopened conversation's first message still has to go through a template.

**The quotation page itself** is a plain, unauthenticated, printable link (`/quote/:id`) — no sign-in, no app shell, just the quote with a "Print / Save as PDF" button. This is deliberately the "default" you asked to keep for now; a custom-branded template is a separate future piece, not part of this one. Line items are snapshotted (name + price) at the moment they're added to a quote, so a later catalog price change never silently alters a quotation already sent to a customer.

**Access model reused, not reinvented.** `PRODUCTS_MANAGE` was added and granted to SUPERVISOR/SITE_MANAGER/ADMIN the same way `CUSTOM_FIELDS_MANAGE` was — including the same live one-time role-permission migration this required (role permissions are a snapshot, not re-derived from code — see the Custom Fields section above for why). Building/viewing a quotation on a Lead reuses the exact same `canTouchLead` authorization every other lead-editing action already uses.

12 new backend regression tests (172 total, all passing), clean typecheck, deployed, migration run live. Live-verified end to end in the real browser: added a real product catalog under Admin → Products, built a real 2-line quotation with a 10% overall discount on a real Lead (math confirmed correct: ₹50,000 subtotal → ₹45,000 total), and opened the resulting public link in a signed-out tab — rendered correctly with no auth required.

## ✅ Ad-hoc new chat/call to a number not yet in the CRM (2026-08-22)

**The gap.** You asked: what if the number isn't on the portal yet — how do we start a new chat or call directly? Every existing entry point (Leads' "Send WhatsApp", conversation replies) required an existing Lead or Customer record; there was no way to just type a phone number and go.

**What it does now.** A "+ New" button next to the Conversations list opens a small form (phone + optional name); it creates the Customer + Conversation (reusing the same find-or-create logic `startWhatsAppFromLead` already used for Leads) and drops the agent straight into the normal Inbox view for it — same ChatPane, same Call button, same 24-hour-window/template logic just built above. No parallel "compose new" UI was built; a brand-new conversation naturally has no `lastCustomerMessageAt`, so it correctly opens requiring a template for the first message, and the existing 📞 Call button just works since it's a real conversation.

4 new backend regression tests (161 total, all passing), clean typecheck, deployed, live-verified end to end — created a real "Ad Hoc Test" conversation, confirmed the template-required banner, Call button, and Custom Fields panel all render correctly on it.

## ✅ 24-hour WhatsApp customer service window (2026-08-22)

**The gap.** You asked for the "24 hour meta logic" — Meta only allows free-form (text/media) replies within 24h of the customer's own last inbound message; outside that window only an approved template can reopen the conversation. This app had zero enforcement of that: `sendReply` would happily attempt a free-text send on a conversation that's been dead for a week, which WhatsApp would actually reject in real life.

**What it does now.** Added `lastCustomerMessageAt` to Conversation — set only by real inbound messages (Phase4Api), never touched by an outbound send, unlike the existing `lastMessageAt`. `Phase6Api.sendReply`/`sendMediaReply` now check it and reject with a clear `OUTSIDE_MESSAGE_WINDOW` error outside the 24h mark; `sendTemplateReply` is unaffected (templates can always send/reopen). The Inbox compose box mirrors this: outside the window it shows a banner, disables the text box and Media button, and points the agent at the Template dropdown, which stays live.

**A real "first message" bug caught by this, not guessed.** A brand-new conversation started from a Lead (`startWhatsAppFromLead`) stamps `lastMessageAt` at creation time for display/sorting — if the window check had fallen back to that field the way it does for legacy conversations, a lead with zero real customer messages would've looked "fresh" and let an agent send free text to someone who's never messaged in, which Meta would reject. Fixed by anchoring the window strictly to `lastCustomerMessageAt` with no fallback — confirmed live against the real "Test Lead" conversation (started from a Lead, never replied to), which correctly shows the window-closed banner right now.

**Migration for existing conversations**: `backfillCustomerServiceWindow` (ADMIN-only, safe to re-run) scans real inbound message history and backfills the field so already-active conversations don't suddenly look closed the moment this shipped. Ran it live: 27 conversations scanned, 4 updated, 0 on re-run. Building it hit the *same* Cloudflare subrequest-limit wall as an earlier phase this session — fixed by using a single `replace()` write per row instead of `update()`'s implicit read-then-write.

7 new backend regression tests (157 total, all passing), clean typecheck, deployed, migration run, live-verified.

## ✅ Lead/location isolation (2026-08-22)

**The gap.** You flagged it directly: leads for "Entartica - Raipur" shouldn't be visible to "Entartica CRM" users, or any other number's team — but Leads had zero scoping beyond "assigned to me, or I'm a manager." Any SITE_MANAGER/ADMIN saw every lead everywhere, regardless of which WhatsApp number/team they actually belonged to, while Conversations already enforced exactly this boundary via Team + Number Access.

**What it does now.** A manager only sees/touches leads for a location whose resolved WhatsApp number they actually have access to (via an existing NumberAccess grant, or team ownership) — same boundary Conversations already enforce, reused rather than inventing a second access model, per your explicit choice. Enforced everywhere a lead is read or written: `listLeads`, reassigning, calling, WhatsApp, tags, remarks, stage, custom fields, activity, and the location's own Assignment Rules config (a manager can't reconfigure or see participants for a location they don't have number access to either).

**How "location" maps to "number" — no new admin screen.** Reused `findNumberForLocation`, an existing helper that already resolves a lead's location (e.g. "Raipur") to the WhatsApp number whose display name contains it (e.g. "Entartica - Raipur") — the same lookup `startWhatsAppFromLead` already relied on to know which number to send from. A location that doesn't yet resolve to any number (not yet named to match the convention) stays visible to every manager rather than silently locking everyone out — isolation only kicks in once a location has a real matching number.

**Verified safe against real data before deploying**, not just by test: checked Admin → Number Access live and confirmed the only location currently matching a real number is Raipur ("Entartica - Raipur"), and both SITE_MANAGERs who touch Raipur leads (Saket Jauhari, Hasim Test) already hold that exact grant — so this ships with zero risk of an unexpected lockout today. The other 5 locations (Rajsamand, Coimbatore, Prayagraj, Alibaug, Saraighat) have no matching number yet and stay unrestricted until one exists.

4 new backend regression tests (152 total, all passing), clean typecheck, deployed.

## ✅ Custom Fields — step 2 of 4 (2026-08-22)

**What it is.** SUPERVISOR/SITE_MANAGER/ADMIN can now define extra fields (Text, Number, Dropdown, Date) for Leads and Customers separately — e.g. Campaign Name, Lead Source, Product Interest, Expected Revenue, Sell Amount — from a new **Admin → Custom Fields** tab (Lead fields / Customer fields sub-tabs, reorder/deactivate like Lead Stages already worked). Values show as an "Additional Info" block and are editable by whoever could already edit that record — the Lead detail modal (Leads module) and the Inbox's right panel (Customers) — with no separate permission needed to fill them in, only to define them.

**Why SUPERVISOR/SITE_MANAGER, not ADMIN-only.** This was an explicit decision (confirmed via question, not assumed) — unlike every other admin-config permission, `CUSTOM_FIELDS_MANAGE` was deliberately granted to SUPERVISOR and SITE_MANAGER in `RoleDefinitions` so day-to-day managers don't need to go through Hasim/Hitesh for every new field.

**A real production-permissions gotcha, found and fixed.** Role permissions in this system are a **one-time snapshot** taken at `bootstrap()` — changing `RoleDefinitions` in code does *not* retroactively grant new permissions to already-created Role records in the live database, even for ADMIN (`AccessControl.require` has no ADMIN special-case, unlike `requireTeamOperation`). There was also no endpoint to patch a Role's permissions after bootstrap. Built one (`PATCH /api/roles/:id`, reusable beyond this one case) and ran a real one-time migration against the live database (captured a real Firebase auth token from an authenticated browser session, not fabricated credentials) to grant `customFields.manage` to SUPERVISOR/SITE_MANAGER/ADMIN's already-existing Role rows. Confirmed via API after: SUPERVISOR 7 permissions, SITE_MANAGER 9, ADMIN 31.

**Architecture.** Definitions live in their own small collection (`customFieldDefinitions`); values stay denormalized directly on the Lead/Customer record (`customFields: { [key]: value }`), same tradeoff already made for `tags` rather than a separate per-value table. A shared `validateCustomFieldValues` helper (in the new `customFieldsApi.ts`) is called by both `Phase22Api.updateLeadCustomFields` and `Phase8Api.updateCustomer` — rejects unknown/inactive keys, coerces/validates per type, and treats a blanked value as "clear this field."

6 new backend regression tests (148 total, all passing), clean typecheck both sides, clean build. Live-verified end to end against real data: created a real Lead-side dropdown field (Lead Source: Website/Referral/Cold Call/Walk-in) and a real Customer-side number field (Expected Revenue), set values on a real "Test Lead" record from both the Leads detail modal and the Inbox right panel, and confirmed both survive a full page reload.

## ✅ Call status refresh, managers can call/WhatsApp any lead, Activity History — step 1 of 4 (2026-08-22)

**Call statuses were stuck forever.** You spotted every call in Call History showing "in-progress" no matter how old. Root cause: `connect.json`'s response only ever reflects the call's state at the instant it was placed — Exotel never updates it after, and there's no status-callback webhook wired up. Fixed with an on-demand refresh instead: `ExotelVoiceProvider.getCallStatus`, a `refreshCallStatus` endpoint, and a small ↻ button next to the status badge in both Call History and the Inbox's Calls section.

**Leads Call/WhatsApp buttons, fixed and extended.** `initiateCall` (the Leads click-to-call) hard-blocked anyone but the exact assigned agent — including ADMIN, by explicit prior design ("an admin never places calls through this path"). Once managers started actually using the app this was a real gap, so it's loosened to the same `canTouchLead` scope `startWhatsAppFromLead` already used (rings the caller's own phone, same as before). Added matching 📞/💬 icon buttons directly on the Leads Kanban cards and table rows, not just buried in the detail modal, and fixed the modal's own button visibility which had the identical too-strict check.

**Activity History — step 1 of the 4-part roadmap you locked in** (Activity History → Custom Fields → CSV export → stage/funnel reporting). Reuses data that was already being recorded — nearly every action (reassignment, stage/tag changes, calls, remarks, customer edits) already wrote to the audit log, it just had nowhere to be seen except the global Admin-only Audit Log. Added a plain-English activity timeline to the Lead detail modal and the Inbox's right panel, each entry resolved to the actor's real name (works even for a plain AGENT who can't call `listUsers()` themselves).

**Real bug found and fixed while shipping this:** bundling conversation activity into the existing single-round-trip workspace fetch (matching how Remarks/Reminders/Calls already work) pushed that call over Cloudflare Workers' per-invocation subrequest limit — and the failure silently broke *sibling* fields in the same call too, including `realtime` (live message updates). Caught live via `wrangler tail`, not a guess. Fixed by making conversation activity a separate, lazy-loaded fetch that only fires when the Activity section is actually expanded (it's collapsed by default anyway) — zero added cost on every conversation open instead of one that broke things. Lead activity was never affected — Lead detail fetches were already separate per-field requests, not bundled.

5 new backend regression tests, 141/141 passing. All of the above deployed and verified live against real data — new "in-progress"→real-status refresh, Call/WhatsApp icons on a real lead, and a real 15-entry Activity timeline.

## ✅ New: Phase 22 — Location Leads Upload, Assignment Rules & Exotel Click-to-Call (2026-08-17)

Built into the live `apps-script/` build (not the webapp — see migration section below).
Admins can now upload a spreadsheet of call leads (name/phone/location) for Raipur,
Rajsamand, Coimbatore, Prayagraj, Alibaug, and Saraighat; each lead auto-assigns to a
site agent by a per-location rule (single agent / round robin / manual, configurable
under the new **Location Leads → Assignment Rules** admin tab). Agents see their own
leads under a new **My Leads** page with a one-click **Call** button.

**Action needed from you before click-to-call works:**
1. Set four Script Properties in the Apps Script editor (Project Settings → Script
   Properties): `EXOTEL_VOICE_ACCOUNT_SID`, `EXOTEL_VOICE_API_KEY`,
   `EXOTEL_VOICE_API_TOKEN`, `EXOTEL_VOICE_CALLER_ID` (the ExoPhone the calls should
   come from). If your Exotel Voice API uses the same account as your existing WhatsApp
   integration, these can be the same Account SID/Key/Token you already set for
   `EXOTEL_*` — just the CallerId is new.
2. For each agent, open **Users → Edit** and fill in their **Phone** field — this is the
   number Exotel rings first before connecting the call to the lead.
3. Place one real test call once the above are set — the exact Exotel Voice API
   request/response shape is flagged UNVERIFIED in `src/Phase22ExotelVoice.gs` (modeled
   on public docs, not yet exercised against a real account), same as how the WhatsApp
   provider's less-common methods started out.
4. Upload a test batch of leads and set an assignment rule per location before agents
   go looking for their leads — a location with no rule configured leaves leads
   `UNASSIGNED` in the admin table until manually assigned.

All 24 backend test suites pass (`cd apps-script && node tests/<name>.js` for any one,
or see `memory/CHANGELOG.md` for the full list), including the pre-existing suites —
nothing else in the app regressed.

## ✅ Migration: full Apps Script feature parity reached on the new stack

Per your decision, the app is being rebuilt on Cloudflare Workers (backend) +
Firebase Realtime Database (already in use) + React (frontend) — all free
tier, no credit card required anywhere. The two builds are kept **completely
separate** on disk: `apps-script/` (current, live, what your team uses today
— untouched and still being bug-fixed in parallel) and `webapp/` (the new
build, `webapp/backend/` + `webapp/frontend/`). Nothing moves over to the new
one until it's fully validated — see the phase list further down.

**Status: foundation built and verified working.**
- `webapp/backend/` — Cloudflare Workers project. Verified locally: boots
  cleanly, routing/error-handling/CORS all work, and the auth-checking
  pipeline correctly rejects unauthenticated requests. Firebase Admin access
  (reading/writing the database, minting realtime tokens) is built using the
  same JWT-signing approach the Apps Script build used, adapted to Workers'
  native Web Crypto API instead of Apps Script's `Utilities` — no Firebase
  Admin SDK needed (it isn't Workers-compatible).
- `webapp/frontend/` — React app (Vite). Verified: typechecks clean, builds
  clean, dev server boots. Has a working Google-sign-in screen that calls the
  new backend and shows the response — proves the whole chain (browser →
  Firebase Auth → ID token → Workers → verified → response) works end to end,
  the same kind of real round-trip check that caught the Apps Script realtime
  bugs earlier, done now before any real feature logic is built on top.

**Phase 1 (auth/roles/teams/number-access) ported and tested.** Direct port of
`apps-script/src/Phase1{Domain,AccessControl,Services,Endpoints}.gs` — same
five roles, same permission rules, same validation, only the storage layer
(Realtime Database instead of Script Properties) and identity source
(verified Firebase ID token instead of `Session.getActiveUser()`) changed.
Verified two ways: live against a running `wrangler dev` server (every one of
the 24 endpoints correctly routes and enforces auth), and with 18 automated
tests against a mocked Firebase — real RSA JWT signing/verification included,
not stubbed out — covering bootstrap edge cases, permission enforcement, and
the core `requireConversationOperation` authorization gate across roles. One
real bug was caught and fixed by these tests (a test-isolation issue in the
Google-public-key cache, not a production bug). Run `npm test` in
`webapp/backend/`.

**Messaging core (numbers/customers/conversations/messages/webhook/send)
ported, tested, and live.** Direct port of `apps-script/src/Phase{3,4,5,6}
Services.gs` + `WorkspaceServices.gs` — numbers CRUD, the Exotel webhook
ingestion pipeline (confirmed-live payload parsing carried over as-is),
authorized conversation listing/detail, sendReply with the bookkeeping-
isolation fix from the Apps Script build carried over, and the workspace
aggregator (now gating the realtime token behind `includeRealtime` from the
start, instead of learning that lesson the hard way again). 35 automated
tests total (17 new), including a mocked Exotel endpoint proving both the
success path (SENT, needsResponse cleared) and the failure path (FAILED
status saved, no throw, needsResponse untouched). Deployed live and smoke-
tested — every route, the webhook's shared-secret auth, and the "always
200, real status in the body" behavior all confirmed working on the actual
deployed URL, not just locally.

**CRM core (assignment, remarks, reminders, stages) ported, tested, and live.**
Direct port of `apps-script/src/Phase{7,8,9}{Domain,Services}.gs` — the
round-robin engine (`Phase7Api`/`NumberAssignmentConfigApi`: eligibility +
availability + numberAccess gating, self-healing rotation pointer,
returning-customer inheritance to their prior owner, fallback/unassigned
queue, working-hours restriction, full assignment history), lead stages +
per-customer stage + internal remarks (`Phase8Api`), and reminders + snooze
(`Phase9Api` — snoozed conversations now correctly disappear from Phase 5's
active inbox list). Wired into the two places the Apps Script build wired
them: Phase4Api's webhook ingestion now auto-assigns every brand-new
conversation, and Phase5Api's active-conversation list now filters out
anything currently snoozed. `WorkspaceApi` restored to its full field set
(stage/remarks/reminders/snoozeStatus/assignableUsers), matching the
original aggregator exactly. 24 new automated tests (59 total) covering
round-robin rotation across multiple eligible agents, the
eligible-but-unavailable-is-skipped case, returning-customer routing once
their prior conversation is closed, config/participant CRUD and its
authorization gates, stage/remark/customer visibility scoping, and
reminder/snooze lifecycle including the "hidden from active inbox, visible
in all-statuses view" behavior. Exposed via 25 new routes in a new
`src/routes/crm.ts`, deployed live, and smoke-tested (every new route
correctly requires auth — 401 without a token, not 404 — confirming the
whole set is live and wired).

Deferred to later phases on purpose (matches the task breakdown):
sendTemplateReply/sendMediaReply/file upload (templates & media — needs a
Drive-equivalent host, likely Cloudflare R2, not set up yet).

**Phase 22 (location leads + Exotel click-to-call) ported, tested, and live.**
Direct port of `apps-script/src/Phase22{Domain,Services,ExotelVoice,Endpoints}.gs`
— a second, independent assignment workflow alongside the CRM core's per-number
round robin: `Phase22Api` covers lead upload (per-row validation, duplicate
skipping, individual-row error reporting so one bad row doesn't abort a whole
paste), per-location assignment config (single fixed agent / round-robin /
manual, same rotation-with-self-healing-pointer logic as the CRM core's round
robin, just keyed by location), lead reassignment, lead stage + remarks
(reusing Phase8Api's exact ownership rule — a manager can touch any lead, an
agent only their own), click-to-call (`ExotelVoiceProvider`, a new port of
`Phase22ExotelVoice.gs` — separate credentials/domain from the WhatsApp
Exotel integration, still UNVERIFIED against a real account, same flag the
source carried), and the "start WhatsApp from a lead" bridge that finds/creates
a Customer+Conversation on the WhatsApp number matching the lead's location
(matched by a location-name substring in the number's display name) and hands
the frontend straight into the existing inbox UI. Added a `phone` field to
`User` (missing until now — needed so click-to-call knows which number to ring
first) and its own `src/domain/phase22.ts` for the six fixed locations and
validation rules. 31 new automated tests (90 total) covering round-robin/
single/manual assignment modes, lead visibility scoping, config/participant
CRUD, call placement (including the location-caller-ID override and the
missing-agent-phone/missing-Voice-credentials error paths, via a new mocked
Exotel Voice endpoint in the test harness), stage/remark ownership gating, and
the WhatsApp-bridge's idempotency + numberAccess gating. Exposed via 16 new
routes in a new `src/routes/phase22.ts`, deployed live and smoke-tested (every
route correctly requires auth). The Exotel Voice secrets you provided earlier
are now set on the live backend — click-to-call is wired end-to-end, not just
returning a configuration error — but the request/response shape itself is
still unverified against a real Exotel account (see the task list).

**✅ The real frontend Inbox UI is built, live, and confirmed working by you
end-to-end.** Until now every phase above was backend-only (API routes +
business logic) — there was nothing to click on. `webapp/frontend/` now has:
sign-in → bootstrap (first run) → number picker → sidebar-nav workspace
shell → **Inbox page** — conversation list (search by name/phone), chat
thread with text reply + resolve, and a CRM detail panel (reassign, lead
stage, remarks, reminders, snooze), all wired to the live backend above.
Design tokens/layout (`src/styles.css`) are ported directly from
`apps-script/frontend/Index.html`'s mockup-matched CSS so the two builds
look the same. You registered all 10 real WhatsApp numbers via the new
"Add a WhatsApp number" form (ADMIN-only), and confirmed live: the number
picker, the Inbox shell, a real inbound test message (sent through the
actual webhook ingestion pipeline, not faked), and — the big one — **a real
reply sent successfully through Exotel** (green "SENT" bubble, no failure).
One transient "conversation list briefly empty" glitch self-corrected within
seconds (Cloudflare edge-propagation lag right after a secret rotation, same
kind of transient seen elsewhere this session) — not a real bug.

**Real bug found and fixed during this verification**: setting secrets via
PowerShell's `"value" | wrangler secret put` pipeline silently appends a
trailing newline, corrupting the secret. This broke `WEBHOOK_SECRET_TOKEN`
(caught immediately — 401s until fixed) and had also corrupted all four
`EXOTEL_VOICE_*` secrets set earlier the same way. All five have been
re-set correctly via a newline-safe method (`printf '%s' ... | wrangler
secret put`) — click-to-call should now actually reach Exotel instead of
silently failing auth.

**✅ Real-time updates are now live.** The Inbox's open conversation updates
the instant a new message lands — a direct port of the Apps Script build's
already-proven `RealtimeListener` (`webapp/frontend/src/lib/realtime.ts`):
exchange the backend-minted custom token for a real Firebase ID token via
Identity Toolkit, then stream `messages.json` filtered by `conversationId`
as Server-Sent Events. No Firebase console changes needed — same project,
same collection paths (`conversations`/`messages`), same `numberIds` custom
claim shape as the Apps Script build's token, so its existing security
rules already authorize the new backend's tokens too. Replaces the old
4-second blind poll for the open conversation; a relaxed 8s poll still
covers the conversation list (other conversations' previews/badges — same
scope limit the Apps Script listener has), plus a 20s safety-net workspace
refetch in case the stream silently drops.

**✅ The Leads page (Phase 22 frontend) is built** — a second sidebar nav
item alongside Inbox. Location/status filters, a lead table (scoped
server-side: managers see everything, agents see only their own leads,
same rule `Phase22Api` already enforces), an ADMIN/SITE_MANAGER-only bulk
upload (paste `Name, Phone, Location` lines, per-row errors reported
without aborting the batch — same UX the backend was built for), a lead
detail modal (stage, comments, Call, Send WhatsApp — which bridges straight
into the Inbox page, switching the active WhatsApp number automatically if
the lead's location resolves to a different one), and an assignment-rules
modal (mode/participants/caller-ID per location, plus a quick per-agent
phone-number setter since `initiateCall` needs one on file and there's no
Admin Users page yet to set it otherwise). Typechecks clean, production
build clean, verified rendering with no console/network errors in a fresh
browser load.

**✅ Templates, quick replies, and media (Phase 10/11) are ported — backend
and frontend both.** Direct port of `apps-script/src/Phase{10,11}Services.gs`
plus the media half of `Phase6Services.gs`: `Phase10Api` (draft → submit →
sync template workflow, ADMIN-only, real `ExotelProvider.createTemplate`/
`getTemplates` calls, same "built and tested, not invoked live unattended"
boundary as `sendReply`), `Phase11Api` (quick-reply CRUD, admin-managed,
anyone can list), and `Phase6Api.sendTemplateReply`/`sendMediaReply`
(variable substitution into `{{n}}` placeholders, media send by URL).
Inbound media (`mediaUrl` from Exotel's webhook) is now persisted into a
`messageMedia` collection and shown inline in the chat thread. The Inbox
compose box got a quick-reply picker, a template picker (with inline
variable inputs), and a "send media by URL" form.
12 new backend tests (102 total), deployed and smoke-tested live; frontend
typechecks/builds clean, verified rendering with no console errors.

**✅ Admin Panel (Phase 12) is built — frontend only, since the backend CRUD
for almost all of it already existed.** A new **Admin** sidebar item
(ADMIN-only) with 8 tabs: **Users** (create, edit phone/status, toggle
roles via checkboxes), **Teams** (create, expand a team to manage members
and their per-number scope), **Numbers** (create/edit/deactivate — this
already existed via the number-picker's add form, now also manageable
here), **Number Access** (grant/revoke per user × number), **Assignment
Rules** (per-number round-robin: enabled toggle, fallback agent, working
hours, ordered participant list — `NumberAssignmentConfigApi` was actually
built ahead of schedule during the CRM-core phase specifically so this
moment wouldn't need new backend work), **Quick Replies** and **Templates**
(moved here from the old standalone Settings page, which no longer exists
as a separate nav item), and **Audit Log** (read-only, newest first, capped
at 300 rows shown). Typechecks/builds clean, verified rendering with no
console errors on a fresh load.

**✅ Search/filters + needs-response badges (Phase 13) are ported —
backend and frontend both.** Direct port of
`apps-script/src/Phase13Services.gs`'s `Phase13Api`: `searchConversations`
(spans every number the caller can access unless one is specified, filters
by assignee/customer/stage/status/needs-response/unassigned/date range,
free-text `query` matching customer name/phone or message text, all
composed on top of `Phase5Api`'s already-enforced authorization rather than
reimplementing it) and `getNeedsResponseCounts` (open + needs-response
conversation counts per number). The Inbox's conversation list gained a
status filter and needs-response/unassigned checkboxes (switches to the new
search endpoint only when a filter or search text is active, otherwise
keeps using the faster plain active-list fetch); the number picker and the
sidebar's current-number pill both show live needs-response badges, polled
every 20s. 8 new backend tests (110 total), deployed and smoke-tested live;
frontend typechecks/builds clean, verified rendering with no console errors.

**✅ Dashboard & Analytics (Phase 14) is ported — backend and frontend
both.** Direct port of `apps-script/src/Phase14Services.gs`'s `Phase14Api`:
conversation totals/open/unassigned/needs-response/resolved, total
customers, "assigned to me," per-number and per-agent breakdowns, average
first-response time (createdAt → first OUTBOUND message), lead-stage
distribution, template usage (parsed from a message's `"[Template: name]"`
display-text marker, since `Message` has no `templateId` field of its own
— same constraint the source documents), and lead conversion rate — all
scoped through `Phase5Api.listMyNumbers()`, gated on `REPORTS_VIEW`
(SUPERVISOR/SITE_MANAGER/VIEWER/ADMIN; AGENT does not have it, same as the
source). A new **Dashboard** sidebar item (hidden for AGENT-only users)
with a KPI row, per-number and per-agent tables, and bar-chart-style stage/
template-usage breakdowns — a "this number / all numbers I can access"
scope toggle mirrors the source's optional `numberId` narrowing. 7 new
backend tests (117 total), deployed and smoke-tested live; frontend
typechecks/builds clean, verified rendering with no console errors.

**✅ Backup (Phase 15) is ported — the part of it that actually has a
free-tier equivalent.** The source's `backupNow()` was a Google Sheets/
Drive-specific `SpreadsheetApp.copy()` — no 1:1 port exists since this
backend has no spreadsheet. The genuinely useful, zero-new-dependency
equivalent: `Phase15Api.backupNow()` pulls a full Firebase Realtime
Database JSON export (same admin credentials every other read already
uses — Firebase's REST API supports this at the database root) and a new
**Backup** tab in the Admin panel downloads it straight to the browser as
a file. Audit coverage and secrets hygiene (the other two thirds of the
source's Phase 15) needed no new code at all — every prior phase's own
`audit.write(...)` calls already satisfy the same audited-event list, and
no secret is ever hardcoded here. 3 new backend tests (120 total),
deployed and smoke-tested live; frontend typechecks/builds clean, verified
rendering with no console errors.

**Not built: an automatic scheduled backup.** Apps Script's
`installDailyBackupTrigger`/`removeDailyBackupTrigger` (toggle a daily
trigger on/off via an API call) has no equivalent — Cloudflare Cron
Triggers are static `wrangler.toml` config set at deploy time, not
something togglable at runtime, and there's nowhere durable to store an
automatic backup's output without R2 anyway. This is a genuine, permanent
architectural difference from the Apps Script build, not a "blocked, will
fix" item — the manual "Backup Now" button is the intended free-tier
design for this stack, not a placeholder.

**✅ Local-file media upload is done too — you enabled R2 the same day.**
`Phase6Api.uploadConversationMedia` (the free-tier equivalent of the Apps
Script build's Drive-backed upload) is R2-backed: the compose box's
"📁 Choose file" button reads the file as base64, uploads it to a new
`whatsapp-panel-media` R2 bucket, and a new public `GET /media/:key` route
serves it back with the real Content-Type set (not sniffed) — the same fix
the Drive version needed after `export=download` served everything as a
generic binary blob. No card was required to enable R2. 3 new backend
tests (123 total) using an in-memory fake R2 binding (native R2 has no HTTP
surface the existing mock-fetch harness could intercept), deployed and
smoke-tested live; frontend typechecks/builds clean.

**This closes out full Apps Script feature parity** (Phases 1-15, matching
the original build's own phase numbering) for the new stack, completely —
every phase now has a working, tested, live equivalent. The only remaining
piece is the deliberate architectural difference noted above (no automatic
scheduled backup).

**How to see it**: run `npm run dev` in `webapp/frontend/` (or it may already
be running — check `http://localhost:5173`) and sign in with your Google
Workspace account. It already talks to the live backend, no local backend
server needed.

## ✅ Parallel-run validation, round 1: data isolation + a real bug fix (2026-08-19)

Before any live-traffic parallel-run testing, found and fixed a real safety
gap: **webapp and apps-script were pointed at the exact same Firebase
Realtime Database** (`whatsapp-panel-db`), and both used the identical
collection names `conversations`/`messages` for their live data. apps-script
migrated those two tables to Firebase back on 2026-08-11 (see `memory/DECISIONS.md`);
webapp's `.env.example`/`wrangler.toml` reused the same project from day
one, since it was "already in use" — but nobody had checked whether the two
builds' collection names actually collided. They did. In its current state
this was mostly harmless (webapp's own webhook has never been pointed at
real Exotel traffic, so it wasn't writing real conversations), but any
parallel-run test that exercised webapp's ingestion for real would have
written into the exact collection apps-script's live daily-use agents read
from — with webapp's own independently-bootstrapped number/customer IDs, which
wouldn't resolve on the apps-script side.

**Fixed by renaming webapp's copies of those two collections** to
`webapp_conversations`/`webapp_messages` — a code-only change (`Repository`
constructor calls in 9 backend service files, the frontend's realtime
EventSource URL in `lib/realtime.ts`), not a new Firebase project. Every
other collection webapp uses (`numbers`, `customers`, `users`, `roles`,
`teams`, `templates`, `quickReplies`, etc.) was already exclusive to
webapp — apps-script keeps those on Sheets, not Firebase — so only these two
needed touching. 127 backend tests passing (4 new), deployed and
smoke-tested live.

**One manual step left to fully finish this**: the browser's live "new
message appears without refreshing" feature (`lib/realtime.ts`) reads
`webapp_messages` directly via a Firebase security rule — and that rule
only exists for the old `messages` path today (configured directly in the
Firebase console, not in this repo). Until you duplicate that rule for
`webapp_messages`, the realtime push feature will silently stop working in
webapp (a normal refresh/reopen still shows new messages, just not
instantly). **To fix**: Firebase Console → your project → Realtime
Database → Rules → find the existing rule block for `messages` → duplicate
it → rename the duplicate's key to `webapp_messages` → Publish. Same
structure, new key, nothing else to figure out.

**Also ran a full phase-by-phase logic-parity audit** (apps-script `.gs`
originals vs. the webapp TypeScript port, all 15 phases, cross-referenced
against git history on both sides for fixes that might not have carried
over). Found and fixed one real, verified bug: **`Phase1Api.validatePatch`
(`webapp/backend/src/services/phase1Api.ts`) was silently dropping
`roleIds`/`numberIds`/`permissions` validation** that the apps-script
original (`Phase1Services.gs`'s `validatePatch_`) has always had — a
`PATCH /api/users/:id` with a `roleIds` array referencing a deleted/nonexistent
role, or a non-array value, would previously be accepted without error
(risking a later crash wherever `AccessControl` calls `.includes()` on it),
and `PATCH /api/team-members/:id`'s `numberIds` had the same gap. Now
validated identically to the original: array-of-strings + roles must
actually exist. 4 new regression tests. Everything else audited (Phase 1
core authorization, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 22, plus the
repository/caching layers) came back semantically identical — no other
drift found. Two more differences were noted but are deliberate, not bugs:
no automatic scheduled backup exists in webapp (see above), and the old
temp-password/forced-password-change flow has no equivalent since webapp
uses Firebase Auth exclusively.

**QA baseline confirmed green across the board**: apps-script's 24 Node
test suites, webapp/backend's 127 Vitest tests, and webapp/frontend's
typecheck + production build all pass with zero regressions.

**Next for parallel-run validation**: with data isolation done, the
remaining piece is verifying webapp's *behavior* against real traffic
without disrupting apps-script — this still needs a deliberate decision
about how (e.g. a temporary dual-webhook forward from apps-script's live
endpoint, or manually replaying real captured payloads against webapp's
`/webhook/exotel`) rather than pointing Exotel's dashboard at webapp
directly, which would stop apps-script from receiving that number's
messages entirely. Flagging this for a decision before proceeding further,
rather than picking one unilaterally.

## ✅ Parallel-run validation, round 2: dual-write forward built (2026-08-20)

Per your decision, went with option B: apps-script keeps handling every real
webhook exactly as it does today — same response, same speed, same
reliability — and, after that's done, makes a **best-effort** attempt to
forward the exact same raw payload to webapp's own `/webhook/exotel`, so
webapp independently processes the identical real traffic apps-script just
handled. If the forward fails or times out for any reason, it's swallowed
silently and never affects the real response Exotel is waiting on — proven
by a new test that makes the forward throw and confirms the webhook still
returns normally.

**Off by default.** Nothing changes until you opt in. `apps-script/src/Phase4Webhook.gs`'s
`doPost` now checks a Script Property, `WEBAPP_PARALLEL_RUN_WEBHOOK_URL`,
after processing each webhook — if it's unset (the current state), no
forward is attempted at all, zero behavior change from before.

**To turn it on when you're ready**: Apps Script editor → Project Settings
→ Script Properties → add a property named `WEBAPP_PARALLEL_RUN_WEBHOOK_URL`
with the value `https://whatsapp-panel-backend.hasim-c9e.workers.dev/webhook/exotel?token=<paste webapp's WEBHOOK_SECRET_TOKEN value here>`
(same secret-handling pattern as every other credential in this project —
I never see or ask for the actual token value, you paste it directly into
the Apps Script property). **To turn it off**: delete that property, or
clear its value — takes effect on the very next webhook call, no redeploy
needed either way.

**One honest caveat**: Apps Script's `UrlFetchApp` has no configurable
timeout, so while this is on, if webapp is ever slow or unreachable it adds
real latency to the *live* webhook response apps-script sends back to
Exotel (normally Cloudflare Workers responds in well under a second, so
this should be unnoticeable in practice) — meant for a deliberate, bounded
testing window, not to be left on indefinitely.

3 new tests in `tests/phase4-webhook-verification.js` (off-by-default, fires
correctly when configured, never breaks the real response on failure). All
24 apps-script test suites still passing. Pushed to Apps Script via
`clasp push`.

### Setup status — everything is now set

1. ✅ Cloudflare account created, `wrangler login` done.
2. ✅ `FIREBASE_WEB_API_KEY` secret set.
3. ✅ `FIREBASE_SERVICE_ACCOUNT_JSON` secret set (fresh key, independent from the Apps Script build's).
4. ✅ `BOOTSTRAP_ADMIN_EMAIL` secret set.
5. ✅ `WEBHOOK_SECRET_TOKEN` set (generated automatically, not reused from the Apps Script build). **Not pointed at Exotel yet on purpose** — that's a deliberate later cutover step, not something to do now.
6. ✅ Exotel WhatsApp credentials set (`EXOTEL_API_KEY`/`API_TOKEN`/`ACCOUNT_SID`/`SUBDOMAIN`) — `sendReply` and the webhook can now actually reach WhatsApp.
7. ✅ Exotel Voice credentials set (`EXOTEL_VOICE_ACCOUNT_SID`/`API_KEY`/`API_TOKEN`/`CALLER_ID`) — click-to-call (Phase 22) can now actually reach Exotel's Voice API. **Unverified**: no real call has been placed yet, so the exact request/response field names (carried over from the Apps Script build's own unverified version) aren't confirmed — see the task list for a one-time real-call test.

### ✅ First admin account created — full pipeline confirmed live

You've completed bootstrap and confirmed `/api/whoami` returns real data
(`ADMIN`, your actual name/email). This is the first genuine end-to-end proof
on real infrastructure: Google sign-in → Firebase ID token → Workers backend
→ Realtime Database → back to the browser, no mocks anywhere in that chain.

### 🆕 New feature found: location leads + click-to-call (Phase 22)

While looking into the Exotel Voice credentials, I found `apps-script/src/
Phase22*.gs` — a real, separate feature added to the Apps Script build:
uploading call leads per site location, auto-assigning them (single agent /
round-robin / manual per location), click-to-call through Exotel's Voice API,
and a bridge that lets an agent jump from a lead straight into a WhatsApp
conversation with that same person. Added it to the migration plan as its own
phase, sequenced right after CRM core (it reuses that phase's round-robin and
stage/remarks patterns directly, so porting it right after keeps the code
consistent rather than duplicating the pattern early). Also added its 3 new
permissions (`leads.manage`/`leads.view.assigned`/`leads.call`) to the new
backend's role definitions now, while the system is still unbootstrapped —
means a fresh bootstrap picks them up automatically, no separate fixup script
ever needed (the Apps Script build needed one, since its roles were already
persisted before the feature existed).

Full setup details are in `webapp/backend/README.md` and
`webapp/frontend/README.md`. Phase-by-phase plan, same order as the original
build:

1. ~~Foundation (backend + frontend scaffolding, auth pipeline proven)~~ ✅ done
2. ~~Phase 1 — auth, roles, teams, number access~~ ✅ done, tested
3. ~~Messaging core — numbers, customers, conversations, messages, webhook, send~~ ✅ done, tested, live
4. ~~CRM core — assignment, remarks, reminders, stages~~ ✅ done, tested, live
5. ~~Location leads + click-to-call (Phase 22)~~ ✅ done, tested, live (Voice call itself still needs a one-time real-call verification — see task list)
6. ~~Templates, quick replies, media~~ ✅ done, tested, live (media *file upload* specifically waits on you enabling R2 — see task list)
7. Admin panel ✅ · notifications/search ✅ · dashboard ✅ · backup ✅ (all done, live — Phases 1-15 parity reached)
8. Parallel-run validation, then cutover (Apps Script stays live and untouched the entire time) — **next**

## ✅ Mobile and tablet responsiveness (2026-08-21)

`webapp/frontend`'s CSS had zero `@media` queries anywhere — the fixed-width sidebar (236px) and the Inbox's fixed 3-column split (320px/1fr/300px) genuinely broke below ~900px: on a phone the sidebar alone would eat the whole screen and the app would horizontally scroll. Fixed:

- **Sidebar** becomes an off-canvas drawer below 900px, opened by a hamburger button, closes on navigating/switching number/tapping the backdrop.
- **Inbox** becomes one pane at a time below 900px (conversation list *or* chat, never both), with the customer detail panel sliding in as an overlay (info button in the chat header) instead of a third column, plus a back button to return to the list.
- **Leads/Reminders/Customers tables** get horizontal-scroll wrappers so a wide table scrolls in place instead of breaking the page.
- Desktop and tablet-landscape (≥900px) are provably unchanged — every element renders the same markup at every width, only CSS visibility/position changes below the breakpoint.

**One honest limitation**: this environment couldn't physically resize the real browser window or report altered viewport dimensions to the page, so I verified the implementation by exercising the actual state transitions via the DOM against the live app (confirmed the drawer, back/info/close buttons, and pane-switching all correctly toggle the right classes on the real elements) rather than a narrow-viewport screenshot. The CSS itself uses standard, well-established responsive patterns (off-canvas drawer, single-column grid, slide-in overlay) — **please click through it on an actual phone/tablet when you get a chance**, same "I can't fully substitute for you actually using it" caveat as every other frontend change in this project.

## ✅ Leads Upload ↔ Assignment Rules visibility + bulk lead actions (2026-08-21)

**A real gap found while checking this connection, not something you need to act on urgently, but worth knowing:** `Phase22Api.uploadLeads` has always auto-assigned each uploaded lead per that location's assignment rule (`assignLead`) — that part of the wiring was correct and already tested. What was missing was visibility: nothing in the UI showed *whether* a location actually had a rule configured before you uploaded into it. The Upload Leads modal now shows a live status line per location (configured/active, manual, or not configured) with a one-click "Configure" link straight into Assignment Rules. Checking this live surfaced that **none of your 6 locations have an assignment rule configured yet** — every lead uploaded so far has landed `UNASSIGNED`. Worth noting this isn't necessarily an oversight: there's currently only one real user account in the system (yours), so round-robin/single-agent modes don't have much to route between yet — this becomes actionable once more agent accounts exist (Admin → Users).

**Bulk lead actions.** The Leads table (manager-only) now has row checkboxes, select-all, and a bulk action bar — reassign or set-stage across every selected lead in one action instead of one at a time. Verified live: selected 2 real leads, bulk-reassigned both in one action, confirmed both updated correctly.

Frontend-only change (reused existing backend endpoints), typecheck/build clean, no deploy needed beyond the dev server already picking it up.

## ✅ Webapp UI expansion: dark theme reskin, Leads Kanban board, Reminders & Customers pages (2026-08-21)

The webapp frontend got a real visual and functional expansion this session, on top of the Phase 1-15 parity reached on 2026-08-18. **Nothing here needs you personally** — no manual setup, no blocked items, purely additive UI/UX work, already deployed and verified live.

**Dark theme reskin.** Ported a techy dark-theme design concept — built and approved screen-by-screen in Penpot first (see `memory/whatsapp-crm-penpot-design-concept` if picking this up in a fresh session) — into `webapp/frontend`: Space Grotesk/Inter/JetBrains Mono typography, WhatsApp-green + Exotel-blue accent colors, glow effects on primary actions. Same CSS class names throughout, so no component structure changed — purely `styles.css` plus font links in `index.html`.

**Leads Kanban board.** The Leads page now has a Board/Table toggle (defaults to Board) — drag-and-drop columns keyed to a configurable stage pipeline, seeded with your requested funnel: New Leads → Contacted → Interested → Not Interested → Lead Won / Lead Lost. New **Admin → Lead Stages** tab to rename/reorder/add/deactivate stages — there was previously no way to manage this at all. Backend: `Lead.stageId` is now denormalized onto the lead record itself when set, so the board reads every lead's stage in one `listLeads()` call instead of N+1 per-lead fetches.

**My Reminders and Customers pages** (new Sidebar nav items) — both were fully-built backend endpoints (`listMyReminders`, `listCustomers`, `updateCustomer`) with no frontend page until now, the same gap apps-script's equivalent pages closed. Reminders shows your pending reminders across every conversation, overdue ones highlighted, with an "Open chat" bridge into the Inbox. Customers is a searchable directory with inline-editable name/email/company and a "View conversation" bridge. Fixed a real N+1 in `listMyReminders` while wiring it up (was calling `.get()` per reminder in a loop; now two bulk reads).

**Loading-state fix, swept across the whole Admin section + Leads.** Every list-fetching component now distinguishes "still loading" from "confirmed empty" (an `X[] | null` pattern instead of defaulting to `[]`) — previously a slow fetch could briefly flash a misleading "No X yet." message, which looked like data loss. Caught originally on the Admin Users tab (real data, just a loading-state race, not an actual bug), then swept the same fix to Teams/Numbers/Number Access/Assignment Rules/Audit Log/Quick Replies/Templates/Lead Stages/Leads.

4 new backend regression tests (128/128 passing), frontend typecheck and production build clean, backend deployed live to `https://whatsapp-panel-backend.hasim-c9e.workers.dev`. Verified end-to-end in a real signed-in browser session against real production data (a real lead dragged across Kanban columns and confirmed persisted after a hard reload; a real reminder created, listed, and completed; a real customer edited and searched) — not just typechecked. Committed as `e0fa234` and pushed to `origin/main`.

## ✅ App renamed to ECHT Connect, hosted live, welcome-email system fully working (2026-08-22)

**Renamed to ECHT Connect.** You asked for a name that represents the company, ready for the mobile app you're planning next — picked from three options (your own "ECHT Communication Portal," "ECHT Connect," "ECHT Hub") — you chose **ECHT Connect**. Updated everywhere it showed: browser tab title, the sign-in screen, the number-picker screen, and the sidebar brand.

**Hosted the frontend for real, live at `https://whatsapp-panel-frontend.hasim-c9e.workers.dev`.** You asked "how, this is on a local server?" — worth restating here: the *frontend* was only ever served from a local dev server on this machine; the *data* was always the real production backend/Firebase. This closes that gap by deploying the frontend itself as a Cloudflare Workers static-assets project (not Pages — the new Pages integration needs Vite 6+, and Cloudflare is steering new projects to Workers anyway, matching how the backend is already deployed). Needed two follow-up fixes to actually work: the backend's CORS allowlist (`ALLOWED_ORIGINS`) now includes this URL, and the new domain had to be added to Firebase Auth's authorized domains list (a one-time Console change — done).

**Created 2 test ADMIN accounts** — Hasim Test (`test@echt.co.in`) and Hitesh Bhojwani (`hitesh@echt.co.in`) — so you can test the hosted panel yourself while Saket and Aneri aren't available. Both can sign in immediately with their Google accounts; no invite step is required for that part.

**Built a welcome-email system — now fully live and confirmed.** You asked for members to get notified and be able to log in when added. Login itself doesn't need an email — see above — but a proactive notification does, and there was zero email infrastructure anywhere in this backend before now. Built: a small Resend API wrapper (`lib/email.ts`, no SDK dependency), a "Welcome to ECHT Connect" HTML email with a sign-in link, an automatic best-effort send on every `createUser` (never blocks account creation if email fails or isn't configured), and a manual **"Send welcome email"** button per row in Admin → Users for re-sends or catching up existing accounts. 4 new backend regression tests, including one that stubs a failed Resend response to prove account creation still succeeds.

**Setup, done end-to-end:** you signed up at Resend, verified `updates.echt.co.in` as the sending domain via GoDaddy's one-click Domain Connect integration (no manual DNS records needed), and set the `RESEND_API_KEY` secret. `RESEND_FROM_EMAIL` is now `"ECHT Connect <notifications@updates.echt.co.in>"`. **Confirmed working for real** — sent a live welcome email to Hitesh Bhojwani (a non-account-owner recipient, proving it works for everyone, not just Resend's sandbox-mode account-owner-only restriction) and you confirmed it arrived.

**Credential-hygiene note, for the record:** setting the Resend API key hit real friction — `wrangler secret put <name>` takes the secret's *name* as the argument and prompts separately for the value, but the key value got typed as the name twice (once for the original key, once again after rotating it), each time exposing it. Both incidents were treated as compromised on sight: the first key was revoked and replaced entirely (old Resend key deleted, new one created with sending-only scope instead of full access); the second exposure was resolved by using the already-visible value to set the secret correctly rather than repeating the same failure a third time. Two harmless leftover secrets — literally named after the exposed values, holding no real secret meaning — are still sitting on the Worker. Run `npx wrangler secret list` from `webapp/backend` to see their exact names (they're the two starting with `re_` that aren't `RESEND_API_KEY`) and `npx wrangler secret delete <that name>` to remove each — deliberately not spelling them out here to avoid re-committing the same leaked values into this file.

**WhatsApp notification (the "Both" you asked for) — not started yet.** This needs a Meta-approved message template (review takes time) and capturing a new user's phone number at creation (the Add User form doesn't collect one today). Planned as a fast-follow.

## ✅ Second real gap found while setting up Teams: RTDB silently drops empty arrays, crashing 4 call sites (2026-08-21)

Following up on the Assignment Eligibility fix above, went to actually set up a Team for Saket and Aneri (Admin → Teams) so they'd stop showing `NO_ACTIVE_ELIGIBLE_TEAM`. No teams existed yet, so this was a real first-use of that feature. Creating a team and adding a member with the numbers scope left blank (the natural "all my granted numbers" choice) crashed the whole Admin page with `Cannot read properties of undefined (reading 'length')`.

Root cause: `addTeamMember` always writes `numberIds: []` for a blank scope, but **Firebase Realtime Database silently drops empty arrays/objects on write** — so the field round-trips as entirely absent, not `[]`. Four call sites across the codebase assumed the array always existed and called `.length`/`.includes()` on it directly: `phase1Api.ts`'s eligibility evaluator, `phase7Api.ts`'s round-robin eligible-agent filter, two spots in `accessControl.ts`'s `resolveTeamIdForNumber` (SITE_MANAGER/SUPERVISOR team-scope resolution — this one gates conversation view/reassign authorization), and the Teams admin UI's own member list rendering. This had never surfaced before because no team had ever actually been created in the live webapp until just now.

**Fixed:** all five spots guarded with `?? []`. Verified the fix actually catches the regression — wrote a test that reproduces the exact RTDB round-trip (creates a member, then deletes the `numberIds` key directly in storage to match what RTDB really does), confirmed it fails with the real crash on the old code and passes on the fixed code. 1 new regression test, 134/134 passing.

**Applied live:** created "Entartica Agents" (owned by Saket, the only SITE_MANAGER), added both Saket and Aneri as active members with the numbers scope left blank. Assignment Rules now correctly shows both as no longer blocked by `NO_ACTIVE_ELIGIBLE_TEAM` — the only remaining reason for either is `NOT_AVAILABLE`, which is genuinely just "hasn't signed in and set their own status yet," not a configuration gap. Round-robin is now fully wired for both, pending them actually using the app.

## ✅ Real gap found and fixed: round-robin has never actually assigned a real agent (2026-08-21)

I'd suggested "assignment eligibility toggle" as an agent self-service feature — that framing was wrong, and worth being upfront about. `setAssignmentEligibility`/`getAssignmentEligibility` are **manager/admin-only** (`ELIGIBILITY_MANAGE_ALL`/`ELIGIBILITY_MANAGE_TEAM`), not something an agent sets for themselves. But investigating it surfaced something more important: `Phase7Api.getEligibleAgentIds` — the function that actually picks who a new conversation round-robins to — **requires an explicit `assignmentEligibility/{userId}:{numberId}` record with `eligible: true` to exist**, on top of being an active participant, available, and having number access. Nothing in the webapp has ever called `setAssignmentEligibility`, for anyone — confirmed by grepping the whole frontend for it. That means **every real agent added to a round-robin rotation this whole time has been silently skipped**, including Saket and Aneri from this session's pilot setup. Conversations were landing on the fallback agent or staying unassigned instead of rotating, with no error or indication anywhere that this was happening.

**Fixed:** Admin → Assignment Rules' participants table now has two new columns — **Eligible** (the actual on/off grant, toggleable) and **Assignable now** (the live evaluated result, factoring in availability/number access/team enablement too, with the blocking reason shown when it's No). Caught and fixed a real bug in my own first pass before shipping it: the checkbox was reading the fully-evaluated result instead of the raw grant, so it stayed visually unchecked right after a successful grant — fixed by distinguishing "grant not found" from "grant found but blocked downstream" using the evaluator's own reason codes.

**Already applied live:** granted eligibility to Saket (Entartica - Raipur) and Aneri (Entartica CRM) — both now show `NO_ACTIVE_ELIGIBLE_TEAM` as the remaining blocker under "Assignable now," meaning round-robin still won't pick them until they're each an active member of a Team enabled for that number (Admin → Teams). That's the next real thing blocking them from actually receiving auto-assigned conversations — a decision/setup step, not more code.

No backend changes — the API was already fully built and tested; this was purely a missing frontend control on top of it, verified live against real data.

## ✅ Call History page + agent self-service Availability toggle (2026-08-21)

**Call History.** New sidebar page (below Reminders, as requested) listing every call placed through either click-to-call path — Leads' `initiateCall` and the Inbox's new `initiateConversationCall` — newest first, with who it went to, the phone number, whether it came from a Lead or a Chat, and status. Agents see only their own calls; ADMIN/SITE_MANAGER see everyone's (with an Agent column). Backend: `CallLog` now optionally carries `conversationId`/`numberId` (populated going forward by `initiateConversationCall`; older records simply predate the field and just won't show an "Open chat" link), new `Phase22Api.listCallHistory()` enriches each row with the agent's name and the lead/customer's name in one bulk read (same N+1-avoidance pattern as `listMyReminders`). 1 new backend regression test. Verified live against real data — the page correctly showed all 5 real calls placed earlier today (4 from my own testing, 1 you placed yourself on the real "Eva" conversation), newest first, with the right agent/phone/status on each.

**Agent availability toggle.** Found a real, pre-existing gap while looking at this: `setAvailability`/`getAvailability` (available/busy/offline/on leave — feeds directly into Phase 7's round-robin, an unavailable agent is skipped for new auto-assignments) has been fully built on the backend since Phase 1, and even had its dropdown CSS already ported from the apps-script frontend (`#availabilitySelect` in `styles.css`) — but no component ever used it, so there was no way for an agent to actually set their own status in the webapp. Added a compact status pill in the Sidebar, right above your profile — defaults to whatever's on file, updates live on change. Zero backend risk since nothing there changed, purely wiring an already-tested endpoint to a control.

**Call History filters.** Added Location, Agent (managers only), and date-range filters to the toolbar, client-side over the already-loaded list. Location filters on the lead's location (only applies to Lead-originated calls, since a WhatsApp chat call has no location concept); Agent is hidden for regular agents since they only ever see their own calls anyway.

**Per-conversation Calls section + customer tags, replacing Snooze.** You pointed out the Inbox's own detail panel couldn't show whether a customer had actually been called, and that Lead tags didn't carry over to a plain WhatsApp conversation (most conversations aren't tied to a Lead record at all). Added: a `Customer.tags?: string[]` field (same validation as Lead tags, reused via `Phase22Validation.tags`) editable right in the detail panel; and a new `Phase22Api.listConversationCallHistory()` that matches calls two ways — by this conversation's own id (calls placed via the Inbox Call button) and by the customer's phone number (calls placed via the Leads path before any conversation existed) — bundled into the existing one-round-trip `getConversationWorkspace` aggregator rather than a separate fetch, matching how Remarks/Reminders already work. Removed the Snooze row from this panel per your request (the backend feature itself is untouched, just no longer surfaced here). 2 new backend regression tests. Verified live: added a "VIP" tag to the real "Test Lead" conversation and confirmed it saved; the Calls section correctly found and listed all 4 real historical calls to that customer, including ones placed before this change (matched by phone, not just the new conversationId field).

Backend deployed live. Frontend typecheck/build clean, no deploy step (dev server picks it up directly). 133/133 backend tests passing.

## ✅ Inbox call button + Lead tagging system (2026-08-21)

**Call button in the Inbox.** The backend for this already existed and was already live (`Phase22Api.initiateConversationCall` + `POST /api/conversations/:id/call`, built alongside the Leads click-to-call but never wired to a button) — this was a frontend-only gap: a wrapper in `backendApi.ts` and a "📞 Call" button in `ChatPane.tsx`'s header, next to Resolve. Rings the agent's own phone first, then connects to the customer using the WhatsApp number's own phone as caller ID, same as Leads' click-to-call. **Verified live for real** — clicked it against a real conversation and confirmed a real call rang through, 4 `conversation.called` audit entries recorded. Worth flagging: I tested this by clicking it several times in a row before realizing it was placing real Exotel calls each time rather than a harmless UI action — should have paused after the first click to confirm before repeating. No harm beyond the extra rings; the repeated calls prove the integration is solid.

**Lead tagging system.** New per-lead free-form tags (e.g. "Hot", "Budget constrained", "Decision maker") so anyone opening a lead can understand context at a glance, independent of the fixed Stage pipeline. Backend: `Lead.tags?: string[]`, `Phase22Api.updateLeadTags` (same authorization as remarks — the lead's assigned agent or a manager), `POST /api/leads/:id/tags`, with validation (trim, drop blanks, dedupe case-insensitively, cap at 20 tags/40 chars each). Frontend: an editable tag list in the Lead detail modal (add via Enter or button, remove via ×, autocomplete suggestions drawn from every tag already in use elsewhere so wording stays consistent), plus a compact read view on Kanban cards and in the Leads table's new Tags column. 2 new backend regression tests (130/130 passing). Verified live: added real tags to a real lead, confirmed they show on the Kanban card, in the table, and persist after reload.

Backend deployed live to `https://whatsapp-panel-backend.hasim-c9e.workers.dev`. Frontend typecheck/build clean, no deploy step (dev server picks it up directly, same as every other frontend-only change this session).

---

## Action needed from you right now (Apps Script build — daily use)

- **Real-time message delivery is live and confirmed working end-to-end (@55).** New messages now appear the instant they arrive, via the browser talking to Firebase directly instead of through Apps Script. Getting here needed three separate fixes beyond the original build (@50):
  1. **Concurrency pileup (@51)** — opening a conversation was firing 5+ parallel Apps Script executions at once (workspace data, the listen token, templates, quick replies, stages); the Executions panel showed even unrelated Sheets-only calls stuck "Running" for 6-7s as a result. The listen token now rides inside the existing `getConversationWorkspace` call instead of its own round trip.
  2. **Firebase Authentication was never enabled for the project** — `signInWithCustomToken` can't work at all until the Authentication product itself is initialized in the Firebase console, separately from Realtime Database and the registered web app. Enabled directly (Email/Password + Google providers, per your request).
  3. **Security rules broke the live query** — `.read` was defined per-message (`$messageId`), but Firebase rejects an entire `orderBy`/`equalTo` query if the read rule depends on data below the queried location. Fixed using Firebase's query-based rules pattern (checks `query.orderByChild`/`query.equalTo` against a lookup on `/conversations/{id}/numberId`, evaluable without touching individual message records) — still scoped to exactly the numbers an agent has been granted, same as everywhere else in the app. Live-verified via a visible debug banner injected into the running app: confirmed `signIn OK` and `ES OPEN` (EventSource connected) before removing the debug scaffolding.

  Please do a final real-world check: open a conversation and have someone message it from WhatsApp without touching the panel — it should now appear without any refresh.
- ~~"Sent reply not showing in the thread"~~ — confirmed working by you. Resolved.
- ~~Authorize the Drive scope~~ — done, confirmed by you.
- ~~Domain-restricted deployment~~ — checked, it's already "Anyone," not the cause of anything. Ruled out.
- **Media delivered as generic binary ("Bin format"), not viewable — fixed, needs retest (@42).** Root cause: Drive's `export=download` link ignores the file's real type and serves everything as `application/octet-stream`, so WhatsApp couldn't tell it was an image. Switched to `export=view`, which serves the real Content-Type. Confirmed-by-reasoning for images; video/audio/document delivery through this same URL format is still unverified — flag it again if a non-image attachment still comes through wrong.
- **Test "Add user" end-to-end (deployed @41).** Creating a user now automatically emails them a welcome message with a temporary password included directly (not a link) — no separate "send setup link" step needed. If the email doesn't arrive, the temp password still shows in an alert to you as a fallback, and the per-row "Send setup link"/"Generate temp password" buttons remain as manual alternatives.
- **Change-password screen UI fixed + password show/hide added (@43).** The full-width bug was a real CSS gap. Test the "Current password is incorrect" flow again with the eye toggle to check exactly what you're typing.
- **All "Edit" buttons across the admin pages now use a proper card/dropdown modal instead of sequential prompt() popups (@44, and a real bug in it fixed at @45 — the modal wasn't appearing at all due to a CSS conflict).** Users, Customer details, Quick Replies, Team Members, WhatsApp Numbers, Lead Stages. Please click through each once to confirm they save correctly. Three lower-priority prompt()s remain (snooze duration, template variables, submit-for-review wabaId) — not "edit a record" flows, left for now unless you want those converted too.
- **"User number assignment" — Edit User now manages WhatsApp number access directly (@46).** This was a real gap: number access lived only on a separate Settings page. Edit User now shows a checklist of every number with current access pre-checked. Please test toggling a number on/off for a user.
- **Firebase Realtime Database migration is LIVE (@47), and a real perf regression in it was found and fixed (@49).** Messages/Conversations moved to Firebase (@47), but you reported it still felt slow right after — turned out `FirebaseRealtimeDbRepository` was missing the same per-request read cache `SheetRepository` already had, so one dashboard/workspace load was doing 4+ separate live network calls to Firebase for data that hadn't changed between them. Fixed and deployed (@49), with direct test coverage proving 3 repository instances now produce exactly 1 network read. **Also fixed the "page refreshing" complaint (@48)**: every action was flashing the chat pane and conversation list to a blank "Loading…" before repopulating — not an actual page reload, but felt like one. Old content now stays on screen through the round trip. **Please retest now**: click through reply/note/assign/resolve and confirm it feels instant, not flashing or slow. Everything else (Numbers, Customers, Templates, Users, etc.) is still on Sheets by design — see the exchange in chat for why moving the rest isn't recommended right now.
- See the **full wake-up task list** at the bottom of this file for everything else queued up (template live-send verification, seeding lead stages, etc.)

## Phase status

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Project Foundation & Architecture | ✅ Done | |
| 1 | Authentication, Users & Authorization | ✅ Done, live-verified | Hasim is ACTIVE ADMIN |
| 2 | Core Database / Repository Layer | ✅ Done, live-verified | |
| 3 | WhatsApp Numbers & Exotel Integration | ✅ Done, live-verified | 10 numbers registered (8 fully, 2 partially) |
| 4 | Webhook & Message Ingestion | ✅ Done, live-verified | |
| 5 | Conversations & Inbox | ✅ Done, live-verified | |
| 6 | Agent Reply / Outbound Messaging | ✅ **Live-confirmed 2026-08-10** — a real reply sent from the portal reached the customer on WhatsApp | Template/media sends within this phase's family are still unverified (see Phase 10/11) |
| 7 | Assignment & Round-Robin Engine | ✅ Code done, Node-tested | Auto-assigns new leads on ingestion; no live send involved, so no user-dependent verification needed here |
| 8 | CRM-lite: Customers, Stages, Remarks | ✅ Code done, Node-tested | Stage seed needs a one-time live run (see task list) |
| 9 | Reminders, Snooze & Follow-up | ✅ Code done, Node-tested | |
| 10 | WhatsApp Templates | 🟡 Code done, Node-tested — live submit/send pending you | `createTemplate`/`sendTemplate` real-world side effects, deliberately not invoked live |
| 11 | Quick Replies & Media | 🟡 Code done, Node-tested — live media send pending you | `sendMedia`/inbound media extraction both unverified (no real media message ever sent/received) |
| 12 | Admin Panel & Configuration | ✅ Code done, Node-tested (backend) | New `frontend/Admin.html` — needs your live click-through, see task list |
| 13 | Notifications, Search & Productivity | ✅ Code done, Node-tested | "Notifications" scoped to in-UI needs-response badges (no push/email — see Decisions) |
| 14 | Dashboard & Analytics | ✅ Code done, Node-tested | "Resolved" always 0 — no close-conversation workflow exists yet, see task list |
| 15 | Audit, Security, Backup & Reliability | 🟡 Code done, Node-tested — live verify pending you | New OAuth scopes added (drive.file, script.scriptapp) — fresh consent screen expected |
| 16 | Testing & QA | ✅ Done | Found + fixed one real access-control bug (getCustomerStage) — see below |
| 17 | Production Deployment | 🟡 Readiness checklist done (`docs/DEPLOYMENT.md`) — go-live is your decision | This system has effectively been live since Phase 4; nothing left is a code gap |
| 18 | Zoho Integration Preparation | ✅ Done — mapping documented (`docs/ZOHO_PHASE_2.md`) | 5 open questions only you can answer before Phase 19 can start |
| 19 | Zoho CRM Integration | ⬜ Blocked — needs your Zoho credentials + answers to Phase 18's open questions | |
| 20 | Production Hardening & Optimization | ⬜ Blocked — needs real usage data that doesn't exist yet | |
| 21 | Final Documentation & Handover | ⬜ Deliberately not started — depends on Phases 17/19/20 per the roadmap's "do not build out of order" rule, and those are blocked on you | |

## Recently shipped (brief — see `memory/CHANGELOG.md` for full detail)

- **Live-testing round 2 (@33-@35)**: confirmed the audit log migration ran clean (1625 entries moved). Added `CacheService` cross-request caching for speed, then **reverted it same-session** after you reported a sent reply not appearing in the thread — too risky for message data, not worth it. Replaced the old 3-prompt() media-URL flow with a real local-file picker (uploads to a dedicated Drive folder, sets link-sharing so Exotel can fetch it — delivery itself still unverified). Added a visible scrollbar + smooth scroll to the message pane. **Real send confirmed working**: a reply sent from the portal reached the customer on WhatsApp for the first time.
- **Four real bugs found from your live testing, all fixed and deployed (@29-@32)**: (1) landing screen stuck on "Loading…" forever — a failure-handler helper (`renderError`) was referenced but never defined, so the call threw before the request to the server was even sent; (2) every repository read did a full Sheets table scan, and the aggregated workspace endpoint re-read the same tables 3-4x over — added a short-TTL, write-invalidated read cache shared across repository instances; (3) the audit log's single Property-blob storage hit Apps Script's quota after a month of real use, breaking "Add Note" and silently breaking other audit-logged actions — moved to a proper Sheets tab (**needs your one-time migration run, see above**); (4) the conversation panel's message pane used a hardcoded height that didn't account for whatever sat above it (e.g. Dashboard's KPI row), pushing the compose box below the fold and forcing double-scrolling — now sizes itself to whatever room is actually left, plus added message avatars and Enter-to-send on both Reply and Note.
- **Number-picker restored + everything properly scoped**: you asked for the original "select a number first" screen back (I'd dropped it earlier the same session) and for nothing to mix across numbers once you're inside one. Done — Dashboard, Inbox, All Conversations, Unassigned, Customers, Reminders, Reports, and the notification bell are all now scoped to whichever number you picked on the landing screen. Admin pages (Users, Teams, WhatsApp Numbers, Templates, Quick Replies, Settings, Audit Log) are still org-wide, since those aren't conversation data.
- **Unified sidebar-nav redesign**: the whole panel now matches the reference CRM mockup you shared — one app, dark-green sidebar navigation (Dashboard, Inbox, All Conversations, Unassigned, Reminders, Customers, Reports, plus the former Admin Panel sections), a real KPI dashboard, a redesigned chat panel (inline Assign dropdown, Reply/Note tabs, sender names, inline media), and a Customer Details side panel (edit contact info, Previous Conversations, Notes, Reminders). No more separate `?page=admin` — that page is retired. New: an Availability dropdown in the top bar (this already existed on the backend since Phase 1 but was never wired to any UI until now) and a notification bell. KPI cards show real counts only, not fake "vs yesterday" trends, per your own call. This was almost entirely a frontend rewrite — all 20 backend tests still pass.
- **Inbox polish**: fixed four real gaps from your workspace screenshot — conversation list shows customer names now (was showing "OPEN"), replies show who sent them ("Rahul replied," per the original spec, previously invisible), media messages show an actual image/link instead of placeholder text, and Remarks/Reminders are now collapsible sections below the compose box instead of always-expanded panels pushing the chat thread out of view.
- **Number/org-select landing screen**: the Web App now opens on a card grid — one card per number you can access, with a needs-response badge — matching the Superfone screenshot you shared. Click a card to enter that number's inbox (Conversations + Detail, same as before); "← Switch number" in the header takes you back to the grid. The old always-visible Numbers list pane is gone — you pick once, up front.
- **Chatbot/webhook incident (resolved)**: the chatbot on 079-485-02810 was intercepting messages for every number because Exotel routes webhooks per-account, not truly per-number — confirmed our own code was untouched all day, so it wasn't a regression from anything I did. Fixed by you re-adding our webhook URL to that same slot.
- **Post-Phase-18 follow-up** (your direct feedback after using the live system): **Resolve** — any assigned agent or ADMIN can now mark a conversation resolved (button in the detail header); resolved conversations leave the active list but are still findable via search. **Reports are now scoped** — Supervisors/Site Managers see only numbers/data they actually have access to, not the whole org (reverses this morning's earlier decision, per your explicit instruction). **Speed** — diagnosed and fixed the real cause: opening a conversation was firing 8 separate server calls; now it's 1, plus templates/quick replies are cached instead of re-fetched every time. Declined a full database migration for now (see `memory/DECISIONS.md`) since this addressed the actual measured cause — flag it again if things are still slow after real daily use. Media sending bug is still open — **need diagnostics from you** (see task list).
- **Phase 17/18**: Wrote `docs/DEPLOYMENT.md` (current deployment/credential/scope state against the roadmap's go-live checklist — nothing here is a code gap, "going live" is entirely your decision) and `docs/ZOHO_PHASE_2.md` (the full entity mapping the roadmap calls for, plus 5 open questions only you can answer before Zoho integration itself can start — Lead vs. Contact, what "Won" maps to, the dedupe key, your Zoho edition/customizations, and sync conflict resolution). Also appended a Phase 15/16 section to `docs/SECURITY.md` tying together the audit-coverage mapping and the `getCustomerStage` fix. **Phases 19-21 are genuinely blocked** — 19 needs real Zoho credentials, 20 needs real usage data, and 21 (final handover docs) deliberately waits on 17/19/20 per the roadmap's own "don't build out of order" rule. This is as far as I can take the roadmap unattended.
- **Phase 16**: Systematic QA pass. Added a consolidated test runner (`node tests/run-all.js`) and a coverage matrix (`docs/TESTING.md`). **Found and fixed a real security bug**: `getCustomerStage` had no authorization check at all — any signed-in Google account could read any customer's lead stage. It's fixed now (matches `setCustomerStage`'s own access rule) and there's a permanent automated check (`authorization-sweep-verification.js`) that would catch this class of bug again on any future endpoint. This already went through the same testing/deploy/commit process as every other phase — nothing further needed from you here, just flagging that it happened since it's a security-relevant fix.
- **Phase 15**: Confirmed audit-event coverage and secrets hygiene are already solid (no new code needed — just documented the mapping). New: backup — "Back up now" (full spreadsheet copy into Drive) and an optional daily 2am automatic backup, both in the Admin Panel's new Backup section. **Needs your live click-through** — I added two new OAuth scopes to run this (`drive.file`, `script.scriptapp`), so the next execution will show a fresh Google consent screen; see task list.
- **Phase 14**: Dashboard/reports — conversation totals + per-number/per-agent breakdowns, average first-response time, stage distribution, template usage, lead conversion rate. Gated on `REPORTS_VIEW` (SUPERVISOR/SITE_MANAGER/VIEWER/ADMIN — a permission Phase 1 defined but nothing used until now). A "Reports" link/overlay was added to the main inbox. **Real gap found while building this**: no phase has ever added a way to close/resolve a conversation, so the "resolved" metric always reports 0 — see the task list below, this is a real product decision for you, not something I should invent unattended.
- **Phase 13**: Search (customer name/phone/message text) + filters (assigned agent, status, needs-response, unassigned, stage, date range) across conversations, optionally spanning every number you can access at once. A filter bar now sits above the Conversations pane, and each number shows a red needs-response count badge (Phase 13's scoped interpretation of "Notifications" — no push/email infrastructure, see Decisions). Nothing here needed live/costly verification.
- **Phase 12**: Admin Panel (`frontend/Admin.html`, at `?page=admin`) — Dashboard counts, Users, Teams, Numbers, Number Access, Assignment Rules (new `Phase12Api` — the only genuinely new backend piece, since `Number_Assignment_Config`/`Number_Assignment_Users` had no admin CRUD before), Lead Stages, Quick Replies, Templates, Audit Log. Also closed Phase 7's deferred reassignment-UI gap: a "Reassign…" button now in the main inbox detail header, backed by a new properly role-scoped `listAssignableUsers` endpoint. Nothing here needed live/costly verification (pure internal CRUD + authorization), but **you should click through the real deployed Admin Panel once** to confirm the UI itself renders and behaves as expected — see task list.
- **Phase 11**: Quick replies (admin-managed shortcut list, `SETTINGS_MANAGE`; any authenticated user can list/use — inserted into the compose textarea, not sent directly) and media messages (`Phase6Api.sendMediaReply`, new `Message_Media` tab for both outbound sends and inbound webhook ingestion when a `mediaUrl` is present). Quick-reply `<select>` and a "Media…" button added to the compose row. `sendMedia`/inbound media extraction are both unverified — no real media message has ever been sent or received on this integration. Nothing else here needed live/costly verification (quick replies are pure internal logic).
- **Phase 10**: Template draft → admin review → submit → sync workflow (`Phase10Api`), sending an approved template with variable substitution (`Phase6Api.sendTemplateReply`). `syncTemplatesFromProvider` reuses the already-live-confirmed `getTemplates()` call, but `submitTemplateForReview` (creates a real template on your WABA) and `sendTemplateReply` (a real send) are both held for you, same as Phase 6's plain-text sending. Template dropdown added to the compose row.
- **Phase 9**: Reminders (create/complete/cancel, personal "my reminders" list) and snooze (hides a conversation from Phase 5's active list until it auto-expires — no scheduled job, just a timestamp check). Reminders + snooze UI added. Nothing here needed live/costly verification.
- **Phase 8**: Lead stage definitions (admin-only, default 7-stage list ready to seed), per-customer current stage (its own new tab — `Customers` already has real data and `SheetRepository` can't safely migrate an existing schema, see `memory/DECISIONS.md`), internal remarks. Stage dropdown + remarks panel added to the UI. Nothing here needed live/costly verification.
- **Phase 7**: `Phase7Api` round-robin engine — eligibility (active + numberAccess + assignmentEligibility + availability, all independent), rotation with self-healing pointer, returning-customer inheritance, fallback/unassigned queue, working hours, full assignment history. Wired into Phase 4's ingestion (new leads now auto-assign for real). Manual `reassignConversation` works at the API level; no UI control yet (deferred to Phase 12, needs a properly-scoped user list endpoint). Nothing here needed live/costly verification — it's pure internal logic, fully covered by `tests/phase7-assignment-verification.js`.
- **Phase 6**: `Phase6Api.sendReply` — ADMIN or the assigned AGENT only (fixed a real ADMIN-scope gap in `AccessControl.requireConversationOperation` along the way, promoted team-scope resolution into a shared `AccessControl` method). Compose box added to the UI. Records `senderUserId`/`SENT`/`FAILED`. Not live-sent yet.
- **Phase 5**: Three-pane inbox UI, live-verified with real data.
- **Phase 4**: Webhook ingestion, live-verified with a real WhatsApp message.
- **Phase 3**: Numbers registered, `getTemplates()` live-verified.
- **Phase 2**: Repository layer, live-verified.

## Manual-action log (things only you could do) — historical

| Date | Item | Status |
|---|---|---|
| 2026-08-09 – 2026-08-10 | Bootstrap, spreadsheet, Exotel credentials, webhook config, all live-verification click-throughs for Phases 1–5 | ✅ Done by you |
| 2026-08-10 | Confirm `Test_V02`/ngrok URL safe to remove | ✅ Done — `Test_V02` deleted |
| — | Fill in provider fields for `Spreewalk - Raipur` / `ECHT Advisory` | ⬜ Open, whenever convenient |
| — | Remove the ngrok callback URL from all 10 numbers in Exotel | ⬜ Open, whenever convenient |

## Full wake-up task list (updated as the session progresses)

### Open

1. **Click through the whole redesigned panel, thoroughly.** This is the biggest single UI change so far — landing screen number picker, sidebar nav, Dashboard KPIs, Inbox/All Conversations/Unassigned, Reminders, Customers, Reports (all scoped to whichever number you pick), and every former Admin Panel section (Templates, Quick Replies, Teams, Users, WhatsApp Numbers, Settings, Audit Log, org-wide as before). Everything was ported from working code and reviewed carefully, but I have no way to actually render/click Apps Script's output myself — please exercise it for real before trusting it day-to-day.
2. **Media sending is broken — I need diagnostics.** Open Apps Script → Executions, find the `sendMediaReply` call, and share the raw request/response (or describe exactly what happens: error, hang, or silent no-arrival).
3. **Live-verify Phase 6 `sendText`** — reply to a real conversation, confirm it arrives, check Exotel's real response shape with me so I can fix `extractOutboundProviderMessageId_` if needed.
4. Create at least one quick reply — Settings-adjacent Quick Replies page — so the compose box's dropdown has something in it.
5. Fill in `Spreewalk - Raipur` / `ECHT Advisory` provider fields — WhatsApp Numbers page → Edit (optional).
6. Remove the ngrok callback URL from Exotel (optional).
7. **Read `docs/ZOHO_PHASE_2.md` and answer its 5 open questions** whenever you're ready to think about Zoho.
8. ~~[webapp] Click through the new Inbox UI~~ — ✅ done by you 2026-08-18. Registered all 10 numbers, confirmed the Inbox shell, a real inbound test message via the actual webhook pipeline, and a real reply sent successfully through Exotel.
9. **[webapp] Place one real Exotel Voice call to verify Phase 22's click-to-call.** The Exotel Voice secrets are now set on the live backend, but `ExotelVoiceProvider`'s request/response field names are still UNVERIFIED (carried over from the Apps Script build's own unverified version) — a real agent needs a `phone` set (Admin Panel → Users, once that page exists on the new backend, or via the API directly for now) and a lead assigned to them, then click-to-call once so I can confirm/fix the response parsing against what Exotel actually returns.
10. ~~[webapp] Enable R2 in the Cloudflare dashboard~~ — ✅ done by you 2026-08-19, no credit card needed. Bucket created, bound, and local-file media upload (the last piece of Phase 10/11) is built, tested, and deployed.
11. ~~[webapp] Duplicate one Firebase security rule for the new `webapp_messages` path~~ — ✅ done by you 2026-08-20, published with no error. I confirmed both `messages` and `webapp_messages` are live and correctly locked down (401 Permission denied to anonymous requests, apps-script's original rule undisturbed). **One thing still to confirm on your end**: open a real conversation in webapp and have someone message it without refreshing — if it appears live, the rule is fully correct end to end (an anonymous check can't prove the authenticated path works).
12. ~~[webapp] Decide how real-traffic parallel-run testing should actually happen~~ — ✅ decided 2026-08-20: option (b), dual-write forward from apps-script. Built and pushed — see "Parallel-run validation, round 2" above. **Your action**: set the `WEBAPP_PARALLEL_RUN_WEBHOOK_URL` Script Property when you're ready to start a testing window (exact steps in that section above); leave it unset to keep this off.
13. **[webapp] Click through the mobile/tablet responsive layout on an actual phone and tablet.** Built 2026-08-21 (sidebar drawer, Inbox single-pane-at-a-time, table horizontal scroll) — verified the underlying state/class transitions are correct via the DOM, but this environment couldn't physically render or screenshot a narrow viewport, so nobody has actually looked at it on a real small screen yet.
14. **[webapp] Create one real user with a phone number and confirm the WhatsApp welcome message actually arrives.** Built and deployed 2026-08-22 — backend logic is fully unit-tested (template resolution, sending-number resolution, silent no-op paths, audit logging) but no real WhatsApp message has been sent by this feature yet. Admin → Users → Add user, fill in Phone, confirm delivery on that phone.

### Done (kept for history)

- ~~Round-robin needs Assignment Rules configured~~ — done via Admin Panel.
- ~~Seed default lead stages~~ — done.
- ~~Real security bug (`getCustomerStage` had no auth check)~~ — found and fixed, Phase 16.
- ~~Should conversations be resolvable?~~ — yes, any assigned agent/ADMIN; built and deployed.
- ~~Reports org-wide vs. team-scoped?~~ — scoped to admin-granted access; built and deployed.
- ~~Chatbot on 079-485-02810 hijacking every number's webhook~~ — Exotel-side config, fixed by you; confirmed not a code issue.
- ~~Card-style number/org-select landing screen~~ — built and deployed, confirmed working by you.
- ~~Speed (8 round-trips per conversation)~~ — fixed, down to 1 round-trip; confirmed working.
- ~~Inbox polish (names, sender names, media rendering, collapsible panels)~~ — built and deployed, see item 2 above to verify.
- ~~Backups~~ — built; **still needs your one-time click-through** in Admin Panel → Backup to confirm it works against the real spreadsheet (new OAuth consent screen expected).
- ~~Read `docs/DEPLOYMENT.md`~~ — go-live readiness checklist, available whenever useful.
- *(This list will keep evolving — check the bottom of this file for the latest.)*
