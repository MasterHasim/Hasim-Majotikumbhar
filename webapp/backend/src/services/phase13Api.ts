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
import type { CustomerStage, WhatsAppNumber, Message } from '../domain/types';
import { Repository } from '../lib/repository';
import { AppDb } from '../lib/appDb';
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
  private messages: Repository<Message>;
  private numbers: Repository<WhatsAppNumber>;
  private customerStages: Repository<CustomerStage>;

  constructor(db: AppDb, identityEmail: string) {
    this.phase5 = new Phase5Api(db, identityEmail);
    this.messages = new Repository<Message>(db, 'webapp_messages');
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
      // Same N+1 bug class as the query/number lookups below (re-fetching per conversation
      // instead of once per distinct id) — memoize instead of one Firebase call per conversation.
      const stageCache = new Map<string, CustomerStage | null>();
      const filtered: ConversationListItem[] = [];
      for (const c of results) {
        if (!stageCache.has(c.customerId)) stageCache.set(c.customerId, await this.customerStages.get(c.customerId));
        const stage = stageCache.get(c.customerId) ?? null;
        if (stage && stage.stageId === filters.stageId) filtered.push(c);
      }
      results = filtered;
    }
    if (filters.query) {
      // Real bug, confirmed live 2026-08-23: this used to re-fetch each conversation's Customer
      // record individually (one Firebase subrequest per conversation) even though
      // listConversationsAllStatuses already resolved customerName/customerPhone onto every
      // ConversationListItem — a search across 40+ conversations on one number blew through
      // Cloudflare's per-invocation subrequest limit on this alone. Matching against the
      // already-loaded fields instead needs zero extra subrequests.
      const query = filters.query.toLowerCase();
      const allMessages = await this.messages.list();
      const filtered: ConversationListItem[] = [];
      for (const c of results) {
        const customerMatches = c.customerName?.toLowerCase().includes(query) || c.customerPhone?.toLowerCase().includes(query);
        const messageMatches = allMessages.some((m) => m.conversationId === c.id && (m.messageText || '').toLowerCase().includes(query));
        if (customerMatches || messageMatches) filtered.push(c);
      }
      results = filtered;
    }

    // Same reasoning as above — cache each distinct number lookup instead of refetching it once
    // per conversation (searching within a single number previously re-fetched the SAME number
    // record once per matching conversation).
    const numberCache = new Map<string, WhatsAppNumber | null>();
    const output: SearchResultItem[] = [];
    for (const c of results) {
      if (!numberCache.has(c.numberId)) numberCache.set(c.numberId, await this.numbers.get(c.numberId));
      const number = numberCache.get(c.numberId) ?? null;
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
