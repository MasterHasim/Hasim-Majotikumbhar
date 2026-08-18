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

## Confirmed live (2026-08-10)

Real inbound message payload shape (`incoming_message` callback):

```json
{"whatsapp":{"messages":[{"callback_type":"incoming_message","sid":"...",
  "from":"+91...","to":"+91...","timestamp":"...","profile_name":"...",
  "content":{"type":"text","text":{"body":"..."}}}]}}
```

Two corrections from the original best-effort guess:
- The message id field is **`sid`**, not `id`/`message_sid`.
- The `to` field is the **actual E.164 phone number** that received the message, not a
  separate provider-specific number ID. Number lookup in `Phase4Api` matches on the
  last 10 digits of `phoneNumber` (`normalizePhoneTail_`), not `providerNumberId` —
  the `providerNumberId` values captured in Phase 3 (Meta "Phone Profile" IDs) aren't
  what Exotel's webhook actually uses to identify numbers.

`profile_name` carries the sender's real WhatsApp display name and is now used to seed
a new customer's `name` field.

Every `doPost` call — successful or not — is also logged to the `Webhook_Debug_Log`
sheet tab (`logWebhookDebug_`), which is far easier to check than the Apps Script
Executions panel for calls that didn't originate from the editor's Run button.

**Still unverified**: status-callback payloads (delivery receipts) — triggering one for
real requires actually sending a message, which is Phase 6's job. `applyStatusUpdate_`'s
assumed field names (`message_sid`, `status_code`) have not been live-tested.
