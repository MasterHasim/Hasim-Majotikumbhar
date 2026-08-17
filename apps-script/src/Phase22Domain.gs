/**
 * Phase 22 — Location Leads Upload, Assignment Rules & Exotel Click-to-Call.
 *
 * A second, independent assignment workflow alongside Phase 7's per-WhatsApp-number
 * round robin: admins upload a spreadsheet of call leads (name/phone/location) for a
 * fixed set of site locations, and each lead is auto-assigned to a site agent per a
 * per-location rule (single fixed agent / round robin / manual). Leads are a separate
 * concept from Customers (Phase 8) — see memory/DECISIONS.md for why they aren't
 * merged. Two of the six locations (Coimbatore, Alibaug) don't correspond to any
 * existing WhatsApp number, confirming this is genuinely a new vertical.
 */
var Phase22Locations = ['Raipur', 'Rajsamand', 'Coimbatore', 'Prayagraj', 'Alibaug', 'Saraighat'];

var Phase22AssignmentModes = { SINGLE: 'single', ROUND_ROBIN: 'round_robin', MANUAL: 'manual' };
var Phase22AssignmentModeValues = [Phase22AssignmentModes.SINGLE, Phase22AssignmentModes.ROUND_ROBIN, Phase22AssignmentModes.MANUAL];

var Phase22LeadStatus = { NEW: 'NEW', ASSIGNED: 'ASSIGNED', UNASSIGNED: 'UNASSIGNED', CALLED: 'CALLED' };
var Phase22LeadStatusValues = [Phase22LeadStatus.NEW, Phase22LeadStatus.ASSIGNED, Phase22LeadStatus.UNASSIGNED, Phase22LeadStatus.CALLED];

// Table schemas themselves (Leads, Location_Assignment_Config, Location_Assignment_Users,
// Call_Log) are added directly to Phase2Schemas in Phase2Domain.gs, following the same
// convention Phase 8/9/11 used for their new tabs (see that file's "Phase 8:"/"Phase 9:"/
// "Phase 11:" comments) — NOT merged in from here. Apps Script loads .gs files in
// filename alphabetical order, and "Phase22Domain.gs" sorts *before* "Phase2Domain.gs"
// (digit '2' < letter 'D'), same trap already documented in Phase2Persistence.gs for
// "Repositories" vs "Repository" — a top-level merge here would run before
// Phase2Schemas even exists.

var Phase22Validation = {
  /** Loose normalization only (strip spaces/dashes, keep leading +) — no country-specific format enforcement, since the upload sheet's raw format isn't controlled. */
  phone: function (value, field) {
    var raw = Phase1Validation.requiredString(value, field || 'phone');
    var normalized = raw.replace(/[\s-]/g, '');
    if (!/^\+?\d{6,15}$/.test(normalized)) throw new Phase1Error('VALIDATION_ERROR', (field || 'phone') + ' is not a valid phone number.');
    return normalized;
  },
  location: function (value) { return Phase1Validation.enumValue(value, Phase22Locations, 'location'); },
  mode: function (value) { return Phase1Validation.enumValue(value, Phase22AssignmentModeValues, 'mode'); }
};
