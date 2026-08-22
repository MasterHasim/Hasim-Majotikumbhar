/**
 * Direct port of apps-script/src/Phase9Domain.gs + Phase9Services.gs's Phase9Api —
 * reminders and snooze. Snooze is a distinct concept from reminders — it just marks
 * a conversation to (auto-)disappear from Phase5Api's active list until
 * snoozedUntil, checked by comparison on every read, no scheduled job.
 */
import { ApiError } from '../types';
import { Ids, Permissions, Validation } from '../domain/phase1';
import type { Conversation, ConversationSnooze, Customer, Reminder, ReminderStatus, ReminderWithContext, User } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

export class Phase9Api {
  readonly access: AccessControl;
  private phase1Repos: Phase1Repositories;
  private audit: AuditLogService;
  private reminders: Repository<Reminder>;
  private snoozes: Repository<ConversationSnooze>;
  private conversations: Repository<Conversation>;
  private customers: Repository<Customer>;

  constructor(db: FirebaseDb, identityEmail: string) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.reminders = new Repository<Reminder>(db, 'reminders');
    this.snoozes = new Repository<ConversationSnooze>(db, 'conversationSnoozes');
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.customers = new Repository<Customer>(db, 'customers');
  }

  async createReminder(conversationId: string, text: string, dueAt: string): Promise<Reminder> {
    const actor = await this.requireReminderAccess(conversationId);
    const validText = Validation.requiredString(text, 'text');
    const validDueAt = Validation.requiredString(dueAt, 'dueAt');
    const now = Ids.now();
    const reminder: Reminder = { id: Ids.create('reminder'), conversationId, ownerUserId: actor.id, text: validText, dueAt: validDueAt, status: 'PENDING', createdAt: now, updatedAt: now };
    await this.reminders.create(reminder);
    await this.audit.write(actor.id, 'reminder.created', 'reminder', reminder.id, { conversationId });
    return reminder;
  }

  async updateReminderStatus(reminderId: string, status: string): Promise<Reminder> {
    const reminder = await this.reminders.get(reminderId);
    if (!reminder) throw new ApiError(404, 'NOT_FOUND', 'Reminder was not found.');
    const actor = await this.requireReminderAccess(reminder.conversationId);
    const validStatus = Validation.enumValue<ReminderStatus>(status, ['PENDING', 'COMPLETED', 'CANCELLED'], 'status');
    const record = await this.reminders.update(reminderId, { status: validStatus });
    await this.audit.write(actor.id, 'reminder.statusChanged', 'reminder', reminderId, { status: validStatus, conversationId: reminder.conversationId });
    return record;
  }

  async listReminders(conversationId: string): Promise<Reminder[]> {
    await this.requireReminderView(conversationId);
    return (await this.reminders.list()).filter((r) => r.conversationId === conversationId).sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
  }

  /**
   * Pending reminders owned by the signed-in user, enriched with who each one is for and
   * which conversation/number to jump into — one bulk read of conversations/customers each,
   * not a per-reminder fetch (the previous version called this.conversations.get() inside a
   * loop when numberId was set; N+1 network round trips for what should be one read).
   * numberId is optional — narrows to reminders on conversations for that number.
   */
  async listMyReminders(numberId?: string): Promise<ReminderWithContext[]> {
    const actor = await this.access.currentUser();
    const pending = (await this.reminders.list()).filter((r) => r.ownerUserId === actor.id && r.status === 'PENDING');
    const conversationById = new Map((await this.conversations.list()).map((c) => [c.id, c]));
    const customerById = new Map((await this.customers.list()).map((c) => [c.id, c]));

    const enriched: ReminderWithContext[] = [];
    for (const reminder of pending) {
      const conversation = conversationById.get(reminder.conversationId);
      if (!conversation) continue; // orphaned reminder (conversation since deleted) — skip rather than error
      if (numberId && conversation.numberId !== numberId) continue;
      const customer = customerById.get(conversation.customerId);
      enriched.push({
        ...reminder,
        numberId: conversation.numberId,
        customerId: conversation.customerId,
        customerName: customer?.name || customer?.phone || 'Unknown',
        customerPhone: customer?.phone || '',
      });
    }
    return enriched.sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
  }

  async snoozeConversation(conversationId: string, until: string): Promise<ConversationSnooze> {
    const actor = await this.requireReminderAccess(conversationId);
    const validUntil = Validation.requiredString(until, 'until');
    const record: ConversationSnooze = { id: conversationId, conversationId, snoozedUntil: validUntil, snoozedByUserId: actor.id, createdAt: Ids.now() };
    await this.snoozes.replace(conversationId, record);
    await this.audit.write(actor.id, 'conversation.snoozed', 'conversation', conversationId, { until: validUntil });
    return record;
  }

  async unsnoozeConversation(conversationId: string): Promise<{ conversationId: string; snoozed: false }> {
    const actor = await this.requireReminderAccess(conversationId);
    if (await this.snoozes.get(conversationId)) await this.snoozes.remove(conversationId);
    await this.audit.write(actor.id, 'conversation.unsnoozed', 'conversation', conversationId, {});
    return { conversationId, snoozed: false };
  }

  async getSnoozeStatus(conversationId: string): Promise<{ snoozed: boolean; snoozedUntil?: string }> {
    await this.requireReminderView(conversationId);
    const record = await this.snoozes.get(conversationId);
    if (!record || record.snoozedUntil <= Ids.now()) return { snoozed: false };
    return { snoozed: true, snoozedUntil: record.snoozedUntil };
  }

  private async requireReminderAccess(conversationId: string): Promise<User> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    await this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    return this.access.require(Permissions.REMINDERS_MANAGE);
  }

  private async requireReminderView(conversationId: string): Promise<User> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    return this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
  }
}

/** Shared helper (not class-scoped) so Phase5Api's conversation list can exclude currently-snoozed conversations without a full Phase9Api instance — same reasoning as apps-script/src/Phase9Domain.gs's isConversationSnoozed_. */
export async function isConversationSnoozed(db: FirebaseDb, conversationId: string): Promise<boolean> {
  const record = await new Repository<ConversationSnooze>(db, 'conversationSnoozes').get(conversationId);
  if (!record) return false;
  return record.snoozedUntil > Ids.now();
}

/**
 * Batched alternative to calling isConversationSnoozed once per conversation — that pattern hit
 * Cloudflare's per-invocation subrequest limit for real once there were enough numbers/open
 * conversations (getNeedsResponseCounts loops listConversationsInternal across every accessible
 * number, so N conversations became N extra subrequests just for snooze checks). One list() call
 * instead, same "batch instead of N .get()s" fix as backfillCustomerServiceWindow's earlier one.
 */
export async function listSnoozedConversationIds(db: FirebaseDb): Promise<Set<string>> {
  const now = Ids.now();
  const records = await new Repository<ConversationSnooze>(db, 'conversationSnoozes').list();
  return new Set(records.filter((r) => r.snoozedUntil > now).map((r) => r.id));
}
