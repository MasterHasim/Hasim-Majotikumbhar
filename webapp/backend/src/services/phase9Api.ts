/**
 * Direct port of apps-script/src/Phase9Domain.gs + Phase9Services.gs's Phase9Api —
 * reminders and snooze. Snooze is a distinct concept from reminders — it just marks
 * a conversation to (auto-)disappear from Phase5Api's active list until
 * snoozedUntil, checked by comparison on every read, no scheduled job.
 */
import { ApiError } from '../types';
import { Ids, Permissions, Validation } from '../domain/phase1';
import type { Conversation, ConversationSnooze, Customer, Lead, Reminder, ReminderStatus, ReminderWithContext, User } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { AppDb } from '../lib/appDb';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

export class Phase9Api {
  readonly access: AccessControl;
  private phase1Repos: Phase1Repositories;
  private audit: AuditLogService;
  private reminders: Repository<Reminder>;
  private snoozes: Repository<ConversationSnooze>;
  private conversations: Repository<Conversation>;
  private customers: Repository<Customer>;
  private leads: Repository<Lead>;

  constructor(db: AppDb, identityEmail: string) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.reminders = new Repository<Reminder>(db, 'reminders');
    this.snoozes = new Repository<ConversationSnooze>(db, 'conversationSnoozes');
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.customers = new Repository<Customer>(db, 'customers');
    // Read-only here — listMyReminders enriches a lead-attached reminder with the lead's own
    // name/phone/location, but creating/updating one is Phase22Api's job (it owns canTouchLead).
    this.leads = new Repository<Lead>(db, 'leads');
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

  /** Conversation-attached reminders only — the shared PATCH /api/reminders/:id route checks
   * which of conversationId/leadId a reminder has before delegating here vs.
   * Phase22Api.updateLeadReminderStatus, so this never sees a lead-attached one in practice. */
  async updateReminderStatus(reminderId: string, status: string): Promise<Reminder> {
    const reminder = await this.reminders.get(reminderId);
    if (!reminder) throw new ApiError(404, 'NOT_FOUND', 'Reminder was not found.');
    if (!reminder.conversationId) throw new ApiError(400, 'VALIDATION_ERROR', 'This reminder is not attached to a conversation.');
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
   * where to jump to — one bulk read of conversations/customers/leads each, not a per-reminder
   * fetch (the previous version called this.conversations.get() inside a loop when numberId
   * was set; N+1 network round trips for what should be one read).
   * numberId is optional — narrows conversation-attached reminders to that number. A
   * lead-attached reminder has no number of its own (Leads are location-scoped, not
   * number-scoped — see workspaceApi.ts's matchingLead note), so numberId never filters those
   * out; hiding someone's own follow-up task because a specific WhatsApp number happens to be
   * open would be a worse surprise than showing one extra row.
   */
  async listMyReminders(numberId?: string): Promise<ReminderWithContext[]> {
    const actor = await this.access.currentUser();
    const pending = (await this.reminders.list()).filter((r) => r.ownerUserId === actor.id && r.status === 'PENDING');
    const conversationById = new Map((await this.conversations.list()).map((c) => [c.id, c]));
    const customerById = new Map((await this.customers.list()).map((c) => [c.id, c]));
    const leadById = new Map((await this.leads.list()).map((l) => [l.id, l]));

    const enriched: ReminderWithContext[] = [];
    for (const reminder of pending) {
      if (reminder.leadId) {
        const lead = leadById.get(reminder.leadId);
        if (!lead) continue; // orphaned reminder (lead since deleted) — skip rather than error
        enriched.push({ ...reminder, leadName: lead.name, leadPhone: lead.phone, leadLocation: lead.location });
        continue;
      }
      const conversation = reminder.conversationId ? conversationById.get(reminder.conversationId) : undefined;
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
export async function isConversationSnoozed(db: AppDb, conversationId: string): Promise<boolean> {
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
export async function listSnoozedConversationIds(db: AppDb): Promise<Set<string>> {
  const now = Ids.now();
  const records = await new Repository<ConversationSnooze>(db, 'conversationSnoozes').list();
  return new Set(records.filter((r) => r.snoozedUntil > now).map((r) => r.id));
}
