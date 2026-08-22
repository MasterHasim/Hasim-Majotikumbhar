/**
 * Direct port of apps-script/src/Phase3Domain.gs (Phase3ExotelConfig) +
 * Phase3ExotelProvider.gs (ExotelProvider) — same confirmed-live base
 * URL/auth pattern, same webhook payload parsing (confirmed against a real
 * inbound Exotel webhook 2026-08-10), same status-code mapping. Fields
 * flagged UNVERIFIED in the source are carried over with the same flag —
 * they were never live-tested there either, and porting is not a live test.
 */
import { ApiError } from '../types';

export interface ExotelConfig {
  apiKey: string;
  apiToken: string;
  accountSid: string;
  subdomain: string;
}

export function requireExotelConfig(env: { EXOTEL_API_KEY?: string; EXOTEL_API_TOKEN?: string; EXOTEL_ACCOUNT_SID?: string; EXOTEL_SUBDOMAIN?: string }): ExotelConfig {
  const { EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_ACCOUNT_SID, EXOTEL_SUBDOMAIN } = env;
  if (!EXOTEL_API_KEY || !EXOTEL_API_TOKEN || !EXOTEL_ACCOUNT_SID || !EXOTEL_SUBDOMAIN) {
    throw new ApiError(500, 'CONFIGURATION_ERROR', 'Exotel credentials are not fully configured.');
  }
  return { apiKey: EXOTEL_API_KEY, apiToken: EXOTEL_API_TOKEN, accountSid: EXOTEL_ACCOUNT_SID, subdomain: EXOTEL_SUBDOMAIN };
}

/** 30017 (EX_MEDIA_UPLOAD_ERROR) confirmed live 2026-08-23 — Exotel/Meta rejected a degenerate
 * 1x1 test image; a real photo sent immediately after with the same code path arrived fine
 * (30001/EX_MESSAGE_SENT). Mapped to FAILED so a real rejection surfaces as FAILED in the Inbox
 * instead of getting stuck at whatever status the send itself first guessed. */
const StatusCodes: Record<number, string> = { 30001: 'SENT', 30002: 'DELIVERED', 30003: 'READ', 30017: 'FAILED' };

export interface NormalizedWebhookMessage {
  providerMessageId: string | null;
  fromPhone: string | null;
  providerNumberId: string | null;
  direction: 'INBOUND' | null;
  messageType: string | null;
  text: string | null;
  mediaUrl?: string | null;
  timestamp: string;
  profileName?: string | null;
  status: string | null;
  referral?: { headline?: string; body?: string; sourceUrl?: string; mediaType?: string; imageUrl?: string; videoUrl?: string } | null;
}

function extractInboundMediaUrl(content: { type?: string; [key: string]: unknown } | undefined): string | null {
  if (!content || !content.type) return null;
  const body = content[content.type] as { link?: string; url?: string } | undefined;
  if (!body) return null;
  return body.link || body.url || null;
}

/** Best-effort — UNVERIFIED, no real ad-click message has confirmed this shape yet (see
 * NormalizedWebhookMessage.referral's own doc comment). Extracts Meta's own documented
 * WhatsApp Cloud API "referral" object (present on an inbound message when a customer replied to
 * a Click-to-WhatsApp Facebook/Instagram ad) if Exotel forwards it at the same nesting level as
 * "content" on the message entry — never throws, never blocks ingestion if absent or shaped
 * differently than expected. */
function extractReferral(message: Record<string, unknown> | undefined): NormalizedWebhookMessage['referral'] {
  const r = message?.referral as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return null;
  const referral: NonNullable<NormalizedWebhookMessage['referral']> = {};
  if (typeof r.headline === 'string') referral.headline = r.headline;
  if (typeof r.body === 'string') referral.body = r.body;
  if (typeof r.source_url === 'string') referral.sourceUrl = r.source_url;
  if (typeof r.media_type === 'string') referral.mediaType = r.media_type;
  if (typeof r.image_url === 'string') referral.imageUrl = r.image_url;
  if (typeof r.video_url === 'string') referral.videoUrl = r.video_url;
  return Object.keys(referral).length > 0 ? referral : null;
}

export class ExotelProvider {
  constructor(private config: ExotelConfig) {}

  sendText(providerNumberId: string, toPhone: string, text: string) {
    return this.sendMessages([{ from: providerNumberId, to: toPhone, content: { type: 'text', text: { body: text } } }]);
  }

  /** Confirmed 2026-08-22 against developer.exotel.com/docs/whatsapp-api/api-reference/send-message:
   * "recipient_type" is required (same missing-field bug sendTemplate had), and "document" uses
   * "filename" rather than "caption". image/document shapes are confirmed live; video/audio follow
   * the same WhatsApp Cloud API convention (caption on video, no caption field on audio) but are
   * not separately confirmed in Exotel's docs — same "reasoned, not proven" flag as elsewhere. */
  sendMedia(providerNumberId: string, toPhone: string, mediaType: string, mediaUrl: string, caption: string) {
    const body: Record<string, unknown> = { link: mediaUrl };
    if (mediaType === 'document') {
      body.filename = caption || 'document';
    } else if (mediaType !== 'audio') {
      body.caption = caption || '';
    }
    const content: Record<string, unknown> = { recipient_type: 'individual', type: mediaType, [mediaType]: body };
    return this.sendMessages([{ from: providerNumberId, to: toPhone, content }]);
  }

