/** Direct port of apps-script/src/Phase8Domain.gs + Phase8Services.gs's Phase8Api — lead stages, customer stage, remarks, customer directory. */
import { ApiError } from '../types';
import { Ids, Permissions, Roles, Validation } from '../domain/phase1';
import { Phase22Validation } from '../domain/phase22';
import type { Conversation, Customer, CustomerStage, CustomFieldDefinition, Remark, Stage, User } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService, type AuditEntryWithActor } from '../lib/auditLog';
import { AppDb } from '../lib/appDb';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { validateCustomFieldValues } from './customFieldsApi';
import { enqueueCustomerSync, type CustomerSyncQueue } from './zohoCrm';
import { cachedList, invalidateCache } from '../lib/kvCache';

const STAGES_CACHE_KEY = 'stages:all';

const DEFAULT_STAGES = [
  { key: 'new_leads', name: 'New Leads' },
  { key: 'contacted', name: 'Contacted' },
  { key: 'interested', name: 'Interested' },
  { key: 'not_interested', name: 'Not Interested' },
  { key: 'lead_won', name: 'Lead Won' },
  { key: 'lead_lost', name: 'Lead Lost' },
];

export class Phase8Api {
  readonly access: AccessControl;
  private phase1Repos: Phase1Repositories;
  private audit: AuditLogService;
  private stages: Repository<Stage>;
  private customerStages: Repository<CustomerStage>;
  private customers: Repository<Customer>;
  private conversations: Repository<Conversation>;
  private remarks: Repository<Remark>;
  private customFieldDefs: Repository<CustomFieldDefinition>;

