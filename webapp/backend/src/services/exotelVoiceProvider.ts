/**
 * Direct port of apps-script/src/Phase22ExotelVoice.gs — click-to-call for Phase 22
 * leads. Deliberately separate from exotelProvider.ts (WhatsApp) — Exotel's Voice API
 * is a different product on a fixed api.exotel.com domain (not the WABA v2 subdomain
 * exotelProvider.ts uses), so it gets its own credentials rather than assuming the
 * same account/subdomain covers both.
 *
 * UNVERIFIED: modeled on Exotel's public "Connect two numbers" / click-to-call docs
 * (POST /v1/Accounts/{sid}/Calls/connect.json, From/To/CallerId form params, Basic
 * Auth with API Key:Token) but not yet exercised against a real account — same
 * "confirmed vs. assumed" caveat exotelProvider.ts carries for its own unverified
 * methods. Do not trust the exact field names below until a real call has been placed
 * and the response shape checked against CallLog rows.
 */
import { ApiError } from '../types';

export interface ExotelVoiceConfig {
  accountSid: string;
  apiKey: string;
  apiToken: string;
  callerId: string;
}

export function requireExotelVoiceConfig(env: {
  EXOTEL_VOICE_ACCOUNT_SID?: string;
  EXOTEL_VOICE_API_KEY?: string;
  EXOTEL_VOICE_API_TOKEN?: string;
  EXOTEL_VOICE_CALLER_ID?: string;
}): ExotelVoiceConfig {
  const { EXOTEL_VOICE_ACCOUNT_SID, EXOTEL_VOICE_API_KEY, EXOTEL_VOICE_API_TOKEN, EXOTEL_VOICE_CALLER_ID } = env;
  if (!EXOTEL_VOICE_ACCOUNT_SID || !EXOTEL_VOICE_API_KEY || !EXOTEL_VOICE_API_TOKEN || !EXOTEL_VOICE_CALLER_ID) {
    throw new ApiError(500, 'CONFIGURATION_ERROR', 'Exotel Voice credentials are not fully configured.');
  }
  return { accountSid: EXOTEL_VOICE_ACCOUNT_SID, apiKey: EXOTEL_VOICE_API_KEY, apiToken: EXOTEL_VOICE_API_TOKEN, callerId: EXOTEL_VOICE_CALLER_ID };
}

export interface ConnectCallResult {
  callSid: string | null;
  status: string;
  callerId: string;
  raw: unknown;
}

export interface CallStatusEvent {
  callSid: string;
  status: string;
  duration: number | null;
  recordingUrl: string | null;
  raw: unknown;
}

/** Parses whatever Exotel POSTs to the StatusCallback URL connectCall registers. UNVERIFIED
 * against real traffic, same caveat as the rest of this file — field names are checked
 * against every plausible alias (Exotel's own docs and the Twilio-style convention this API
 * was modeled on don't fully agree on naming), so the first real callback has the best chance
 * of matching without needing a redeploy first. Status is uppercased so callers can compare
 * against a fixed set of values regardless of which casing Exotel actually sends. */
export function parseCallStatusCallback(payload: Record<string, unknown>): CallStatusEvent {
  const get = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = payload[key];
      if (value !== undefined && value !== null && value !== '') return String(value);
    }
    return undefined;
  };
  const durationRaw = get('CallDuration', 'DialCallDuration', 'Duration', 'duration');
  const duration = durationRaw !== undefined && Number.isFinite(Number(durationRaw)) ? Number(durationRaw) : null;
  return {
    callSid: get('CallSid', 'Sid', 'call_sid') || '',
    status: (get('DialCallStatus', 'CallStatus', 'Status', 'status') || 'UNKNOWN').toUpperCase(),
    duration,
    recordingUrl: get('RecordingUrl', 'recording_url') || null,
    raw: payload,
  };
}

export class ExotelVoiceProvider {
  constructor(private config: ExotelVoiceConfig) {}

  /**
   * Rings agentPhone first; once answered, Exotel connects the call to leadPhone.
   * `callerId` is optional — pass a location's own ExoPhone to have the lead see that
   * brand's number instead of the account-wide default; falls back to the configured
   * default caller ID when omitted.
   *
   * `statusCallbackUrl`, when given, is passed as `StatusCallback` so Exotel POSTs real
   * call-progress/outcome events back to us instead of the CallLog row staying on
   * whatever status connect.json returned at queue-time forever (see getCallStatus's
   * doc comment). UNVERIFIED, same caveat as the rest of this file — modeled on Exotel's
   * publicly documented StatusCallback parameter, not yet exercised against a real call.
   */
  async connectCall(agentPhone: string, leadPhone: string, callerId?: string, statusCallbackUrl?: string): Promise<ConnectCallResult> {
    const effectiveCallerId = callerId || this.config.callerId;
    const response = (await this.request('Calls/connect.json', {
      From: agentPhone,
      To: leadPhone,
      CallerId: effectiveCallerId,
      CallType: 'trans', // UNVERIFIED — assumed value for a real-time (non-recorded-prompt) connect call
      ...(statusCallbackUrl ? { StatusCallback: statusCallbackUrl } : {}),
    })) as { Call?: { Sid?: string; CallSid?: string; Status?: string } } | null; // UNVERIFIED envelope shape
    const call = response?.Call;
    return { callSid: call?.Sid || call?.CallSid || null, status: call?.Status || 'UNKNOWN', callerId: effectiveCallerId, raw: response };
  }

  /**
   * connect.json's response only ever reflects the call's state at the instant it was queued
   * (typically "in-progress" while it's still ringing/connecting) — Exotel never updates that
   * synchronously, and this codebase has no status-callback webhook wired up yet, so a CallLog
   * row would otherwise stay on that initial status forever. This is the on-demand alternative:
   * fetch the call's current state from Exotel directly. UNVERIFIED envelope shape, same caveat
   * as connectCall above — modeled on Exotel's public "Call Details" docs, not yet exercised.
   */
  async getCallStatus(callSid: string): Promise<string> {
    const response = (await this.request(`Calls/${encodeURIComponent(callSid)}.json`, {}, 'GET')) as { Call?: { Status?: string } } | null;
    return response?.Call?.Status || 'UNKNOWN';
  }

  private async request(path: string, formParams: Record<string, string>, method: 'POST' | 'GET' = 'POST'): Promise<unknown> {
    const url = `https://api.exotel.com/v1/Accounts/${encodeURIComponent(this.config.accountSid)}/${path}`;
    const auth = btoa(`${this.config.apiKey}:${this.config.apiToken}`);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Basic ${auth}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(method === 'POST' ? { body: new URLSearchParams(formParams).toString() } : {}),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (!res.ok) throw new ApiError(502, 'PROVIDER_ERROR', `Exotel voice request failed (${res.status}): ${JSON.stringify(parsed)}`);
    return parsed;
  }
}