  /** language.policy: 'deterministic' is required by Exotel's documented shape (developer.exotel.com/docs/whatsapp-api/api-reference/templates), confirmed 2026-08-22. */
  sendTemplate(providerNumberId: string, toPhone: string, templateName: string, language: string, components: unknown[]) {
    return this.sendMessages([{ from: providerNumberId, to: toPhone, content: { recipient_type: 'individual', type: 'template', template: { name: templateName, language: { code: language, policy: 'deterministic' }, components: components || [] } } }]);
  }

  private sendMessages(messages: unknown[]) {
    return this.request('POST', 'messages', { whatsapp: { messages } });
  }

  /** Confirmed live 2026-08-09: GET /v2/accounts/<sid>/templates?waba_id=<waba_id>. */
  getTemplates(wabaId?: string) {
    const path = `templates${wabaId ? `?waba_id=${encodeURIComponent(wabaId)}` : ''}`;
    return this.request('GET', path);
  }

  createTemplate(wabaId: string, definition: Record<string, unknown>) {
    return this.request('POST', 'templates', { waba_id: wabaId, ...definition });
  }

  async getMessageStatus(providerMessageId: string) {
    const response = (await this.request('GET', `messages/${encodeURIComponent(providerMessageId)}`)) as { status_code?: number } | null;
    const code = response?.status_code;
    return { providerMessageId, status: (code && StatusCodes[code]) || 'UNKNOWN', raw: response };
  }

  /**
   * Confirmed live 2026-08-10 against a real inbound Exotel WhatsApp Console webhook (the
   * "content" branch below). Confirmed live 2026-08-23 that delivery-status callbacks
   * (sent/delivered/read/failed for a message *we* sent) arrive in this SAME
   * whatsapp.messages[] array — not the separate flat message_sid/status_code shape this
   * code originally assumed — identified by "callback_type": "dlr". Real payload seen:
   * {"whatsapp":{"messages":[{"callback_type":"dlr","sid":"...","to":"+91...","exo_status_code":30001,
   * "exo_detailed_status":"EX_MESSAGE_SENT","description":"Message Sent","timestamp":"..."}]}}
   * — critically, "to" here is the CUSTOMER's number (who our message was delivered to), the
   * opposite of what "to" means on a genuine inbound entry (our own WABA number) — treating a
   * dlr entry as INBOUND would look up "to" as if it were our own number and always fail with
   * "No registered number matches", which is exactly the bug this branch fixes.
   */
  processWebhook(payload: { whatsapp?: { messages?: unknown[] }; message_sid?: string; status_code?: number; timestamp?: string }): NormalizedWebhookMessage {
    const message = payload?.whatsapp?.messages?.[0] as
      | { sid?: string; id?: string; message_sid?: string; from?: string; to?: string; timestamp?: string; profile_name?: string; content?: { type?: string; text?: { body?: string }; [key: string]: unknown }; callback_type?: string; exo_status_code?: number }
      | undefined;
    if (message?.callback_type === 'dlr') {
      return {
        providerMessageId: message.sid || message.id || message.message_sid || null,
        fromPhone: null, providerNumberId: null, direction: null, messageType: null, text: null, mediaUrl: null,
        timestamp: message.timestamp || new Date().toISOString(),
        status: (message.exo_status_code && StatusCodes[message.exo_status_code]) || 'UNKNOWN',
      };
    }
    if (message) {
      return {
        providerMessageId: message.sid || message.id || message.message_sid || null,
        fromPhone: message.from || null,
        providerNumberId: message.to || null,
        direction: 'INBOUND',
        messageType: message.content?.type || 'text',
        text: message.content?.text?.body ?? null,
        mediaUrl: extractInboundMediaUrl(message.content),
        timestamp: message.timestamp || new Date().toISOString(),
        profileName: message.profile_name || null,
        status: null,
        referral: extractReferral(message as Record<string, unknown>),
      };
    }
    if (payload && (payload.message_sid || payload.status_code)) {
      return {
        providerMessageId: payload.message_sid || null, fromPhone: null, providerNumberId: null,
        direction: null, messageType: null, text: null,
        timestamp: payload.timestamp || new Date().toISOString(),
        status: (payload.status_code && StatusCodes[payload.status_code]) || 'UNKNOWN',
      };
    }
    return { providerMessageId: null, fromPhone: null, providerNumberId: null, direction: null, messageType: null, text: null, mediaUrl: null, timestamp: new Date().toISOString(), status: null };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `https://${this.config.subdomain}/v2/accounts/${encodeURIComponent(this.config.accountSid)}/${path}`;
    const auth = btoa(`${this.config.apiKey}:${this.config.apiToken}`);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Basic ${auth}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (!res.ok) throw new ApiError(502, 'PROVIDER_ERROR', `Exotel request failed (${res.status}): ${JSON.stringify(parsed)}`);
    return parsed;
  }
}

/** Same tail-matching heuristic as apps-script/src/Phase4Services.gs's normalizePhoneTail_ — absorbs formatting differences (dashes, leading 0, +91 country code) between stored and incoming phone formats. */
export function normalizePhoneTail(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '').slice(-10);
}
