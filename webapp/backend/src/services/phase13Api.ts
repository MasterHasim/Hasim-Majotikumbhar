/**
 * Direct port of apps-script/src/Phase13Services.gs's Phase13Api — search & filters
 * across conversations, plus a lightweight in-UI "notifications" surface.
 *
 * "Notifications" is scoped deliberately narrow, same as the source: needs-response
 * badge counts per number, not push/email/SMS — building a real push channel is new
 * infrastructure this migration's roadmap doesn't ask for.
 *
 * searchConversations deliberately does not re-implement AccessControl's authorization
 * rules — it composes Phase5Api.listMyNumbers()/listConversationsAllStatuses(), which
 * already enforce the full role/team/assignment scoping, then filters/searches within
 * that already-authorized set (defaulting to OPEN-only unless a specific status is
 * requested, so a resolved conversation is still findable on request).
 */
import type { Customer, CustomerStage, WhatsAppNumber, Message } from '../domain/types';
import { Repository } from '../lib/repository';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { Phase5Api, type ConversationListItem } from './phase5Api';

export interface SearchFilters {
  numberId?: string;
  query?: string;
  assignedUserId?: string;
  customerId?: string;
  stageId?: string;
  status?: string;
  needsResponse?: boolean;
  unassigned?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchResultItem extends ConversationListItem {
  numberDisplayName: string;
}

export class Phase13Api {
  private phase5: Phase5Api;
  private customers: Repository<Customer>;
  private messages: Repository<Message>;
  private numbers: Repository<WhatsAppNumber>;
  private customerStages: Repository<CustomerStage>;

  constructor(db: FirebaseDb, identityEmail: string) {
    this.phase5 = new Phase5Api(db, identityEmail);
    this.customers = new Repository<Customer>(db, 'customers');
    this.messages = new Repository<Message>(db, 'messages');
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.customerStages = new Repository<CustomerStage>(db, 'customerStages');
  }

  /** numberId omitted means "every number the signed-in user can access." status: 'ANY' returns every status instead of defaulting to OPEN-only. */
  async searchConversations(filters: SearchFilters = {}): Promise<SearchResultItem[]> {
    const numberIds = filters.numberId ? [filters.numberId] : (await this.phase5.listMyNumbers()).map((n) => n.id);
    let results: ConversationListItem[] = [];
    for (const numberId of numberIds) {
      results.push(...(await this.phase5.listConversationsAllStatuses(numberId)));
    }

    if (filters.assignedUserId) results = results.filter((c) => c.assignedUserId === filters.assignedUserId);
    if (filters.customerId) results = results.filter((c) => c.customerId === filters.customerId);
    // status: 'ANY' explicitly opts out of the OPEN-only default — used for a
    // customer's full conversation history, where resolved/closed ones are exactly
    // the point, not something to hide.
    if (filters.status && filters.status !== 'ANY') results = results.filter((c) => c.status === filters.status);
    else if (!filters.status) results = results.filter((c) => c.status === 'OPEN');
    if (filters.needsResponse) results = results.filter((c) => c.needsResponse === true);
    if (filters.unassigned) results = results.filter((c) => !c.assignedUserId);
    if (filters.dateFrom) results = results.filter((c) => (c.lastMessageAt || '') >= filters.dateFrom!);
    if (filters.dateTo) results = results.filter((c) => (c.lastMessageAt || '') <= filters.dateTo!);
    if (filters.stageId) {
      const filtered: ConversationListItem[] = [];
      for (const c of results) {
        const stage = await this.customerStages.get(c.customerId);
        if (stage && stage.stageId === filters.stageId) filtered.push(c);
      }
      results = filtered;
    }
    if (filters.query) {
      const query = filters.query.toLowerCase();
      const allMessages = await this.messages.list();
      const filtered: ConversationListItem[] = [];
      for (const c of results) {
        const customer = await this.customers.get(c.customerId);
        const customerMatches = customer && (customer.name?.toLowerCase().includes(query) || customer.phone?.toLowerCase().includes(query));
        const messageMatches = allMessages.some((m) => m.conversationId === c.id && (m.messageText || '').toLowerCase().includes(query));
        if (customerMatches || messageMatches) filtered.push(c);
      }
      results = filtered;
    }

    const output: SearchResultItem[] = [];
    for (const c of results) {
      const number = await this.numbers.get(c.numberId);
      output.push({ ...c, numberDisplayName: number ? number.displayName : '' });
    }
    return output;
  }

  /** { numberId: count } of currently-open, needs-response conversations, across every number the signed-in user can access. */
  async getNeedsResponseCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const number of await this.phase5.listMyNumbers()) {
      const conversations = await this.phase5.listConversations(number.id);
      counts[number.id] = conversations.filter((c) => c.needsResponse === true).length;
    }
    return counts;
  }
}
