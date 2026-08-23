/**
 * Direct port of apps-script/src/Phase22Domain.gs + Phase22Services.gs's Phase22Api —
 * a second, independent assignment workflow alongside Phase7Api's per-WhatsApp-number
 * round robin: admins upload a list of call leads (name/phone/location) for a fixed
 * set of site locations, and each lead auto-assigns to a site agent per a per-location
 * rule (single fixed agent / round robin / manual). Leads are a separate concept from
 * Customers (Phase8Api) — kept as their own entity rather than merged, same as the
 * source.
 *
 * Known simplification vs. the source: the round-robin read-pointer -> select ->
 * update-pointer sequence isn't wrapped in a distributed lock the way Apps Script's
 * LockService wrapped it — same accepted trade-off as phase7Api.ts's own round robin
 * (see that file's note; this backend has no equivalent lock primitive, and the
 * actual write concurrency here is low).
 */
import { ApiError } from '../types';
import { Ids, Permissions, Roles, Status, Validation } from '../domain/phase1';
import { Phase22AssignmentModes, Phase22LeadStatus, Phase22Locations, Phase22Validation, type Phase22Location } from '../domain/phase22';
import type {
  AutoDialerSettings, CallLog, CallLogWithContext, Conversation, Customer, CustomFieldDefinition, Lead, LeadRemark, LeadStageAssignment,
  LocationAssignmentConfig, LocationAssignmentUser, Product, Quotation, QuotationLineItem, Reminder, ReminderStatus, Stage, User, WhatsAppNumber,
} from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService, type AuditEntryWithActor } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { ExotelVoiceProvider, requireExotelVoiceConfig, type ExotelVoiceConfig, type CallStatusEvent } from './exotelVoiceProvider';
import { validateCustomFieldValues } from './customFieldsApi';

/** Call outcomes that mean "the lead/customer never actually picked up" — drives the
 * missed-call auto-reminder in applyCallStatusEvent. Uppercased to match
 * parseCallStatusCallback's normalization. UNVERIFIED against real Exotel traffic, same
 * caveat as exotelVoiceProvider.ts — these are the standard Twilio-style outcome values
 * that API was modeled on, not yet confirmed against a real callback. */
