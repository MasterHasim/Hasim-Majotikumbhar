/**
 * Direct port of apps-script/src/Phase14Services.gs's Phase14Api — dashboard &
 * analytics, gated on REPORTS_VIEW (SUPERVISOR/SITE_MANAGER/VIEWER/ADMIN; AGENT does
 * not have it). Metrics are scoped to the numbers the signed-in user actually has
 * access to via Phase5Api.listMyNumbers() — reused directly rather than
 * reimplemented, same exact scoping the inbox itself enforces.
 *
 * All metrics are computed from existing entities — no new collections. Template
 * usage is parsed from a message's "[Template: name]" display-text marker (set by
 * Phase6Api.sendTemplateReply) since Message has no templateId field of its own,
 * same constraint the source documents.
 */
import { Permissions } from '../domain/phase1';
import type { Conversation, CustomerStage, Message, Stage, User } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { Phase5Api } from './phase5Api';

interface ConversationSummary {
  total: number;
  open: number;
  unassigned: number;
  needsResponse: number;
  resolved: number;
}

function summarize(list: Conversation[]): ConversationSummary {
  return {
    total: list.length,
    open: list.filter((c) => c.status === 'OPEN').length,
    unassigned: list.filter((c) => c.status === 'OPEN' && !c.assignedUserId).length,
    needsResponse: list.filter((c) => c.status === 'OPEN' && c.needsResponse === true).length,
    resolved: list.filter((c) => c.status === 'CLOSED').length,
  };
}

export class Phase14Api {
  private access: AccessControl;
  private users: Repository<User>;
  private phase5: Phase5Api;
  private conversations: Repository<Conversation>;
  private messages: Repository<Message>;
  private customerStages: Repository<CustomerStage>;
  private stages: Repository<Stage>;

  constructor(db: FirebaseDb, identityEmail: string) {
    const repos = buildPhase1Repositories(db);
    const audit = new AuditLogService(db);
    this.access = new AccessControl(repos, audit, identityEmail);
    this.users = repos.users;
    this.phase5 = new Phase5Api(db, identityEmail);
    this.conversations = new Repository<Conversation>(db, 'conversations');
    this.messages = new Repository<Message>(db, 'messages');
    this.customerStages = new Repository<CustomerStage>(db, 'customerStages');
    this.stages = new Repository<Stage>(db, 'stages');
  }

  /** numberId is optional — narrows every metric to one number instead of aggregating across every number the caller can access. Still fully authorized: listMyNumbers() is filtered down to the requested id, so an inaccessible numberId just yields empty metrics rather than a bypass. */
  async getDashboardMetrics(numberId?: string) {
    const actor = await this.access.require(Permissions.REPORTS_VIEW);
    let numbers = await this.phase5.listMyNumbers();
    if (numberId) numbers = numbers.filter((n) => n.id === numberId);
    const numberIds = new Set(numbers.map((n) => n.id));

    const conversations = (await this.conversations.list()).filter((c) => numberIds.has(c.numberId));
    const messages = (await this.messages.list()).filter((m) => numberIds.has(m.numberId));
    const customerIds = new Set(conversations.map((c) => c.customerId));
    const assignedToMe = conversations.filter((c) => c.status === 'OPEN' && c.assignedUserId === actor.id).length;

    const byNumber = numbers.map((number) => ({
      numberId: number.id, displayName: number.displayName,
      ...summarize(conversations.filter((c) => c.numberId === number.id)),
    }));

    const byAgentMap = new Map<string, { open: number; needsResponse: number }>();
    for (const c of conversations) {
      if (!c.assignedUserId || c.status !== 'OPEN') continue;
      const entry = byAgentMap.get(c.assignedUserId) ?? { open: 0, needsResponse: 0 };
      entry.open++;
      if (c.needsResponse) entry.needsResponse++;
      byAgentMap.set(c.assignedUserId, entry);
    }
    const byAgent = [];
    for (const [userId, counts] of byAgentMap) {
      const user = await this.users.get(userId);
      byAgent.push({ userId, displayName: user ? user.displayName : userId, ...counts });
    }

    return {
      conversations: summarize(conversations),
      totalCustomers: customerIds.size,
      assignedToMe,
      byNumber,
      byAgent,
      responseTime: this.computeResponseTime(conversations, messages),
      stageDistribution: await this.computeStageDistribution(customerIds),
      templateUsage: this.computeTemplateUsage(messages),
      leadConversion: await this.computeLeadConversion(customerIds),
    };
  }

  /** Average minutes from a conversation's createdAt to its first OUTBOUND message, across conversations that have at least one reply. */
  private computeResponseTime(conversations: Conversation[], messages: Message[]) {
    const byConversation = new Map<string, string>();
    for (const m of messages) {
      if (m.direction !== 'OUTBOUND') continue;
      const existing = byConversation.get(m.conversationId);
      if (!existing || m.timestamp < existing) byConversation.set(m.conversationId, m.timestamp);
    }
    const samples: number[] = [];
    for (const c of conversations) {
      const firstReply = byConversation.get(c.id);
      if (!firstReply || !c.createdAt) continue;
      const minutes = (new Date(firstReply).getTime() - new Date(c.createdAt).getTime()) / 60000;
      if (minutes >= 0) samples.push(minutes);
    }
    const average = samples.length ? samples.reduce((sum, m) => sum + m, 0) / samples.length : null;
    return { averageFirstResponseMinutes: average === null ? null : Math.round(average * 10) / 10, sampleSize: samples.length };
  }

  private async computeStageDistribution(customerIds: Set<string>) {
    const stages = await this.stages.list();
    const byStageId = new Map<string, number>();
    for (const record of (await this.customerStages.list()).filter((r) => customerIds.has(r.customerId))) {
      byStageId.set(record.stageId, (byStageId.get(record.stageId) ?? 0) + 1);
    }
    return stages.map((stage) => ({ stageId: stage.id, name: stage.name, count: byStageId.get(stage.id) ?? 0 }));
  }

  private computeTemplateUsage(messages: Message[]) {
    const counts = new Map<string, number>();
    for (const m of messages) {
      if (m.messageType !== 'template') continue;
      const match = /^\[Template: (.+)\]$/.exec(m.messageText || '');
      const name = match ? match[1]! : '(unknown)';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }

  private async computeLeadConversion(customerIds: Set<string>) {
    const stages = await this.stages.list();
    const wonStage = stages.find((s) => s.key === 'won');
    const stageRecords = (await this.customerStages.list()).filter((r) => customerIds.has(r.customerId));
    const wonCount = wonStage ? stageRecords.filter((r) => r.stageId === wonStage.id).length : 0;
    const totalWithStage = stageRecords.length;
    return { totalCustomersWithStage: totalWithStage, wonCount, conversionRate: totalWithStage ? Math.round((wonCount / totalWithStage) * 1000) / 10 : null };
  }
}
