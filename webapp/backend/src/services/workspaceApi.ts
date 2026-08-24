/**
 * Direct port of apps-script/src/WorkspaceServices.gs's WorkspaceApi — a
 * single-round-trip aggregator for the conversation detail pane, same reasoning as the
 * source (opening one conversation firing many separate round trips is real,
 * measured latency, not a theoretical concern — see PROGRESS.md's Apps Script
 * history). Fields the caller isn't authorized to see come back as null/empty rather
 * than failing the whole call, same "hide, don't error" UX the source used.
 *
 * realtime is only minted when includeRealtime is true — the Apps Script build
 * shipped this unconditionally at first, found the extra per-call cost live, and
 * fixed it; this port starts from that fix instead of re-learning it.
 */
import type { CallLog, CustomerStage, Lead, Message, MessageMedia, Reminder, Stage, User } from '../domain/types';
import { Repository } from '../lib/repository';
import { AppDb } from '../lib/appDb';
import { normalizePhoneTail } from './exotelProvider';
import { Phase5Api, type ConversationDetail } from './phase5Api';
import { Phase7Api } from './phase7Api';
import { Phase8Api } from './phase8Api';
import { Phase9Api } from './phase9Api';
import { Phase22Api } from './phase22Api';
import { RealtimeListenApi, type RealtimeListenToken } from './realtimeListenApi';

export interface Workspace {
  conversation: ConversationDetail['conversation'];
  customer: ConversationDetail['customer'];
  number: ConversationDetail['number'];
  messages: (Message & { senderName: string | null; media: MessageMedia | null })[];
  assignedUserName: string | null;
  stage: CustomerStage | null;
  remarks: Awaited<ReturnType<Phase8Api['listRemarks']>> | null;
  reminders: Reminder[] | null;
  snoozeStatus: Awaited<ReturnType<Phase9Api['getSnoozeStatus']>> | null;
  assignableUsers: User[];
  /** Whether/when this customer was actually called, from either click-to-call surface — see Phase22Api.listConversationCallHistory. */
  calls: CallLog[] | null;
  /** The Leads-side record for this same phone number, if one exists (matched by phone tail, same
   * heuristic Phase4Api's own ingestion uses) — Leads and Customers are separate entities that
   * happen to share a phone number, not a formal relationship, so this is a best-effort lookup,
   * not an authoritative link. Lets the Inbox surface Lead-side context (location, custom fields
   * like Campaign Name) for a customer who originated as a Lead, without a real foreign key. */
  matchingLead: Pick<Lead, 'id' | 'name' | 'location' | 'customFields'> | null;
  realtime?: RealtimeListenToken | null;
}

export class WorkspaceApi {
  private phase5: Phase5Api;
  private phase7: Phase7Api;
  private phase8: Phase8Api;
  private phase9: Phase9Api;
  private phase22: Phase22Api;
  private realtime: RealtimeListenApi;
  private users: Repository<User>;
  private messageMedia: Repository<MessageMedia>;
  private leads: Repository<Lead>;

  constructor(db: AppDb, identityEmail: string, env: { FIREBASE_WEB_API_KEY: string }) {
    this.phase5 = new Phase5Api(db, identityEmail);
    this.phase7 = new Phase7Api(db, identityEmail);
    this.phase8 = new Phase8Api(db, identityEmail);
    this.phase9 = new Phase9Api(db, identityEmail);
    this.phase22 = new Phase22Api(db, identityEmail);
    this.realtime = new RealtimeListenApi(db, identityEmail, env);
    this.users = new Repository<User>(db, 'users');
    this.messageMedia = new Repository<MessageMedia>(db, 'messageMedia');
    this.leads = new Repository<Lead>(db, 'leads');
  }

  async getConversationWorkspace(conversationId: string, includeRealtime: boolean): Promise<Workspace> {
    const detail = await this.phase5.getConversationDetail(conversationId);
    const assignedUser = detail.conversation.assignedUserId ? await this.users.get(detail.conversation.assignedUserId) : null;

    const workspace: Workspace = {
      conversation: detail.conversation, customer: detail.customer, number: detail.number,
      messages: await this.enrichMessages(detail.messages),
      assignedUserName: assignedUser ? assignedUser.displayName : null,
      stage: null, remarks: null, reminders: null, snoozeStatus: null, assignableUsers: [], calls: null, matchingLead: null,
    };

    try { workspace.stage = detail.customer ? await this.phase8.getCustomerStage(detail.customer.id) : null; } catch (e) { console.error('workspace.stage failed', e); workspace.stage = null; }
    try { workspace.remarks = await this.phase8.listRemarks(conversationId); } catch (e) { console.error('workspace.remarks failed', e); workspace.remarks = null; }
    try { workspace.reminders = await this.phase9.listReminders(conversationId); } catch (e) { console.error('workspace.reminders failed', e); workspace.reminders = null; }
    try { workspace.snoozeStatus = await this.phase9.getSnoozeStatus(conversationId); } catch (e) { console.error('workspace.snoozeStatus failed', e); workspace.snoozeStatus = null; }
    try { workspace.assignableUsers = await this.phase7.listAssignableUsers(detail.conversation.numberId); } catch (e) { console.error('workspace.assignableUsers failed', e); workspace.assignableUsers = []; }
    try { workspace.calls = await this.phase22.listConversationCallHistory(conversationId); } catch (e) { console.error('workspace.calls failed', e); workspace.calls = null; }
    try {
      if (detail.customer?.phone) {
        const tail = normalizePhoneTail(detail.customer.phone);
        const lead = tail ? await this.leads.findOne((l) => normalizePhoneTail(l.phone) === tail) : null;
        workspace.matchingLead = lead ? { id: lead.id, name: lead.name, location: lead.location, customFields: lead.customFields } : null;
      }
    } catch (e) { console.error('workspace.matchingLead failed', e); workspace.matchingLead = null; }

    if (includeRealtime) {
      try { workspace.realtime = await this.realtime.getRealtimeListenToken(); } catch (e) { console.error('workspace.realtime failed', e); workspace.realtime = null; }
    }
    return workspace;
  }

  private async enrichMessages(messages: Message[]): Promise<(Message & { senderName: string | null; media: MessageMedia | null })[]> {
    const userCache = new Map<string, string | null>();
    const allMedia = await this.messageMedia.list();
    const result: (Message & { senderName: string | null; media: MessageMedia | null })[] = [];
    for (const message of messages) {
      let senderName: string | null = null;
      if (message.senderUserId) {
        if (!userCache.has(message.senderUserId)) {
          const user = await this.users.get(message.senderUserId);
          userCache.set(message.senderUserId, user ? user.displayName : null);
        }
        senderName = userCache.get(message.senderUserId) ?? null;
      }
      const media = allMedia.find((m) => m.messageId === message.id) ?? null;
      result.push({ ...message, senderName, media });
    }
    return result;
  }
}
