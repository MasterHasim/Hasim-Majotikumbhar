/**
 * Direct port of apps-script/src/Phase7Services.gs's Phase7Api (round-robin
 * assignment engine) plus the Number_Assignment_Config/Users admin CRUD that
 * apps-script/src/Phase12Services.gs added later — folded in here rather than
 * deferred to the admin-panel migration phase, since round-robin is
 * functionally unusable without a way to configure it, and it's a small
 * addition. Same NUMBERS_ADMIN gate the source uses for the config CRUD.
 *
 * Known simplification vs. the source: the read-pointer -> select ->
 * update-pointer sequence isn't wrapped in a distributed lock the way Apps
 * Script's LockService wrapped it (see src/lib/repository.ts's own note on
 * this same trade-off) — two near-simultaneous new leads on the same number
 * could theoretically land on the same agent. Low-risk for this app's actual
 * write volume; worth revisiting with Firebase's conditional-write support if
 * that ever changes.
 */
import { ApiError } from '../types';
import { Ids, Permissions, Roles, Status, Validation } from '../domain/phase1';
import type { AssignmentRecord, Conversation, NumberAssignmentConfig, NumberAssignmentUser, User, WhatsAppNumber } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

export class NumberAssignmentConfigApi {
  private access: AccessControl;
  private audit: AuditLogService;
  private phase1Repos: Phase1Repositories;
  private numbers: Repository<WhatsAppNumber>;
  config: Repository<NumberAssignmentConfig>;
  users: Repository<NumberAssignmentUser>;

