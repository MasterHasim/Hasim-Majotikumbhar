# WEBHOOK

## Entry point

`doPost(e)` in `src/Phase4Webhook.gs` — the first and only HTTP entry point in the
project so far. Served by a dedicated Web App deployment (`Execute as: Me`,
`Access: Anyone`), separate from the domain-restricted `Test_V01` deployment reserved
for a future admin-panel UI. Apps Script always returns HTTP 200 from `doPost` (there
is no way to set a different status code); auth/parse/business errors are reflected in
the JSON response body, not the HTTP status.

## Authentication

There is no Google Workspace identity to check — Exotel is not a Google-authenticated
caller, so Phase 1's `AccessControl` doesn't apply here. Instead: a shared secret token
in the URL query string (`?token=...`), checked against Script Property
`WEBHOOK_SECRET_TOKEN` (`Phase4WebhookConfig` in `src/Phase4Domain.gs`) before anything
else runs. A missing or wrong token gets an `{"status":"error","message":"unauthorized"}`
body and no repository is touched.

## Flow

```
WhatsApp Customer → Exotel → Webhook (doPost) → ExotelProvider.processWebhook()
  → Phase4Api.ingestInboundMessage() → identify number → identify/create customer
  → find/create OPEN conversation → idempotent message store → update conversation
```

Idempotency: every inbound message is deduplicated on `providerMessageId`
(`MessageRepository.findOne`) before any write — a duplicate webhook delivery (retry)
returns `{duplicate: true}` immediately. The whole find-or-create sequence is wrapped
in a single `LockService.getScriptLock()` (not just each individual repository write)
so two near-simultaneous webhooks for the same customer can't create duplicate
customer/conversation records.

Status callbacks (delivery receipts for messages Exotel is told to send later, in
Phase 6) arrive on the same webhook. `Phase4Api.ingestInboundMessage` branches on
`normalized.direction`: anything other than `'INBOUND'` is treated as a status update
and applied to the matching message by `providerMessageId` if one exists, or is a
harmless no-op if not.

New conversations are created with `assignedUserId: ''` — round-robin assignment is
explicitly Phase 7's job, not Phase 4's.

## Unconfirmed

Exotel's real inbound webhook payload shape has not been live-verified as of this
writing (only outbound `sendText`-style requests and `getTemplates()` have been).
`doPost` logs the raw payload via `console.log` before parsing it specifically so a
real webhook delivery can be inspected in the Apps Script Executions panel and
`ExotelProvider.processWebhook()`'s parser corrected if it doesn't match reality — see
`memory/DECISIONS.md` for the outcome once this has actually happened.
