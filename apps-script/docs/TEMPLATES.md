# TEMPLATES

## Where

`Phase10Api` (`src/Phase10Services.gs`). `TEMPLATES_MANAGE` (create/edit/submit/sync)
is effectively ADMIN-only per Phase 1's existing role definitions; AGENT has
`TEMPLATES_USE` instead, for sending an already-`APPROVED` template via Phase 6's
`sendTemplateReply`.

## Workflow

```
createDraftTemplate (LOCAL_DRAFT)
  → updateDraftTemplate (only while LOCAL_DRAFT)
  → submitTemplateForReview → ExotelProvider.createTemplate → PENDING
  → syncTemplatesFromProvider → APPROVED / REJECTED / PAUSED / DISABLED (whatever Exotel reports)
```

A template can only be edited or (re-)submitted while `status: 'LOCAL_DRAFT'` — once
submitted it's out of local control until synced back.

## Sync

`syncTemplatesFromProvider(wabaId)` calls `ExotelProvider.getTemplates(wabaId)` — the
**confirmed live** call from Phase 3 — and upserts into `TemplateRepository`, matching
existing records by `providerTemplateId` so a re-sync doesn't create duplicates. The
response-parsing path (`raw.response.whatsapp.templates[].data`) uses the exact shape
confirmed live in Phase 3.

## Sending

`Phase6Api.sendTemplateReply(conversationId, templateId, variables)` requires
`status: 'APPROVED'`, substitutes `variables` into `{{1}}`, `{{2}}`, ... placeholders in
the template's `BODY` component (`substituteTemplateVariables_`,
`src/Phase6Services.gs`), then calls `ExotelProvider.sendTemplate`. Records an
`OUTBOUND` message with `messageType: 'template'` and a bracketed display text
(`[Template: name]`) rather than the full rendered body, same `SENT`/`FAILED` handling
as a plain text reply.

## Unverified — needs the user present

- `submitTemplateForReview` → `ExotelProvider.createTemplate`: creates a **real
  template on the user's WABA**, pending Meta's actual review. Real-world side effect,
  never invoked live this session.
- `Phase6Api.sendTemplateReply` → `ExotelProvider.sendTemplate`: same "real message,
  real cost" boundary as plain-text `sendText` (Phase 6) — request/response shape is a
  reasoned extrapolation, not live-confirmed.
- `syncTemplatesFromProvider` itself is comparatively low-risk (read-only against
  Exotel, using the already-confirmed `getTemplates` call) but still needs a live Apps
  Script execution this session couldn't perform unattended.

See `memory/DECISIONS.md` and `PROGRESS.md` for the exact queued follow-up items.