  constructor(db: FirebaseDb, identityEmail: string) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.config = new Repository<NumberAssignmentConfig>(db, 'numberAssignmentConfig');
    this.users = new Repository<NumberAssignmentUser>(db, 'numberAssignmentUsers');
  }

  async getNumberAssignmentConfig(numberId: string): Promise<NumberAssignmentConfig | null> {
    await this.access.require(Permissions.NUMBERS_ADMIN);
    return this.config.findOne((c) => c.numberId === numberId);
  }

  async setNumberAssignmentConfig(numberId: string, patch: Record<string, unknown>): Promise<NumberAssignmentConfig> {
    const actor = await this.access.require(Permissions.NUMBERS_ADMIN);
    if (!(await this.numbers.get(numberId))) throw new ApiError(404, 'NOT_FOUND', 'Number was not found.');
    const allowed = ['roundRobinEnabled', 'fallbackUserId', 'workingHoursStart', 'workingHoursEnd'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    const existing = await this.config.findOne((c) => c.numberId === numberId);
    let record: NumberAssignmentConfig;
    if (existing) {
      record = await this.config.update(existing.id, safePatch);
    } else {
      const now = Ids.now();
      record = { id: Ids.create('assignconfig'), numberId, roundRobinEnabled: false, fallbackUserId: '', workingHoursStart: '', workingHoursEnd: '', lastAssignedUserId: '', createdAt: now, updatedAt: now, ...safePatch };
      await this.config.create(record);
    }
    await this.audit.write(actor.id, 'assignmentConfig.updated', 'numberAssignmentConfig', record.id, { numberId });
    return record;
  }

  async listAssignmentParticipants(numberId: string): Promise<NumberAssignmentUser[]> {
    await this.access.require(Permissions.NUMBERS_ADMIN);
    return (await this.users.list()).filter((p) => p.numberId === numberId).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  async addAssignmentParticipant(numberId: string, userId: string, sequenceOrder?: number): Promise<NumberAssignmentUser> {
    const actor = await this.access.require(Permissions.NUMBERS_ADMIN);
    if (!(await this.numbers.get(numberId))) throw new ApiError(404, 'NOT_FOUND', 'Number was not found.');
    if (!(await this.phase1Repos.users.get(userId))) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
    if (await this.users.findOne((p) => p.numberId === numberId && p.userId === userId)) throw new ApiError(409, 'CONFLICT', 'User is already a participant for this number.');
    const now = Ids.now();
    const record: NumberAssignmentUser = { id: Ids.create('assignuser'), numberId, userId, sequenceOrder: sequenceOrder || 1, active: true, createdAt: now, updatedAt: now };
    await this.users.create(record);
    await this.audit.write(actor.id, 'assignmentParticipant.added', 'numberAssignmentUser', record.id, { numberId, userId });
    return record;
  }

  async updateAssignmentParticipant(id: string, patch: Record<string, unknown>): Promise<NumberAssignmentUser> {
    const actor = await this.access.require(Permissions.NUMBERS_ADMIN);
    if (!(await this.users.get(id))) throw new ApiError(404, 'NOT_FOUND', 'Assignment participant was not found.');
    const allowed = ['sequenceOrder', 'active'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    const record = await this.users.update(id, safePatch as Partial<NumberAssignmentUser>);
    await this.audit.write(actor.id, 'assignmentParticipant.updated', 'numberAssignmentUser', id, {});
    return record;
  }
}

export class Phase7Api {
  readonly access: AccessControl;
  private phase1Repos: Phase1Repositories;
  private audit: AuditLogService;
  private conversations: Repository<Conversation>;
  private assignments: Repository<AssignmentRecord>;
  private assignConfig: Repository<NumberAssignmentConfig>;
  private assignUsers: Repository<NumberAssignmentUser>;

  constructor(private db: FirebaseDb, identityEmail: string) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.assignments = new Repository<AssignmentRecord>(db, 'assignments');
    this.assignConfig = new Repository<NumberAssignmentConfig>(db, 'numberAssignmentConfig');
    this.assignUsers = new Repository<NumberAssignmentUser>(db, 'numberAssignmentUsers');
  }

  /** Called by Phase4Api right after a brand-new conversation is created — no AccessControl check, same system-level operation as the webhook ingestion that calls it. */
  async assignConversation(conversation: Conversation, isNewCustomer: boolean): Promise<string | null> {
    if (!isNewCustomer) {
      const priorOwner = await this.determinePriorOwner(conversation.customerId);
      if (priorOwner) {
        await this.conversations.update(conversation.id, { assignedUserId: priorOwner });
        await this.recordAssignment(conversation.id, priorOwner, null, 'returning_customer');
        return priorOwner;
      }
    }
    return this.assignNewLead(conversation);
  }

  async reassignConversation(conversationId: string, newUserId: string): Promise<Conversation> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    const actor = await this.access.requireConversationOperation('reassign', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    const validUserId = Validation.requiredString(newUserId, 'newUserId');
    if (!(await this.phase1Repos.users.get(validUserId))) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
    await this.conversations.update(conversationId, { assignedUserId: validUserId });
    await this.recordAssignment(conversationId, validUserId, actor.id, 'manual');
    return (await this.conversations.get(conversationId))!;
  }

  /** ADMIN gets every active user; SUPERVISOR/SITE_MANAGER get active members of the team covering numberId; anyone else is denied. */
  async listAssignableUsers(numberId: string): Promise<User[]> {
    const actor = await this.access.currentUser();
    if (await this.access.hasRole(actor, Roles.ADMIN)) {
      return (await this.phase1Repos.users.list()).filter((u) => u.status === Status.ACTIVE);
    }
    const teamId = await this.access.resolveTeamIdForNumber(numberId);
    if (!teamId) throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
    await this.access.requireTeamOperation(Permissions.CONVERSATIONS_REASSIGN_TEAM, teamId);
    // numberIds can be undefined for a "blank = all numbers" member — RTDB drops empty arrays on write (see phase1Api.ts's evaluate()).
    const members = (await this.phase1Repos.teamMembers.list()).filter((m) => m.teamId === teamId && m.status === Status.ACTIVE && ((m.numberIds ?? []).length === 0 || (m.numberIds ?? []).includes(numberId)));
    const users: User[] = [];
    for (const member of members) {
      const user = await this.phase1Repos.users.get(member.userId);
      if (user && user.status === Status.ACTIVE) users.push(user);
    }
    return users;
  }

  async listAssignmentHistory(conversationId: string): Promise<AssignmentRecord[]> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    await this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    return (await this.assignments.list()).filter((r) => r.conversationId === conversationId).sort((a, b) => (a.assignedAt || '').localeCompare(b.assignedAt || ''));
  }

  private async assignNewLead(conversation: Conversation): Promise<string | null> {
    const config = await this.assignConfig.findOne((c) => c.numberId === conversation.numberId);
    if (!config || config.roundRobinEnabled !== true || !this.isWithinWorkingHours(config)) {
      return this.applyFallbackOrLeaveUnassigned(conversation, config);
    }
    const selectedUserId = await this.selectNextAgent(conversation.numberId, config);
    if (!selectedUserId) return this.applyFallbackOrLeaveUnassigned(conversation, config);
    await this.conversations.update(conversation.id, { assignedUserId: selectedUserId });
    await this.assignConfig.update(config.id, { lastAssignedUserId: selectedUserId });
    await this.recordAssignment(conversation.id, selectedUserId, null, 'round_robin');
    return selectedUserId;
  }

  private async applyFallbackOrLeaveUnassigned(conversation: Conversation, config: NumberAssignmentConfig | null): Promise<string | null> {
    const fallback = config?.fallbackUserId;
    if (fallback) {
      await this.conversations.update(conversation.id, { assignedUserId: fallback });
      await this.recordAssignment(conversation.id, fallback, null, 'fallback');
      return fallback;
    }
    return null;
  }

  private async determinePriorOwner(customerId: string): Promise<string | null> {
    const priorConversations = (await this.conversations.list()).filter((c) => c.customerId === customerId && c.assignedUserId);
    if (!priorConversations.length) return null;
    priorConversations.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return priorConversations[0]!.assignedUserId;
  }

  private async selectNextAgent(numberId: string, config: NumberAssignmentConfig): Promise<string | null> {
    const eligible = await this.getEligibleAgentIds(numberId);
    if (!eligible.length) return null;
    const lastIndex = eligible.indexOf(config.lastAssignedUserId);
    return eligible[(lastIndex + 1) % eligible.length]!;
  }

  private async getEligibleAgentIds(numberId: string): Promise<string[]> {
    const participants = (await this.assignUsers.list())
      .filter((p) => p.numberId === numberId && p.active !== false)
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    const eligible: string[] = [];
    for (const p of participants) {
      const user = await this.phase1Repos.users.get(p.userId);
      if (!user || user.status !== Status.ACTIVE) continue;
      const eligibility = await this.db.get<{ eligible: boolean }>(`assignmentEligibility/${p.userId}:${numberId}`);
      if (!eligibility || eligibility.eligible !== true) continue;
      const availability = await this.db.get<{ status: string }>(`availability/${p.userId}`);
      if (!availability || availability.status !== 'available') continue;
      const grant = await this.phase1Repos.numberAccess.findOne((item) => item.userId === p.userId && item.numberId === numberId && item.status === Status.ACTIVE && item.granted === true);
      if (!grant) continue;
      eligible.push(p.userId);
    }
    return eligible;
  }

  /** HH:MM string comparison in Asia/Kolkata; unconfigured start/end means no restriction. Doesn't handle overnight ranges — not needed by any current number, same as the source. */
  private isWithinWorkingHours(config: NumberAssignmentConfig | null): boolean {
    if (!config?.workingHoursStart || !config?.workingHoursEnd) return true;
    const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    return now >= config.workingHoursStart && now <= config.workingHoursEnd;
  }

  private async recordAssignment(conversationId: string, userId: string, assignedBy: string | null, reason: string): Promise<void> {
    const now = Ids.now();
    await this.assignments.create({ id: Ids.create('assignment'), conversationId, userId, assignedBy: assignedBy || '', assignedAt: now, reason });
    await this.audit.write(assignedBy || null, 'conversation.assigned', 'conversation', conversationId, { userId, reason });
  }
}