  constructor(db: AppDb, identityEmail: string, private customerSyncQueue?: CustomerSyncQueue, private cache?: KVNamespace) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.stages = new Repository<Stage>(db, 'stages');
    this.customerStages = new Repository<CustomerStage>(db, 'customerStages');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.remarks = new Repository<Remark>(db, 'remarks');
    this.customFieldDefs = new Repository<CustomFieldDefinition>(db, 'customFieldDefinitions');
  }

  async seedDefaultLeadStages(): Promise<Stage[]> {
    await this.access.require(Permissions.SETTINGS_MANAGE);
    if ((await this.stages.count()) > 0) throw new ApiError(409, 'CONFLICT', 'Lead stages already exist; seed only runs on an empty list.');
    const now = Ids.now();
    const created: Stage[] = [];
    for (let i = 0; i < DEFAULT_STAGES.length; i++) {
      const s = DEFAULT_STAGES[i]!;
      const record: Stage = { id: Ids.create('stage'), key: s.key, name: s.name, sequenceOrder: i + 1, active: true, createdAt: now, updatedAt: now };
      await this.stages.create(record);
      created.push(record);
    }
    await invalidateCache(this.cache, STAGES_CACHE_KEY);
    return created;
  }

  async createStage(input: { key: string; name: string; sequenceOrder?: number; active?: boolean }): Promise<Stage> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    const key = Validation.requiredString(input.key, 'key');
    if (await this.stages.findOne((s) => s.key === key)) throw new ApiError(409, 'CONFLICT', 'A stage with this key already exists.');
    const now = Ids.now();
    const record: Stage = { id: Ids.create('stage'), key, name: Validation.requiredString(input.name, 'name'), sequenceOrder: input.sequenceOrder || (await this.stages.count()) + 1, active: input.active !== false, createdAt: now, updatedAt: now };
    await this.stages.create(record);
    await invalidateCache(this.cache, STAGES_CACHE_KEY);
    await this.audit.write(actor.id, 'leadStage.created', 'leadStage', record.id, {});
    return record;
  }

  async updateStage(id: string, patch: Record<string, unknown>): Promise<Stage> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    if (!(await this.stages.get(id))) throw new ApiError(404, 'NOT_FOUND', 'Stage was not found.');
    const allowed = ['name', 'sequenceOrder', 'active'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    const record = await this.stages.update(id, safePatch as Partial<Stage>);
    await invalidateCache(this.cache, STAGES_CACHE_KEY);
    await this.audit.write(actor.id, 'leadStage.updated', 'leadStage', id, {});
    return record;
  }

  async listStages(): Promise<Stage[]> {
    await this.access.currentUser(); // any authenticated user may see the stage list
    return cachedList(this.cache, STAGES_CACHE_KEY, async () => (await this.stages.list()).sort((a, b) => a.sequenceOrder - b.sequenceOrder));
  }

  async setCustomerStage(customerId: string, stageId: string): Promise<CustomerStage> {
    const actor = await this.access.require(Permissions.LEAD_STAGES_MANAGE);
    if (!(await this.customers.get(customerId))) throw new ApiError(404, 'NOT_FOUND', 'Customer was not found.');
    if (!(await this.stages.get(stageId))) throw new ApiError(404, 'NOT_FOUND', 'Stage was not found.');
    if (!(await this.access.hasRole(actor, Roles.ADMIN)) && !(await this.canSeeCustomer(actor, customerId))) {
      throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
    }
    const now = Ids.now();
    const record: CustomerStage = { id: customerId, customerId, stageId, setByUserId: actor.id, updatedAt: now };
    await this.customerStages.replace(customerId, record);
    await this.audit.write(actor.id, 'customer.stageChanged', 'customer', customerId, { stageId });
    return record;
  }

  async getCustomerStage(customerId: string): Promise<CustomerStage | null> {
    const actor = await this.access.currentUser();
    if (!(await this.access.hasRole(actor, Roles.ADMIN)) && !(await this.canSeeCustomer(actor, customerId))) {
      throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
    }
    return this.customerStages.get(customerId);
  }

  async addRemark(conversationId: string, text: string): Promise<Remark> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    const actor = await this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    await this.access.require(Permissions.REMARKS_MANAGE);
    const validText = Validation.requiredString(text, 'text');
    const remark: Remark = { id: Ids.create('remark'), conversationId, authorUserId: actor.id, text: validText, createdAt: Ids.now() };
    await this.remarks.create(remark);
    await this.audit.write(actor.id, 'remark.added', 'remark', remark.id, { conversationId });
    return remark;
  }

  async listRemarks(conversationId: string): Promise<Remark[]> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    await this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    let hasPermission = false;
    try { await this.access.require(Permissions.REMARKS_VIEW); hasPermission = true; } catch { /* fall through to REMARKS_MANAGE */ }
    if (!hasPermission) await this.access.require(Permissions.REMARKS_MANAGE);
    return (await this.remarks.list()).filter((r) => r.conversationId === conversationId).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  /** ADMIN sees every customer; anyone else sees only customers they have at least one viewable conversation with. numberId is optional, narrows to customers with a conversation on that number. */
  async listCustomers(numberId?: string): Promise<Customer[]> {
    const actor = await this.access.currentUser();
    let customerIdsForNumber: Set<string> | null = null;
    if (numberId) {
      const conversations = await this.conversations.list();
      customerIdsForNumber = new Set(conversations.filter((c) => c.numberId === numberId).map((c) => c.customerId));
    }
    const customers = (await this.customers.list()).filter((c) => !customerIdsForNumber || customerIdsForNumber.has(c.id));
    if (await this.access.hasRole(actor, Roles.ADMIN)) return customers;
    const visible: Customer[] = [];
    for (const customer of customers) {
      if (await this.canSeeCustomer(actor, customer.id)) visible.push(customer);
    }
    return visible;
  }

  /** Editing contact details — not phone, which stays read-only since Phase4Api's ingestion matches inbound messages against it. */
  async updateCustomer(customerId: string, patch: Record<string, unknown>): Promise<Customer> {
    const actor = await this.access.currentUser();
    if (!(await this.customers.get(customerId))) throw new ApiError(404, 'NOT_FOUND', 'Customer was not found.');
    if (!(await this.access.hasRole(actor, Roles.ADMIN)) && !(await this.canSeeCustomer(actor, customerId))) {
      throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
    }
    const allowed = ['name', 'email', 'company', 'tags', 'customFields'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      if (key === 'tags') safePatch[key] = Phase22Validation.tags(patch[key]);
      else if (key === 'customFields') {
        const existing = await this.customers.get(customerId);
        const definitions = await this.customFieldDefs.list();
        const submitted = (patch[key] || {}) as Record<string, unknown>;
        const validated = validateCustomFieldValues(definitions, 'customer', submitted);
        const merged: Record<string, string | number> = { ...(existing?.customFields || {}) };
        for (const fieldKey of Object.keys(submitted)) {
          const raw = submitted[fieldKey];
          if (raw === '' || raw === null || raw === undefined) delete merged[fieldKey];
          else merged[fieldKey] = validated[fieldKey]!;
        }
        safePatch[key] = merged;
      } else safePatch[key] = patch[key];
    }
    const record = await this.customers.update(customerId, safePatch as Partial<Customer>);
    await this.audit.write(actor.id, 'customer.updated', 'customer', customerId, { patch: safePatch });
    await enqueueCustomerSync(this.customerSyncQueue, record.id);
    return record;
  }

  /**
   * Activity timeline for the Inbox detail panel — matches entries targeting this conversation
   * directly (calls, snooze, reassignment) or the conversation's own customer (stage changes,
   * contact edits), plus anything that names either id in its metadata (a remark's own audit row
   * targets the remark, not the conversation). Excludes authorization.denied — that's a security
   * signal for Admin's Audit Log, not agent-facing activity.
   */
  async listConversationActivity(conversationId: string): Promise<AuditEntryWithActor[]> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    await this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    const customerId = conversation.customerId;
    const entries = (await this.audit.list()).filter((e) => {
      if (e.action === 'authorization.denied') return false;
      if (e.targetType === 'conversation' && e.targetId === conversationId) return true;
      if (e.targetType === 'customer' && e.targetId === customerId) return true;
      return e.metadata?.conversationId === conversationId;
    });
    const usersById = new Map((await this.phase1Repos.users.list()).map((u) => [u.id, u]));
    return entries.map((e) => ({ ...e, actorName: (e.actorUserId && usersById.get(e.actorUserId)?.displayName) || e.actorUserId || 'System' }));
  }

  private async canSeeCustomer(actor: User, customerId: string): Promise<boolean> {
    const conversations = (await this.conversations.list()).filter((c) => c.customerId === customerId);
    for (const conversation of conversations) {
      try {
        const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
        await this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
        return true;
      } catch {
        // not visible via this conversation — keep checking others
      }
    }
    return false;
  }
}
