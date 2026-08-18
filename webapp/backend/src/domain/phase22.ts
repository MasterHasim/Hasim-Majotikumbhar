/**
 * Direct port of apps-script/src/Phase22Domain.gs — same six fixed locations, same
 * assignment-mode/lead-status vocabulary, same loose phone/callerId normalization
 * (the upload sheet's raw format isn't controlled, so no country-specific enforcement).
 */
import { ApiError } from '../types';
import { Validation } from './phase1';

export const Phase22Locations = ['Raipur', 'Rajsamand', 'Coimbatore', 'Prayagraj', 'Alibaug', 'Saraighat'] as const;
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
};
