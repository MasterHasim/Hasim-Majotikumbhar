/**
 * Direct port of apps-script/src/Phase22Domain.gs — same six fixed locations, same
 * assignment-mode/lead-status vocabulary, same loose phone/callerId normalization
 * (the upload sheet's raw format isn't controlled, so no country-specific enforcement).
 */
import { ApiError } from '../types';
import { Validation } from './phase1';

// 'ECHT Marine', 'Compliances', 'Entartica Partner Desk', 'Entartica CRM' added 2026-08-24 so
// every registered WhatsApp Number has a matching Lead location — per an explicit product
// decision that a new WhatsApp conversation on ANY number should be able to fall under a real
// Lead (see Phase22Api.autoCreateLeadFromConversation), not just the original 6 customer-facing
// sites. Each is named to exactly match its WhatsApp Number's own displayName so
// Phase22Api.findNumberForLocation's substring match resolves it automatically, the same way
// 'Raipur' already resolves to the "Entartica - Raipur" number — no extra config needed for
// SITE_MANAGER/ADMIN location-visibility scoping, or for the reverse (number -> location)
// lookup autoCreateLeadFromConversation needs, to work correctly for these too.
export const Phase22Locations = [
  'Raipur', 'Rajsamand', 'Coimbatore', 'Prayagraj', 'Alibaug', 'Saraighat', 'ECHT Marine',
  'Compliances', 'Entartica Partner Desk', 'Entartica CRM',
] as const;
export type Phase22Location = (typeof Phase22Locations)[number];

export const Phase22AssignmentModes = { SINGLE: 'single', ROUND_ROBIN: 'round_robin', MANUAL: 'manual' } as const;
export const Phase22AssignmentModeValues = Object.values(Phase22AssignmentModes);

export const Phase22LeadStatus = { NEW: 'NEW', ASSIGNED: 'ASSIGNED', UNASSIGNED: 'UNASSIGNED', CALLED: 'CALLED' } as const;

export const Phase22Validation = {
  phone(value: unknown, field?: string): string {
    const raw = Validation.requiredString(value, field || 'phone');
    const normalized = raw.replace(/[\s-]/g, '');
    if (!/^\+?\d{6,15}$/.test(normalized)) throw new ApiError(400, 'VALIDATION_ERROR', `${field || 'phone'} is not a valid phone number.`);
    return normalized;
  },
  location(value: unknown): Phase22Location {
    return Validation.enumValue(value, Phase22Locations, 'location');
  },
  mode(value: unknown): string {
    return Validation.enumValue(value, Phase22AssignmentModeValues, 'mode');
  },
  /** ExoPhone caller IDs get pasted from a display table like "079-485-02804" — strip formatting, no strict length check (landline ExoPhones vary). */
  callerId(value: unknown): string {
    return String(value).replace(/[\s-]/g, '').trim();
  },
  /** Trims, drops blanks, dedupes case-insensitively (keeping first casing seen), caps count
   * and per-tag length so one bad paste can't bloat a lead record. */
  tags(value: unknown): string[] {
    if (!Array.isArray(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'tags must be an array of strings.');
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of value) {
      const tag = String(raw ?? '').trim().slice(0, 40);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(tag);
      if (result.length >= 20) break;
    }
    return result;
  },
};
