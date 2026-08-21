/** Direct port of apps-script/src/Phase8Domain.gs + Phase8Services.gs's Phase8Api — lead stages, customer stage, remarks, customer directory. */
import { ApiError } from '../types';
import { Ids, Permissions, Roles, Validation } from '../domain/phase1';
import { Phase22Validation } from '../domain/phase22';
import type { Conversation, Customer, CustomerStage, Remark, Stage, User } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

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

  constructor(db: FirebaseDb, identityEmail: string) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.stages = new Repository<Stage>(db, 'stages');
    this.customerStages = new Repository<CustomerStage>(db, 'customerStages');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.remarks = new Repository<Remark>(db, 'remarks');
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
    return created;
  }

  async createStage(input: { key: string; name: string; sequenceOrder?: number; active?: boolean }): Promise<Stage> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    const key = Validation.requiredString(input.key, 'key');
    if (await this.stages.findOne((s) => s.key === key)) throw new ApiError(409, 'CONFLICT', 'A stage with this key already exists.');
    const now = Ids.now();
    const record: Stage = { id: Ids.create('stage'), key, name: Validation.requiredString(input.name, 'name'), sequenceOrder: input.sequenceOrder || (await this.stages.count()) + 1, active: input.active !== false, createdAt: now, updatedAt: now };
    await this.stages.create(record);
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
    await this.audit.write(actor.id, 'leadStage.updated', 'leadStage', id, {});
    return record;
  }

  async listStages(): Promise<Stage[]> {
    await this.access.currentUser(); // any authenticated user may see the stage list
    return (await this.stages.list()).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
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
    const allowed = ['name', 'email', 'company', 'tags'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = key === 'tags' ? Phase22Validation.tags(patch[key]) : patch[key];
    }
    const record = await this.customers.update(customerId, safePatch as Partial<Customer>);
    await this.audit.write(actor.id, 'customer.updated', 'customer', customerId, {});
    return record;
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