const MISSED_CALL_STATUSES = new Set(['NO-ANSWER', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED', 'CANCELLED']);

export interface UploadLeadsResult {
  batchId: string;
  created: number;
  skipped: number;
  errors: { index: number; row: unknown; message: string }[];
}

/** Pure line-item math, reused by the authenticated builder and the public (unauthenticated)
 * quotation view alike — each line's own discountPercent applies first, then
 * overallDiscountPercent applies once more on the summed subtotal. */
export function computeQuotationTotals(quotation: Pick<Quotation, 'lineItems' | 'overallDiscountPercent'>): { subtotal: number; overallDiscountAmount: number; total: number } {
  const subtotal = quotation.lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity * (1 - item.discountPercent / 100), 0);
  const overallDiscountAmount = subtotal * (quotation.overallDiscountPercent / 100);
  return { subtotal, overallDiscountAmount, total: subtotal - overallDiscountAmount };
}

export interface PublicQuotationView {
  id: string;
  leadName: string;
  numberDisplayName: string;
  lineItems: QuotationLineItem[];
  overallDiscountPercent: number;
  notes: string;
  createdAt: string;
  totals: { subtotal: number; overallDiscountAmount: number; total: number };
}

/**
 * Deliberately outside Phase22Api/AccessControl — this is the one intentionally unauthenticated
 * read in the whole backend, same "unguessable ID is the access control" model routes/media.ts's
 * public file serving already uses (the id is a real UUID-bearing string, never enumerable).
 * Used by the customer-facing quotation link shared over WhatsApp, which by definition can't
 * carry a Firebase sign-in.
 */
export async function getPublicQuotationView(db: FirebaseDb, quotationId: string): Promise<PublicQuotationView> {
  const quotations = new Repository<Quotation>(db, 'quotations');
  const leads = new Repository<Lead>(db, 'leads');
  const numbers = new Repository<WhatsAppNumber>(db, 'numbers');
  const quotation = await quotations.get(quotationId);
  if (!quotation) throw new ApiError(404, 'NOT_FOUND', 'Quotation was not found.');
  const [lead, number] = await Promise.all([leads.get(quotation.leadId), numbers.get(quotation.numberId)]);
  return {
    id: quotation.id,
    leadName: lead?.name || 'Customer',
    numberDisplayName: number?.displayName || '',
    lineItems: quotation.lineItems,
    overallDiscountPercent: quotation.overallDiscountPercent,
    notes: quotation.notes,
    createdAt: quotation.createdAt,
    totals: computeQuotationTotals(quotation),
  };
}

export class Phase22Api {
  readonly access: AccessControl;
  private phase1Repos: Phase1Repositories;
  private audit: AuditLogService;
  private leads: Repository<Lead>;
  private locationConfig: Repository<LocationAssignmentConfig>;
  private locationUsers: Repository<LocationAssignmentUser>;
  private callLog: Repository<CallLog>;
  private reminders: Repository<Reminder>;
  private autoDialerSettings: Repository<AutoDialerSettings>;
  private stages: Repository<Stage>;
  private leadStages: Repository<LeadStageAssignment>;
  private leadRemarks: Repository<LeadRemark>;
  private customers: Repository<Customer>;
  private conversations: Repository<Conversation>;
  private numbers: Repository<WhatsAppNumber>;
  private customFieldDefs: Repository<CustomFieldDefinition>;
  private products: Repository<Product>;
  private quotations: Repository<Quotation>;
  private exotelVoiceConfig?: ExotelVoiceConfig;

  constructor(private db: FirebaseDb, identityEmail: string, env?: { EXOTEL_VOICE_ACCOUNT_SID?: string; EXOTEL_VOICE_API_KEY?: string; EXOTEL_VOICE_API_TOKEN?: string; EXOTEL_VOICE_CALLER_ID?: string }) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.leads = new Repository<Lead>(db, 'leads');
    this.locationConfig = new Repository<LocationAssignmentConfig>(db, 'locationAssignmentConfig');
    this.locationUsers = new Repository<LocationAssignmentUser>(db, 'locationAssignmentUsers');
    this.callLog = new Repository<CallLog>(db, 'callLog');
    this.reminders = new Repository<Reminder>(db, 'reminders');
    this.autoDialerSettings = new Repository<AutoDialerSettings>(db, 'autoDialerSettings');
    this.stages = new Repository<Stage>(db, 'stages');
    this.leadStages = new Repository<LeadStageAssignment>(db, 'leadStageAssignments');
    this.leadRemarks = new Repository<LeadRemark>(db, 'leadRemarks');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.customFieldDefs = new Repository<CustomFieldDefinition>(db, 'customFieldDefinitions');
    this.products = new Repository<Product>(db, 'products');
    this.quotations = new Repository<Quotation>(db, 'quotations');
    if (env) this.exotelVoiceConfig = requireExotelVoiceConfig(env);
  }

  async listLocations(): Promise<readonly string[]> {
    await this.access.currentUser();
    return Phase22Locations;
  }

  /** rows: [{name, phone, location}]. Invalid rows are skipped individually (reported in errors, not thrown) so one bad row in a large paste doesn't abort the whole batch. */
  async uploadLeads(rows: unknown): Promise<UploadLeadsResult> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    if (!Array.isArray(rows) || !rows.length) throw new ApiError(400, 'VALIDATION_ERROR', 'rows must be a non-empty array.');
    const batchId = Ids.create('uploadbatch');
    const now = Ids.now();
    let created = 0;
    let skipped = 0;
    const errors: { index: number; row: unknown; message: string }[] = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] as { name?: unknown; phone?: unknown; location?: unknown };
      try {
        const name = Validation.requiredString(row.name, 'name');
        const phone = Phase22Validation.phone(row.phone, 'phone');
        const location = Phase22Validation.location(row.location);
        if (!(await this.canSeeLocation(actor, location))) throw new ApiError(403, 'FORBIDDEN', `You do not have access to upload leads for ${location}.`);
        if (await this.leads.findOne((lead) => lead.phone === phone && lead.location === location)) { skipped++; continue; }
        const lead: Lead = { id: Ids.create('lead'), name, phone, location, status: Phase22LeadStatus.NEW, assignedUserId: '', assignedAt: '', uploadBatchId: batchId, uploadedBy: actor.id, createdAt: now, updatedAt: now };
        await this.leads.create(lead);
        await this.assignLead(lead);
        created++;
      } catch (e) {
        errors.push({ index, row, message: e instanceof Error ? e.message : String(e) });
      }
    }
    await this.audit.write(actor.id, 'leads.uploaded', 'leadBatch', batchId, { created, skipped, errors: errors.length });
    return { batchId, created, skipped, errors };
  }

  /** Single-lead counterpart to uploadLeads — same validation, duplicate check, and
   * assignment-rule application as one row of a bulk upload, for adding an external
   * lead one at a time instead of pasting a whole batch. */
  async createLead(input: { name?: unknown; phone?: unknown; location?: unknown }): Promise<Lead> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    const name = Validation.requiredString(input.name, 'name');
    const phone = Phase22Validation.phone(input.phone, 'phone');
    const location = Phase22Validation.location(input.location);
    if (!(await this.canSeeLocation(actor, location))) throw new ApiError(403, 'FORBIDDEN', `You do not have access to add leads for ${location}.`);
    if (await this.leads.findOne((lead) => lead.phone === phone && lead.location === location)) {
      throw new ApiError(409, 'CONFLICT', 'A lead with this phone number already exists for this location.');
    }
    const now = Ids.now();
    const lead: Lead = { id: Ids.create('lead'), name, phone, location, status: Phase22LeadStatus.NEW, assignedUserId: '', assignedAt: '', uploadBatchId: Ids.create('uploadbatch'), uploadedBy: actor.id, createdAt: now, updatedAt: now };
    await this.leads.create(lead);
    const assigned = await this.assignLead(lead);
    await this.audit.write(actor.id, 'lead.created', 'lead', lead.id, { name, phone, location });
    return assigned;
  }

  async reassignLead(leadId: string, userId: string): Promise<Lead> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    if (!(await this.canSeeLocation(actor, lead.location))) await this.denied(actor, leadId);
    const validUserId = Validation.requiredString(userId, 'userId');
    if (!(await this.phase1Repos.users.get(validUserId))) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
    const record = await this.leads.update(leadId, { status: Phase22LeadStatus.ASSIGNED, assignedUserId: validUserId, assignedAt: Ids.now() });
    await this.audit.write(actor.id, 'lead.reassigned', 'lead', leadId, { userId: validUserId });
    return record;
  }

  /** ADMIN sees every lead. SITE_MANAGER (LEADS_MANAGE) sees every lead for locations they have
   * number access to — see canSeeLocation. AGENT (LEADS_VIEW_ASSIGNED) sees only their own. */
  async listLeads(filters: { location?: string; status?: string; assignedUserId?: string } = {}): Promise<Lead[]> {
    const actor = await this.access.currentUser();
    const isManager = await this.isLeadManager(actor);
    if (isManager) await this.access.require(Permissions.LEADS_MANAGE);
    else await this.access.require(Permissions.LEADS_VIEW_ASSIGNED);
    const all = await this.leads.list();
    let scoped: Lead[];
    if (!isManager) {
      scoped = all.filter((lead) => lead.assignedUserId === actor.id);
    } else {
      const locationAccess = new Map<string, boolean>();
      scoped = [];
      for (const lead of all) {
        if (!locationAccess.has(lead.location)) locationAccess.set(lead.location, await this.canSeeLocation(actor, lead.location));
        if (locationAccess.get(lead.location)) scoped.push(lead);
      }
    }
    return scoped
      .filter((lead) => (!filters.location || lead.location === filters.location) && (!filters.status || lead.status === filters.status) && (!filters.assignedUserId || lead.assignedUserId === filters.assignedUserId))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  /**
   * The Leads Kanban board's own stage progression (New Leads → Contacted → ... → Lead Won/Lost),
   * distinct from Phase8Api's Customer-stage dashboard metric — Leads and Customers share the
   * same Stage definitions but track their own independent stageId. Reuses listLeads() entirely
   * for both authorization and location-isolation scoping, so this can never show a stage
   * breakdown of leads the caller couldn't otherwise see.
   */
  async getLeadFunnel(location?: string): Promise<{
    stages: { stageId: string; name: string; sequenceOrder: number; count: number; pctOfTotal: number | null; pctOfFirstStage: number | null }[];
    noStage: number;
    total: number;
  }> {
    const leads = await this.listLeads(location ? { location } : {});
    const stages = (await this.stages.list()).filter((s) => s.active).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    const countsByStage = new Map<string, number>();
    let noStage = 0;
    for (const lead of leads) {
      if (!lead.stageId) { noStage++; continue; }
      countsByStage.set(lead.stageId, (countsByStage.get(lead.stageId) ?? 0) + 1);
    }
    const total = leads.length;
    const firstStageCount = stages.length > 0 ? (countsByStage.get(stages[0]!.id) ?? 0) : 0;
    const stageRows = stages.map((stage) => {
      const count = countsByStage.get(stage.id) ?? 0;
      return {
        stageId: stage.id, name: stage.name, sequenceOrder: stage.sequenceOrder, count,
        pctOfTotal: total > 0 ? Math.round((count / total) * 1000) / 10 : null,
        pctOfFirstStage: firstStageCount > 0 ? Math.round((count / firstStageCount) * 1000) / 10 : null,
      };
    });
    return { stages: stageRows, noStage, total };
  }

  /**
   * Cross-location "Home" overview — added 2026-08-24 as a strategic counterpart to
   * Phase14Api's per-number Dashboard (conversations/response-time/template usage). Covers
   * three factors Dashboard doesn't: where leads are coming from, whether calls are actually
   * connecting, and how much is sitting in the sales pipeline. Gated the same as Dashboard
   * (REPORTS_VIEW), and reuses listLeads()'s existing manager/agent + location scoping rather
   * than re-deriving it, so this can never show a location or lead the caller couldn't
   * otherwise see.
   *
   * callOutcomes is deliberately scoped to lead-initiated calls only (CallLog rows with a
   * leadId this caller's listLeads() already covers) — conversation-initiated calls have no
   * location of their own to scope by by, and folding them in unscoped would leak call data
   * across a SITE_MANAGER's location boundary. A real gap once conversation-initiated calls
   * need representing here too; scope by numberId (Phase5Api.listMyNumbers()) the same way
   * Phase14Api.getDashboardMetrics does when that need arises.
   */
  async getHomeMetrics(): Promise<{
    leadsByLocation: { location: string; count: number }[];
    callOutcomes: { label: string; count: number }[];
    quotationPipeline: { status: string; count: number; totalValue: number }[];
  }> {
    await this.access.require(Permissions.REPORTS_VIEW);
    const leads = await this.listLeads();
    const leadIds = new Set(leads.map((l) => l.id));

    const leadsByLocation = Phase22Locations.map((location) => ({
      location, count: leads.filter((l) => l.location === location).length,
    }));

    const calls = (await this.callLog.list()).filter((c) => c.leadId && leadIds.has(c.leadId));
    const outcomeBuckets: Record<string, string> = { ANSWERED: 'Answered', COMPLETED: 'Answered', 'NO-ANSWER': 'Missed', NO_ANSWER: 'Missed', BUSY: 'Missed', FAILED: 'Missed', CANCELED: 'Missed', CANCELLED: 'Missed' };
    const outcomeCounts = new Map<string, number>();
    for (const call of calls) {
      const label = outcomeBuckets[(call.status || '').toUpperCase()] ?? 'Pending / unknown';
      outcomeCounts.set(label, (outcomeCounts.get(label) ?? 0) + 1);
    }
    const callOutcomes = [...outcomeCounts.entries()].map(([label, count]) => ({ label, count }));

    const quotations = (await this.quotations.list()).filter((q) => leadIds.has(q.leadId));
    const pipelineByStatus = new Map<string, { count: number; totalValue: number }>();
    for (const q of quotations) {
      const entry = pipelineByStatus.get(q.status) ?? { count: 0, totalValue: 0 };
      entry.count++;
      entry.totalValue += computeQuotationTotals(q).total;
      pipelineByStatus.set(q.status, entry);
    }
    const quotationPipeline = [...pipelineByStatus.entries()].map(([status, v]) => ({ status, count: v.count, totalValue: Math.round(v.totalValue * 100) / 100 }));

    return { leadsByLocation, callOutcomes, quotationPipeline };
  }

  async getLocationConfig(location: string): Promise<LocationAssignmentConfig | null> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
    if (!(await this.canSeeLocation(actor, location))) await this.deniedLocation(actor, location);
    return this.locationConfig.findOne((record) => record.location === location);
  }

  async setLocationConfig(location: string, patch: Record<string, unknown>): Promise<LocationAssignmentConfig> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
    if (!(await this.canSeeLocation(actor, location))) await this.deniedLocation(actor, location);
    const allowed = ['mode', 'singleUserId', 'active', 'callerId'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    if (safePatch.mode) Phase22Validation.mode(safePatch.mode);
    if (safePatch.singleUserId && !(await this.phase1Repos.users.get(safePatch.singleUserId as string))) throw new ApiError(404, 'NOT_FOUND', 'singleUserId does not reference a user.');
    if (safePatch.callerId) safePatch.callerId = Phase22Validation.callerId(safePatch.callerId);

    const existing = await this.locationConfig.findOne((record) => record.location === location);
    let record: LocationAssignmentConfig;
    if (existing) {
      record = await this.locationConfig.update(existing.id, safePatch);
    } else {
      const now = Ids.now();
      record = { id: Ids.create('locconfig'), location, mode: Phase22AssignmentModes.MANUAL, singleUserId: '', lastAssignedUserId: '', active: true, callerId: '', createdAt: now, updatedAt: now, ...safePatch };
      await this.locationConfig.create(record);
    }
    await this.audit.write(actor.id, 'locationAssignmentConfig.updated', 'locationAssignmentConfig', record.id, { location });
    return record;
  }

  async listLocationParticipants(location: string): Promise<LocationAssignmentUser[]> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    if (!(await this.canSeeLocation(actor, location))) await this.deniedLocation(actor, location);
    return (await this.locationUsers.list()).filter((p) => p.location === location).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  async addLocationParticipant(location: string, userId: string, sequenceOrder?: number): Promise<LocationAssignmentUser> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
    if (!(await this.canSeeLocation(actor, location))) await this.deniedLocation(actor, location);
    if (!(await this.phase1Repos.users.get(userId))) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
    if (await this.locationUsers.findOne((p) => p.location === location && p.userId === userId)) throw new ApiError(409, 'CONFLICT', 'User is already a participant for this location.');
    const now = Ids.now();
    const record: LocationAssignmentUser = { id: Ids.create('locuser'), location, userId, sequenceOrder: sequenceOrder || 1, active: true, createdAt: now, updatedAt: now };
    await this.locationUsers.create(record);
    await this.audit.write(actor.id, 'locationAssignmentParticipant.added', 'locationAssignmentUser', record.id, { location, userId });
    return record;
  }

  async updateLocationParticipant(id: string, patch: Record<string, unknown>): Promise<LocationAssignmentUser> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    const existing = await this.locationUsers.get(id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Location participant was not found.');
    if (!(await this.canSeeLocation(actor, existing.location))) await this.deniedLocation(actor, existing.location);
    const allowed = ['sequenceOrder', 'active'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    const record = await this.locationUsers.update(id, safePatch as Partial<LocationAssignmentUser>);
    await this.audit.write(actor.id, 'locationAssignmentParticipant.updated', 'locationAssignmentUser', id, {});
    return record;
  }

  /** The assigned agent, or a lead manager (ADMIN/SITE_MANAGER) acting on their behalf — same
   * canTouchLead scope as startWhatsAppFromLead below, so a manager can always reach a lead
   * they can already see. Rings the caller's own phone first regardless of who's assigned. */
  async initiateCall(leadId: string, statusCallbackUrl?: string): Promise<CallLog> {
    const actor = await this.access.require(Permissions.LEADS_CALL);
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    const agentPhone = (actor.phone || '').toString().trim();
    if (!agentPhone) throw new ApiError(400, 'VALIDATION_ERROR', 'Your profile has no phone number on file — ask an admin to add one.');
    const locationConfig = await this.locationConfig.findOne((record) => record.location === lead.location);
    const result = await new ExotelVoiceProvider(this.requireVoiceConfig()).connectCall(agentPhone, lead.phone, locationConfig?.callerId, statusCallbackUrl);
    const now = Ids.now();
    const record: CallLog = { id: Ids.create('call'), leadId, agentUserId: actor.id, exotelCallSid: result.callSid || '', agentPhone, leadPhone: lead.phone, callerId: result.callerId || '', status: result.status || 'INITIATED', initiatedAt: now, updatedAt: now };
    await this.callLog.create(record);
    await this.leads.update(leadId, { status: Phase22LeadStatus.CALLED });
    await this.audit.write(actor.id, 'lead.called', 'lead', leadId, { callId: record.id, callSid: record.exotelCallSid });
    return record;
  }

  async listCallLog(leadId: string): Promise<CallLog[]> {
    await this.access.require(Permissions.LEADS_MANAGE);
    return (await this.callLog.list()).filter((call) => call.leadId === leadId).sort((a, b) => (a.initiatedAt || '').localeCompare(b.initiatedAt || ''));
  }

  /** connect.json only ever reports the call's status at the instant it was placed (usually
   * "in-progress"/queued) — real progress now arrives via applyCallStatusEvent (the
   * StatusCallback webhook, wired up 2026-08-23) instead, but this on-demand fetch stays as
   * a manual fallback (e.g. a call placed before the webhook existed, or the callback never
   * arrived), callable by whoever placed the call or any lead manager. */
  async refreshCallStatus(callId: string): Promise<CallLog> {
    const actor = await this.access.currentUser();
    const call = await this.callLog.get(callId);
    if (!call) throw new ApiError(404, 'NOT_FOUND', 'Call was not found.');
    if (call.agentUserId !== actor.id && !(await this.isLeadManager(actor))) throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
    if (!call.exotelCallSid) throw new ApiError(400, 'VALIDATION_ERROR', 'This call has no Exotel call SID to look up.');
    const status = await new ExotelVoiceProvider(this.requireVoiceConfig()).getCallStatus(call.exotelCallSid);
    return this.callLog.update(callId, { status, updatedAt: Ids.now() });
  }

  /** Applied by the /webhook/exotel-voice route (no signed-in identity — a webhook, same
   * system-level reasoning as Phase4Api.ingestInboundMessage) when Exotel POSTs a real call
   * outcome to the StatusCallback URL connectCall registered. Writes directly to the
   * repositories it needs rather than going through AccessControl-gated methods like
   * Phase9Api.createReminder, for the same reason Phase4Api does — there's no signed-in user
   * for those permission checks to run against. UNVERIFIED against real traffic, same caveat
   * as exotelVoiceProvider.ts. */
  async applyCallStatusEvent(event: CallStatusEvent): Promise<{ applied: boolean; callId?: string; status?: string }> {
    if (!event.callSid) return { applied: false };
    const call = await this.callLog.findOne((c) => c.exotelCallSid === event.callSid);
    if (!call) return { applied: false };
    const now = Ids.now();
    const patch: Partial<CallLog> = { status: event.status, updatedAt: now };
    if (event.duration !== null) patch.duration = event.duration;
    if (event.recordingUrl) patch.recordingUrl = event.recordingUrl;
    const isMissed = MISSED_CALL_STATUSES.has(event.status);
    if (isMissed || event.status === 'COMPLETED') patch.endedAt = now;
    await this.callLog.update(call.id, patch);
    await this.audit.write(null, 'call.statusUpdated', 'call', call.id, { status: event.status, callSid: event.callSid });

    // Missed-call auto-task — attaches to whichever target the call actually has (a
    // conversation-initiated call has conversationId, a lead-initiated one has leadId; Reminders
    // support both since 2026-08-24). Admin-toggleable (Admin → Auto Dialer) since not every team
    // wants an automatic reminder for every missed call.
    if (isMissed && (call.conversationId || call.leadId) && (await this.getAutoDialerSettings()).missedCallReminderEnabled) {
      try {
        const reminder: Reminder = {
          id: Ids.create('reminder'), ownerUserId: call.agentUserId,
          ...(call.conversationId ? { conversationId: call.conversationId } : { leadId: call.leadId }),
          text: `Call back — missed call (${event.status.toLowerCase().replace('_', '-')})`, dueAt: now, status: 'PENDING', createdAt: now, updatedAt: now,
        };
        await this.reminders.create(reminder);
        await this.audit.write(null, 'reminder.created', 'reminder', reminder.id, { conversationId: call.conversationId, leadId: call.leadId, source: 'missedCall', callId: call.id });
      } catch (e) {
        console.error('applyCallStatusEvent: failed to auto-create missed-call reminder', e);
      }
    }
    return { applied: true, callId: call.id, status: event.status };
  }

  /** Account-wide Auto Dialer on/off switches (Admin → Auto Dialer) — see AutoDialerSettings'
   * own doc comment. No record yet (first run) means every flag defaults to true, so a fresh
   * install behaves the same as before these toggles existed rather than silently going quiet. */
  async getAutoDialerSettings(): Promise<AutoDialerSettings> {
    const record = await this.autoDialerSettings.get('default');
    return record ?? { id: 'default', missedCallReminderEnabled: true, callPromptEnabled: true, updatedAt: '', updatedBy: '' };
  }

  async updateAutoDialerSettings(patch: { missedCallReminderEnabled?: unknown; callPromptEnabled?: unknown }): Promise<AutoDialerSettings> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    const current = await this.getAutoDialerSettings();
    const next: AutoDialerSettings = {
      id: 'default',
      missedCallReminderEnabled: patch.missedCallReminderEnabled !== undefined ? Boolean(patch.missedCallReminderEnabled) : current.missedCallReminderEnabled,
      callPromptEnabled: patch.callPromptEnabled !== undefined ? Boolean(patch.callPromptEnabled) : current.callPromptEnabled,
      updatedAt: Ids.now(), updatedBy: actor.id,
    };
    await this.autoDialerSettings.replace('default', next);
    await this.audit.write(actor.id, 'autoDialerSettings.updated', 'autoDialerSettings', 'default', { patch: next });
    return next;
  }

  /** Sales follow-up reminder attached directly to a Lead — for a Lead with no WhatsApp
   * conversation started yet (see Reminder's 2026-08-24 doc comment). Same authorization shape
   * as addLeadRemark: the lead's assigned agent, or a lead manager. */
  async createLeadReminder(leadId: string, text: string, dueAt: string): Promise<Reminder> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    await this.access.require(Permissions.REMINDERS_MANAGE);
    const validText = Validation.requiredString(text, 'text');
    const validDueAt = Validation.requiredString(dueAt, 'dueAt');
    const now = Ids.now();
    const reminder: Reminder = { id: Ids.create('reminder'), leadId, ownerUserId: actor.id, text: validText, dueAt: validDueAt, status: 'PENDING', createdAt: now, updatedAt: now };
    await this.reminders.create(reminder);
    await this.audit.write(actor.id, 'reminder.created', 'reminder', reminder.id, { leadId });
    return reminder;
  }

  async listLeadReminders(leadId: string): Promise<Reminder[]> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    return (await this.reminders.list()).filter((r) => r.leadId === leadId).sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
  }

  /** Same authorization shape as createLeadReminder — used by the shared PATCH /api/reminders/:id
   * route once it's determined (by checking which of conversationId/leadId is set) that a given
   * reminder is lead-attached, so "mark done" works identically regardless of which kind it is. */
  async updateLeadReminderStatus(reminderId: string, status: string): Promise<Reminder> {
    const reminder = await this.reminders.get(reminderId);
    if (!reminder) throw new ApiError(404, 'NOT_FOUND', 'Reminder was not found.');
    if (!reminder.leadId) throw new ApiError(400, 'VALIDATION_ERROR', 'This reminder is not attached to a lead.');
    const lead = await this.leads.get(reminder.leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, reminder.leadId);
    await this.access.require(Permissions.REMINDERS_MANAGE);
    const validStatus = Validation.enumValue<ReminderStatus>(status, ['PENDING', 'COMPLETED', 'CANCELLED'], 'status');
    const record = await this.reminders.update(reminderId, { status: validStatus });
    await this.audit.write(actor.id, 'reminder.statusChanged', 'reminder', reminderId, { status: validStatus, leadId: reminder.leadId });
    return record;
  }

  /**
   * "Was this customer actually called?" for the conversation detail panel — matches on
   * this conversation's own conversationId (calls placed via initiateConversationCall) AND
   * on the customer's phone number (calls placed via the Leads path, initiateCall, which
   * stamps leadPhone but has no conversationId of its own) so a call made from either
   * surface shows up here. Same view-level authorization as remarks/reminders.
   */
  async listConversationCallHistory(conversationId: string): Promise<CallLog[]> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    await this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    const customer = await this.customers.get(conversation.customerId);
    if (!customer) return [];
    return (await this.callLog.list())
      .filter((call) => call.conversationId === conversationId || call.leadPhone === customer.phone)
      .sort((a, b) => (b.initiatedAt || '').localeCompare(a.initiatedAt || ''));
  }

  /** Every call placed through either click-to-call path (lead-assigned or conversation-based),
   * newest first. A lead manager sees every agent's calls; anyone else sees only their own —
   * same scoping shape as listLeads(). */
  async listCallHistory(): Promise<CallLogWithContext[]> {
    const actor = await this.access.currentUser();
    const isManager = await this.isLeadManager(actor);
    const all = await this.callLog.list();
    const scoped = isManager ? all : all.filter((call) => call.agentUserId === actor.id);
    if (scoped.length === 0) return [];

    const leadById = new Map((await this.leads.list()).map((l) => [l.id, l]));
    const usersById = new Map((await this.phase1Repos.users.list()).map((u) => [u.id, u]));
    const customerByPhone = new Map((await this.customers.list()).map((c) => [c.phone, c]));

    return scoped
      .map((call): CallLogWithContext => {
        const lead = call.leadId ? leadById.get(call.leadId) : undefined;
        const customer = !lead ? customerByPhone.get(call.leadPhone) : undefined;
        return {
          ...call,
          agentName: usersById.get(call.agentUserId)?.displayName || call.agentUserId,
          subjectName: lead?.name || customer?.name || call.leadPhone,
          subjectLocation: lead?.location,
        };
      })
      .sort((a, b) => (b.initiatedAt || '').localeCompare(a.initiatedAt || ''));
  }

  /**
   * Stage/remarks reuse Phase8Api's exact authorization shape — a manager (LEADS_MANAGE) can
   * touch any lead; anyone else needs both the generic permission (LEAD_STAGES_MANAGE/
   * REMARKS_MANAGE — AGENT already has both) AND ownership of that specific lead.
   */
  async setLeadStage(leadId: string, stageId: string): Promise<LeadStageAssignment> {
    const actor = await this.access.require(Permissions.LEAD_STAGES_MANAGE);
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    if (!(await this.stages.get(stageId))) throw new ApiError(404, 'NOT_FOUND', 'Stage was not found.');
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    const now = Ids.now();
    const record: LeadStageAssignment = { id: leadId, leadId, stageId, setByUserId: actor.id, updatedAt: now };
    await this.leadStages.replace(leadId, record);
    await this.leads.update(leadId, { stageId });
    await this.audit.write(actor.id, 'lead.stageChanged', 'lead', leadId, { stageId });
    return record;
  }

  async getLeadStage(leadId: string): Promise<LeadStageAssignment | null> {
    const actor = await this.access.currentUser();
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    return this.leadStages.get(leadId);
  }

  async addLeadRemark(leadId: string, text: string): Promise<LeadRemark> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    await this.access.require(Permissions.REMARKS_MANAGE);
    const validText = Validation.requiredString(text, 'text');
    const remark: LeadRemark = { id: Ids.create('leadremark'), leadId, authorUserId: actor.id, text: validText, createdAt: Ids.now() };
    await this.leadRemarks.create(remark);
    await this.audit.write(actor.id, 'leadRemark.added', 'leadRemark', remark.id, { leadId });
    return remark;
  }

  /** Same authorization shape as updateLeadTags: lead's assigned agent or a lead manager. Name/phone
   * only — location/status/assignment have their own dedicated flows and stay off this endpoint. */
  async updateLeadDetails(leadId: string, patch: { name?: unknown; phone?: unknown }): Promise<Lead> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    await this.access.require(Permissions.REMARKS_MANAGE);
    const safePatch: Partial<Lead> = {};
    if (patch.name !== undefined) safePatch.name = Validation.requiredString(patch.name, 'name');
    if (patch.phone !== undefined) safePatch.phone = Phase22Validation.phone(patch.phone, 'phone');
    const record = await this.leads.update(leadId, safePatch);
    await this.audit.write(actor.id, 'lead.detailsUpdated', 'lead', leadId, { patch: safePatch });
    return record;
  }

  /** Same authorization shape as addLeadRemark: lead's assigned agent or a lead manager. Replaces the full tag set (not a single add/remove) — simplest contract for a small, client-editable list. */
  async updateLeadTags(leadId: string, tags: unknown): Promise<Lead> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    await this.access.require(Permissions.REMARKS_MANAGE);
    const validTags = Phase22Validation.tags(tags);
    const record = await this.leads.update(leadId, { tags: validTags });
    await this.audit.write(actor.id, 'lead.tagsUpdated', 'lead', leadId, { tags: validTags });
    return record;
  }

  /** Same authorization shape as updateLeadTags. Values are validated against the live
   * CustomFieldDefinition rows for entityType 'lead'; a blank/null value clears that key
   * rather than being stored, matching validateCustomFieldValues' own convention. */
  async updateLeadCustomFields(leadId: string, values: Record<string, unknown>): Promise<Lead> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    await this.access.require(Permissions.REMARKS_MANAGE);
    const definitions = await this.customFieldDefs.list();
    const validated = validateCustomFieldValues(definitions, 'lead', values || {});
    const merged: Record<string, string | number> = { ...(lead.customFields || {}) };
    for (const key of Object.keys(values || {})) {
      const raw = values[key];
      if (raw === '' || raw === null || raw === undefined) delete merged[key];
      else merged[key] = validated[key]!;
    }
    const record = await this.leads.update(leadId, { customFields: merged });
    await this.audit.write(actor.id, 'lead.customFieldsUpdated', 'lead', leadId, { patch: validated });
    return record;
  }

  /** Validates and normalizes raw line-item input against the lead's own resolved number's live
   * Product Master — snapshots name/price at add time (see QuotationLineItem's own comment) so a
   * later catalog change doesn't retroactively alter an already-built quote. */
  private async buildLineItems(numberId: string, rawItems: unknown): Promise<QuotationLineItem[]> {
    if (!Array.isArray(rawItems)) throw new ApiError(400, 'VALIDATION_ERROR', 'lineItems must be an array.');
    if (rawItems.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'A quotation needs at least one line item.');
    const catalog = new Map((await this.products.list()).filter((p) => p.numberId === numberId).map((p) => [p.id, p]));
    return rawItems.map((raw, index) => {
      const row = raw as { productId?: unknown; quantity?: unknown; discountPercent?: unknown };
      const product = catalog.get(String(row.productId));
      if (!product || !product.active) throw new ApiError(400, 'VALIDATION_ERROR', `Line item ${index + 1}: unknown or inactive product.`);
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity) || quantity < 1) throw new ApiError(400, 'VALIDATION_ERROR', `Line item ${index + 1}: quantity must be at least 1.`);
      const discountPercent = row.discountPercent === undefined ? 0 : Number(row.discountPercent);
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new ApiError(400, 'VALIDATION_ERROR', `Line item ${index + 1}: discountPercent must be between 0 and 100.`);
      return { productId: product.id, productName: product.name, unitPrice: product.unitPrice, quantity, discountPercent };
    });
  }

  /** Active catalog for the lead's own resolved WhatsApp number — what the Quotation builder's
   * product dropdown offers. Same canTouchLead gate as everything else lead-scoped; the frontend
   * has no other way to learn a lead's numberId without this (Lead itself only carries location). */
  async listProductsForLead(leadId: string): Promise<Product[]> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    const number = await this.findNumberForLocation(lead.location);
    if (!number) return [];
    return (await this.products.list()).filter((p) => p.numberId === number.id && p.active).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  async createQuotation(leadId: string, input: { lineItems: unknown; overallDiscountPercent?: unknown; notes?: string }): Promise<Quotation> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    await this.access.require(Permissions.REMARKS_MANAGE);
    const number = await this.findNumberForLocation(lead.location);
    if (!number) throw new ApiError(500, 'CONFIGURATION_ERROR', `No WhatsApp number is configured for location "${lead.location}".`);
    const lineItems = await this.buildLineItems(number.id, input.lineItems);
    const overallDiscountPercent = input.overallDiscountPercent === undefined ? 0 : Number(input.overallDiscountPercent);
    if (!Number.isFinite(overallDiscountPercent) || overallDiscountPercent < 0 || overallDiscountPercent > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'overallDiscountPercent must be between 0 and 100.');
    const now = Ids.now();
    const record: Quotation = {
      id: Ids.create('quotation'), leadId, numberId: number.id, lineItems, overallDiscountPercent,
      notes: (input.notes || '').trim(), status: 'DRAFT', createdByUserId: actor.id, createdAt: now, updatedAt: now,
    };
    await this.quotations.create(record);
    await this.audit.write(actor.id, 'quotation.created', 'quotation', record.id, { leadId });
    return record;
  }

  async updateQuotation(id: string, patch: { lineItems?: unknown; overallDiscountPercent?: unknown; notes?: string; status?: string }): Promise<Quotation> {
    const existing = await this.quotations.get(id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Quotation was not found.');
    const lead = await this.leads.get(existing.leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, existing.leadId);
    await this.access.require(Permissions.REMARKS_MANAGE);
    const safePatch: Partial<Quotation> = {};
    if (patch.lineItems !== undefined) safePatch.lineItems = await this.buildLineItems(existing.numberId, patch.lineItems);
    if (patch.overallDiscountPercent !== undefined) {
      const overallDiscountPercent = Number(patch.overallDiscountPercent);
      if (!Number.isFinite(overallDiscountPercent) || overallDiscountPercent < 0 || overallDiscountPercent > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'overallDiscountPercent must be between 0 and 100.');
      safePatch.overallDiscountPercent = overallDiscountPercent;
    }
    if (patch.notes !== undefined) safePatch.notes = patch.notes.trim();
    if (patch.status !== undefined) {
      if (patch.status !== 'DRAFT' && patch.status !== 'SENT') throw new ApiError(400, 'VALIDATION_ERROR', 'status must be DRAFT or SENT.');
      safePatch.status = patch.status;
      if (patch.status === 'SENT' && existing.status !== 'SENT') safePatch.sentAt = Ids.now();
    }
    const record = await this.quotations.update(id, safePatch);
    await this.audit.write(actor.id, 'quotation.updated', 'quotation', id, { leadId: existing.leadId });
    return record;
  }

  async listQuotations(leadId: string): Promise<Quotation[]> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    return (await this.quotations.list()).filter((q) => q.leadId === leadId).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  async getQuotation(id: string): Promise<Quotation> {
    const quotation = await this.quotations.get(id);
    if (!quotation) throw new ApiError(404, 'NOT_FOUND', 'Quotation was not found.');
    const lead = await this.leads.get(quotation.leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, quotation.leadId);
    return quotation;
  }

  async listLeadRemarks(leadId: string): Promise<LeadRemark[]> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    let hasPermission = false;
    try { await this.access.require(Permissions.REMARKS_VIEW); hasPermission = true; } catch { /* fall through to REMARKS_MANAGE */ }
    if (!hasPermission) await this.access.require(Permissions.REMARKS_MANAGE);
    return (await this.leadRemarks.list()).filter((remark) => remark.leadId === leadId).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  /**
   * Activity timeline for the Lead detail view — everything logged directly against this lead
   * (reassignment, stage/tag changes, calls) plus sub-entity actions that reference it in their
   * metadata (a remark's own audit row targets the remark, not the lead, e.g.). Excludes
   * authorization.denied — that's a security signal for Admin's Audit Log, not agent-facing
   * activity. Same view authorization as remarks/reminders.
   */
  async listLeadActivity(leadId: string): Promise<AuditEntryWithActor[]> {
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const actor = await this.access.currentUser();
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    const entries = (await this.audit.list()).filter((e) => {
      if (e.action === 'authorization.denied') return false;
      if (e.targetType === 'lead' && e.targetId === leadId) return true;
      return e.metadata?.leadId === leadId;
    });
    const usersById = new Map((await this.phase1Repos.users.list()).map((u) => [u.id, u]));
    return entries.map((e) => ({ ...e, actorName: (e.actorUserId && usersById.get(e.actorUserId)?.displayName) || e.actorUserId || 'System' }));
  }

  /**
   * Finds/creates a Customer+open Conversation for a lead's own phone number on the WhatsApp
   * number matching its location, then hands the frontend enough to jump straight into the
   * normal Inbox — reuses the existing messaging UI/send pipeline entirely rather than
   * building a parallel one. Only the lead's assigned agent (or a lead manager) can do this;
   * also requires the agent actually have numberAccess for the resolved WhatsApp number,
   * since Phase5/6's own authorization would otherwise block them from ever opening it.
   */
  async startWhatsAppFromLead(leadId: string): Promise<{ customerId: string; conversationId: string; numberId: string }> {
    const actor = await this.access.require(Permissions.LEADS_CALL);
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    if (!(await this.canTouchLead(actor, lead))) await this.denied(actor, leadId);
    const number = await this.findNumberForLocation(lead.location);
    if (!number) throw new ApiError(500, 'CONFIGURATION_ERROR', `No WhatsApp number is configured for location "${lead.location}" — its display name should include the location name (e.g. "Entartica - ${lead.location}").`);
    if (!(await this.access.hasRole(actor, Roles.ADMIN)) && !(await this.access.hasGrantedNumber(actor.id, number.id))) {
      throw new ApiError(403, 'FORBIDDEN', `You do not have access to the ${number.displayName} WhatsApp number yet — ask an admin to grant it under Settings → Number Access.`);
    }
    const now = Ids.now();
    let customer = await this.customers.findOne((c) => c.phone === lead.phone);
    if (!customer) {
      customer = { id: Ids.create('customer'), phone: lead.phone, name: lead.name, email: '', company: '', source: 'location_lead', createdAt: now, updatedAt: now };
      await this.customers.create(customer);
    }
    let conversation = await this.conversations.findOne((c) => c.customerId === customer!.id && c.numberId === number.id && c.status === 'OPEN');
    if (!conversation) {
      conversation = { id: Ids.create('conversation'), customerId: customer.id, numberId: number.id, assignedUserId: actor.id, status: 'OPEN', needsResponse: false, lastMessageAt: now, createdAt: now, updatedAt: now };
      await this.conversations.create(conversation);
      await this.audit.write(actor.id, 'conversation.createdFromLead', 'conversation', conversation.id, { leadId });
    }
    return { customerId: customer.id, conversationId: conversation.id, numberId: number.id };
  }

  /** conversation.numberId's own phoneNumber as caller ID — the lead sees the same number they're already chatting with. */
  async initiateConversationCall(conversationId: string, statusCallbackUrl?: string): Promise<CallLog> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    const actor = await this.access.requireConversationOperation('reply', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    const agentPhone = (actor.phone || '').toString().trim();
    if (!agentPhone) throw new ApiError(400, 'VALIDATION_ERROR', 'Your profile has no phone number on file — ask an admin to add one.');
    const number = await this.numbers.get(conversation.numberId);
    if (!number) throw new ApiError(404, 'NOT_FOUND', 'Number was not found.');
    const customer = await this.customers.get(conversation.customerId);
    if (!customer) throw new ApiError(404, 'NOT_FOUND', 'Customer was not found.');
    const result = await new ExotelVoiceProvider(this.requireVoiceConfig()).connectCall(agentPhone, customer.phone, number.phoneNumber, statusCallbackUrl);
    const now = Ids.now();
    const record: CallLog = { id: Ids.create('call'), leadId: '', conversationId, numberId: conversation.numberId, agentUserId: actor.id, exotelCallSid: result.callSid || '', agentPhone, leadPhone: customer.phone, callerId: result.callerId || '', status: result.status || 'INITIATED', initiatedAt: now, updatedAt: now };
    await this.callLog.create(record);
    await this.audit.write(actor.id, 'conversation.called', 'conversation', conversationId, { callId: record.id, callSid: record.exotelCallSid });
    return record;
  }

  private requireVoiceConfig(): ExotelVoiceConfig {
    if (!this.exotelVoiceConfig) throw new ApiError(500, 'CONFIGURATION_ERROR', 'Exotel Voice credentials are not fully configured.');
    return this.exotelVoiceConfig;
  }

  /**
   * Matches a location to a WhatsApp Number by displayName substring (case-insensitive) —
   * e.g. "Entartica - Raipur" for location "Raipur". Deliberately not a stored field, to
   * avoid a second config surface to keep in sync with number display names.
   *
   * `!== false` (not `=== true`) mirrors phase3Api.ts/phase8Api.ts's own numbers filtering —
   * a hand-edited number row could carry a stray non-boolean value; excluding on `=== false`
   * only fails safe (visible unless explicitly deactivated) rather than silently excluding
   * everything on a type mismatch.
   */
  private async findNumberForLocation(location: string): Promise<WhatsAppNumber | null> {
    const needle = location.toLowerCase();
    const numbers = (await this.numbers.list()).filter((n) => n.active !== false);
    return numbers.find((n) => (n.displayName || '').toLowerCase().includes(needle)) || null;
  }

  private async isLeadManager(actor: User): Promise<boolean> {
    return (await this.access.hasRole(actor, Roles.ADMIN)) || (await this.access.hasRole(actor, Roles.SITE_MANAGER));
  }

  /**
   * Isolation boundary: a manager only sees/touches leads for a location whose resolved
   * WhatsApp number (via findNumberForLocation, the same name-match startWhatsAppFromLead
   * already relies on) they actually have access to — same Team/NumberAccess grant
   * Conversations already enforce, reused rather than inventing a second access model. A
   * location that doesn't resolve to any number (not yet named to match the convention)
   * stays visible to every manager, same "unconfigured, not locked down" fallback
   * findNumberForLocation's own caller already accepts.
   */
  private async canSeeLocation(actor: User, location: string): Promise<boolean> {
    if (await this.access.hasRole(actor, Roles.ADMIN)) return true;
    const number = await this.findNumberForLocation(location);
    if (!number) return true;
    if (await this.access.hasGrantedNumber(actor.id, number.id)) return true;
    return (await this.access.resolveTeamIdForNumber(number.id)) !== null;
  }

  private async canTouchLead(actor: User, lead: Lead): Promise<boolean> {
    if (lead.assignedUserId === actor.id) return true;
    return (await this.isLeadManager(actor)) && (await this.canSeeLocation(actor, lead.location));
  }

  private async denied(actor: User, leadId: string): Promise<never> {
    await this.audit.write(actor.id, 'authorization.denied', 'lead', leadId, { reason: 'NOT_ASSIGNED_TO_CALLER' });
    throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
  }

  private async deniedLocation(actor: User, location: string): Promise<never> {
    await this.audit.write(actor.id, 'authorization.denied', 'location', location, { reason: 'NUMBER_ACCESS' });
    throw new ApiError(403, 'FORBIDDEN', `You do not have access to the ${location} location.`);
  }

  private async assignLead(lead: Lead): Promise<Lead> {
    const config = await this.locationConfig.findOne((record) => record.location === lead.location);
    if (!config || config.active !== true || config.mode === Phase22AssignmentModes.MANUAL) {
      return this.leads.update(lead.id, { status: Phase22LeadStatus.UNASSIGNED });
    }
    if (config.mode === Phase22AssignmentModes.SINGLE) {
      if (!config.singleUserId) return this.leads.update(lead.id, { status: Phase22LeadStatus.UNASSIGNED });
      return this.finalizeAssignment(lead, config.singleUserId, 'single');
    }
    const selected = await this.selectNextLocationAgent(lead.location as Phase22Location, config);
    if (!selected) return this.leads.update(lead.id, { status: Phase22LeadStatus.UNASSIGNED });
    await this.locationConfig.update(config.id, { lastAssignedUserId: selected });
    return this.finalizeAssignment(lead, selected, 'round_robin');
  }

  private async finalizeAssignment(lead: Lead, userId: string, reason: string): Promise<Lead> {
    const record = await this.leads.update(lead.id, { status: Phase22LeadStatus.ASSIGNED, assignedUserId: userId, assignedAt: Ids.now() });
    await this.audit.write(null, 'lead.assigned', 'lead', lead.id, { userId, reason });
    return record;
  }

  private async selectNextLocationAgent(location: Phase22Location, config: LocationAssignmentConfig): Promise<string | null> {
    const participants = (await this.locationUsers.list())
      .filter((p) => p.location === location && p.active !== false)
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    const eligible: string[] = [];
    for (const p of participants) {
      const user = await this.phase1Repos.users.get(p.userId);
      if (user && user.status === Status.ACTIVE) eligible.push(p.userId);
    }
    if (!eligible.length) return null;
    const lastIndex = eligible.indexOf(config.lastAssignedUserId);
    return eligible[(lastIndex + 1) % eligible.length]!;
  }
}
