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

const StatusCodes: Record<number, string> = { 30001: 'SENT', 30002: 'DELIVERED', 30003: 'READ' };

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
}

function extractInboundMediaUrl(content: { type?: string; [key: string]: unknown } | undefined): string | null {
  if (!content || !content.type) return null;
  const body = content[content.type] as { link?: string; url?: string } | undefined;
  if (!body) return null;
  return body.link || body.url || null;
}

export class ExotelProvider {
  constructor(private config: ExotelConfig) {}

  sendText(providerNumberId: string, toPhone: string, text: string) {
    return this.sendMessages([{ from: providerNumberId, to: toPhone, content: { type: 'text', text: { body: text } } }]);
  }

  sendMedia(providerNumberId: string, toPhone: string, mediaType: string, mediaUrl: string, caption: string) {
    const content: Record<string, unknown> = { type: mediaType };
    content[mediaType] = { link: mediaUrl, caption: caption || '' };
    return this.sendMessages([{ from: providerNumberId, to: toPhone, content }]);
  }

  sendTemplate(providerNumberId: string, toPhone: string, templateName: string, language: string, components: unknown[]) {
    return this.sendMessages([{ from: providerNumberId, to: toPhone, content: { type: 'template', template: { name: templateName, language: { code: language }, components: components || [] } } }]);
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

  /** Confirmed live 2026-08-10 against a real inbound Exotel WhatsApp Console webhook. */
  processWebhook(payload: { whatsapp?: { messages?: unknown[] }; message_sid?: string; status_code?: number; timestamp?: string }): NormalizedWebhookMessage {
    const message = payload?.whatsapp?.messages?.[0] as
      | { sid?: string; id?: string; message_sid?: string; from?: string; to?: string; timestamp?: string; profile_name?: string; content?: { type?: string; text?: { body?: string }; [key: string]: unknown } }
      | undefined;
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
