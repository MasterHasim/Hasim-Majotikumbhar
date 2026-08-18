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
  CallLog, Conversation, Customer, Lead, LeadRemark, LeadStageAssignment, LocationAssignmentConfig,
  LocationAssignmentUser, Stage, User, WhatsAppNumber,
} from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { ExotelVoiceProvider, requireExotelVoiceConfig, type ExotelVoiceConfig } from './exotelVoiceProvider';

export interface UploadLeadsResult {
  batchId: string;
  created: number;
  skipped: number;
  errors: { index: number; row: unknown; message: string }[];
}

export class Phase22Api {
  readonly access: AccessControl;
  private phase1Repos: Phase1Repositories;
  private audit: AuditLogService;
  private leads: Repository<Lead>;
  private locationConfig: Repository<LocationAssignmentConfig>;
  private locationUsers: Repository<LocationAssignmentUser>;
  private callLog: Repository<CallLog>;
  private stages: Repository<Stage>;
  private leadStages: Repository<LeadStageAssignment>;
  private leadRemarks: Repository<LeadRemark>;
  private customers: Repository<Customer>;
  private conversations: Repository<Conversation>;
  private numbers: Repository<WhatsAppNumber>;
  private exotelVoiceConfig?: ExotelVoiceConfig;

  constructor(private db: FirebaseDb, identityEmail: string, env?: { EXOTEL_VOICE_ACCOUNT_SID?: string; EXOTEL_VOICE_API_KEY?: string; EXOTEL_VOICE_API_TOKEN?: string; EXOTEL_VOICE_CALLER_ID?: string }) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.leads = new Repository<Lead>(db, 'leads');
    this.locationConfig = new Repository<LocationAssignmentConfig>(db, 'locationAssignmentConfig');
    this.locationUsers = new Repository<LocationAssignmentUser>(db, 'locationAssignmentUsers');
    this.callLog = new Repository<CallLog>(db, 'callLog');
    this.stages = new Repository<Stage>(db, 'stages');
    this.leadStages = new Repository<LeadStageAssignment>(db, 'leadStageAssignments');
    this.leadRemarks = new Repository<LeadRemark>(db, 'leadRemarks');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'conversations');
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
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

  async reassignLead(leadId: string, userId: string): Promise<Lead> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    const validUserId = Validation.requiredString(userId, 'userId');
    if (!(await this.phase1Repos.users.get(validUserId))) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
    const record = await this.leads.update(leadId, { status: Phase22LeadStatus.ASSIGNED, assignedUserId: validUserId, assignedAt: Ids.now() });
    await this.audit.write(actor.id, 'lead.reassigned', 'lead', leadId, { userId: validUserId });
    return record;
  }

  /** ADMIN/SITE_MANAGER (LEADS_MANAGE) see every lead; AGENT (LEADS_VIEW_ASSIGNED) sees only their own. */
  async listLeads(filters: { location?: string; status?: string; assignedUserId?: string } = {}): Promise<Lead[]> {
    const actor = await this.access.currentUser();
    const isManager = await this.isLeadManager(actor);
    if (isManager) await this.access.require(Permissions.LEADS_MANAGE);
    else await this.access.require(Permissions.LEADS_VIEW_ASSIGNED);
    const all = await this.leads.list();
    const scoped = isManager ? all : all.filter((lead) => lead.assignedUserId === actor.id);
    return scoped
      .filter((lead) => (!filters.location || lead.location === filters.location) && (!filters.status || lead.status === filters.status) && (!filters.assignedUserId || lead.assignedUserId === filters.assignedUserId))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  async getLocationConfig(location: string): Promise<LocationAssignmentConfig | null> {
    await this.access.require(Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
    return this.locationConfig.findOne((record) => record.location === location);
  }

  async setLocationConfig(location: string, patch: Record<string, unknown>): Promise<LocationAssignmentConfig> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
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
    await this.access.require(Permissions.LEADS_MANAGE);
    return (await this.locationUsers.list()).filter((p) => p.location === location).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  async addLocationParticipant(location: string, userId: string, sequenceOrder?: number): Promise<LocationAssignmentUser> {
    const actor = await this.access.require(Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
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
    if (!(await this.locationUsers.get(id))) throw new ApiError(404, 'NOT_FOUND', 'Location participant was not found.');
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

  /** AGENT-only, and only for a lead assigned to themselves — an admin never places calls through this path. */
  async initiateCall(leadId: string): Promise<CallLog> {
    const actor = await this.access.require(Permissions.LEADS_CALL);
    const lead = await this.leads.get(leadId);
    if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead was not found.');
    if (lead.assignedUserId !== actor.id) {
      await this.audit.write(actor.id, 'authorization.denied', 'lead', leadId, { reason: 'NOT_ASSIGNED_TO_CALLER' });
      throw new ApiError(403, 'FORBIDDEN', 'This lead is not assigned to you.');
    }
    const agentPhone = (actor.phone || '').toString().trim();
    if (!agentPhone) throw new ApiError(400, 'VALIDATION_ERROR', 'Your profile has no phone number on file — ask an admin to add one.');
    const locationConfig = await this.locationConfig.findOne((record) => record.location === lead.location);
    const result = await new ExotelVoiceProvider(this.requireVoiceConfig()).connectCall(agentPhone, lead.phone, locationConfig?.callerId);
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
  async initiateConversationCall(conversationId: string): Promise<CallLog> {
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
    const result = await new ExotelVoiceProvider(this.requireVoiceConfig()).connectCall(agentPhone, customer.phone, number.phoneNumber);
    const now = Ids.now();
    const record: CallLog = { id: Ids.create('call'), leadId: '', agentUserId: actor.id, exotelCallSid: result.callSid || '', agentPhone, leadPhone: customer.phone, callerId: result.callerId || '', status: result.status || 'INITIATED', initiatedAt: now, updatedAt: now };
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

  private async canTouchLead(actor: User, lead: Lead): Promise<boolean> {
    return (await this.isLeadManager(actor)) || lead.assignedUserId === actor.id;
  }

  private async denied(actor: User, leadId: string): Promise<never> {
    await this.audit.write(actor.id, 'authorization.denied', 'lead', leadId, { reason: 'NOT_ASSIGNED_TO_CALLER' });
    throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
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
