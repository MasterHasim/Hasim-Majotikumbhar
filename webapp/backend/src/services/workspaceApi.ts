/**
 * Reduced port of apps-script/src/WorkspaceServices.gs's WorkspaceApi — a
 * single-round-trip aggregator for the conversation detail pane, same reasoning as the
 * source (opening one conversation firing many separate round trips is real,
 * measured latency, not a theoretical concern — see PROGRESS.md's Apps Script
 * history). stage/remarks/reminders/snoozeStatus/assignableUsers are deferred to the
 * CRM-core migration phase (they don't exist yet on this backend) — this returns
 * conversation/customer/number/messages/assignedUserName/realtime only for now, and
 * will grow to match the source exactly once those phases land, same "includeRealtime
 * only when actually needed" discipline the Apps Script build settled on after
 * measuring the cost of minting a token on every action-triggered refresh.
 */
import type { Message } from '../domain/types';
import { Repository } from '../lib/repository';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { Phase5Api, type ConversationDetail } from './phase5Api';
import { RealtimeListenApi, type RealtimeListenToken } from './realtimeListenApi';
import type { User } from '../domain/types';

export interface Workspace {
  conversation: ConversationDetail['conversation'];
  customer: ConversationDetail['customer'];
  number: ConversationDetail['number'];
  messages: (Message & { senderName: string | null })[];
  assignedUserName: string | null;
  realtime?: RealtimeListenToken | null;
}

export class WorkspaceApi {
  private phase5: Phase5Api;
  private realtime: RealtimeListenApi;
  private users: Repository<User>;

  constructor(private db: FirebaseDb, identityEmail: string, env: { FIREBASE_WEB_API_KEY: string }) {
    this.phase5 = new Phase5Api(db, identityEmail);
    this.realtime = new RealtimeListenApi(db, identityEmail, env);
    this.users = new Repository<User>(db, 'users');
  }

  async getConversationWorkspace(conversationId: string, includeRealtime: boolean): Promise<Workspace> {
    const detail = await this.phase5.getConversationDetail(conversationId);
    const assignedUser = detail.conversation.assignedUserId ? await this.users.get(detail.conversation.assignedUserId) : null;

    const workspace: Workspace = {
      conversation: detail.conversation, customer: detail.customer, number: detail.number,
      messages: await this.enrichMessages(detail.messages),
      assignedUserName: assignedUser ? assignedUser.displayName : null,
    };

    if (includeRealtime) {
      try { workspace.realtime = await this.realtime.getRealtimeListenToken(); } catch { workspace.realtime = null; }
    }
    return workspace;
  }

  private async enrichMessages(messages: Message[]): Promise<(Message & { senderName: string | null })[]> {
    const userCache = new Map<string, string | null>();
    const result: (Message & { senderName: string | null })[] = [];
    for (const message of messages) {
      let senderName: string | null = null;
      if (message.senderUserId) {
        if (!userCache.has(message.senderUserId)) {
          const user = await this.users.get(message.senderUserId);
          userCache.set(message.senderUserId, user ? user.displayName : null);
        }
        senderName = userCache.get(message.senderUserId) ?? null;
      }
      result.push({ ...message, senderName });
    }
    return result;
  }
}
