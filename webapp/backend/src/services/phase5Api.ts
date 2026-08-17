/**
 * Direct port of apps-script/src/Phase5Services.gs's Phase5Api — view-only inbox
 * reads. Every non-admin role needs an explicit numberAccess grant before anything
 * else is checked (AccessControl.hasGrantedNumber); team membership's numberIds is a
 * separate, additional scope used only for the team-view path.
 *
 * Snooze filtering (Phase9's isConversationSnoozed_ in the source) is not wired in
 * yet — that lands with CRM core (see PROGRESS.md); listConversations() currently
 * treats nothing as snoozed, same as the Apps Script build's own state before its
 * Phase 9 existed.
 */
import { ApiError } from '../types';
import { Roles, Status, Validation } from '../domain/phase1';
import type { Conversation, Customer, Message, WhatsAppNumber } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import type { NumberAccess } from '../domain/types';

export interface ConversationListItem extends Conversation {
  customerName: string;
  customerPhone: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  customer: Customer | null;
  number: WhatsAppNumber | null;
  messages: Message[];
}

export class Phase5Api {
  readonly access: AccessControl;
  private numberAccess: Repository<NumberAccess>;
  numbers: Repository<WhatsAppNumber>;
  customers: Repository<Customer>;
  conversations: Repository<Conversation>;
  messages: Repository<Message>;

  constructor(db: FirebaseDb, identityEmail: string) {
    const repos = buildPhase1Repositories(db);
    const audit = new AuditLogService(db);
    this.access = new AccessControl(repos, audit, identityEmail);
    this.numberAccess = repos.numberAccess;
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'conversations');
    this.messages = new Repository<Message>(db, 'messages');
  }

  async listMyNumbers(): Promise<WhatsAppNumber[]> {
    const actor = await this.access.currentUser();
    if (await this.access.hasRole(actor, Roles.ADMIN)) return this.numbers.list();
    const grants = await this.numberAccess.list();
    const grantedNumberIds = new Set(grants.filter((g) => g.userId === actor.id && g.status === Status.ACTIVE && g.granted === true).map((g) => g.numberId));
    return (await this.numbers.list()).filter((n) => grantedNumberIds.has(n.id));
  }

  /** The active inbox: OPEN conversations only (not-currently-snoozed, once snooze is ported). */
  async listConversations(numberId: string): Promise<ConversationListItem[]> {
    return this.listConversationsInternal(numberId, true);
  }

  /** Every conversation regardless of status, same authorization — used once search (a later phase) needs it. */
  async listConversationsAllStatuses(numberId: string): Promise<ConversationListItem[]> {
    return this.listConversationsInternal(numberId, false);
  }

  private async listConversationsInternal(numberId: string, activeOnly: boolean): Promise<ConversationListItem[]> {
    Validation.requiredString(numberId, 'numberId');
    await this.access.requireGrantedNumberOrAdmin(numberId);
    const teamId = await this.access.resolveTeamIdForNumber(numberId);
    let results = (await this.conversations.list()).filter((c) => c.numberId === numberId);
    if (activeOnly) {
      results = results.filter((c) => c.status === 'OPEN');
    }
    const visible: Conversation[] = [];
    for (const conversation of results) {
      try {
        await this.access.requireConversationOperation('view', { numberId, teamId, assignedUserId: conversation.assignedUserId });
        visible.push(conversation);
      } catch {
        // not visible to this actor — excluded, same as the source's try/catch filter
      }
    }
    const customers = await this.customers.list();
    return visible.map((conversation) => {
      const customer = customers.find((c) => c.id === conversation.customerId);
      return { ...conversation, customerName: customer ? customer.name || customer.phone : '', customerPhone: customer ? customer.phone : '' };
    });
  }

  async getConversationDetail(conversationId: string): Promise<ConversationDetail> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    await this.access.requireConversationOperation('view', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });

    const customer = await this.customers.get(conversation.customerId);
    const number = await this.numbers.get(conversation.numberId);
    const messages = (await this.messages.list())
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    return { conversation, customer, number, messages };
  }
}
