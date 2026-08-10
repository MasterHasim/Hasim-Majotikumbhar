/**
 * Phase 14 Dashboard & Analytics. Gated on `REPORTS_VIEW` — a permission Phase 1
 * already defined (SUPERVISOR, SITE_MANAGER, VIEWER, and ADMIN all have it; AGENT does
 * not) but nothing used until Phase 14.
 *
 * Scoping (2026-08-10, per explicit user decision — see memory/DECISIONS.md):
 * metrics are scoped to the numbers the signed-in user actually has access to —
 * ADMIN sees everything; SUPERVISOR/SITE_MANAGER/VIEWER see only their
 * admin-granted numbers, same exact scoping `Phase5Api.listMyNumbers()` already
 * enforces for the inbox. Reused directly rather than re-implemented here.
 *
 * All metrics are computed from existing entities — no new columns, no new tabs.
 *
 * "Resolved" now reflects real data: `Phase6Api.resolveConversation` (added
 * 2026-08-10, per explicit user decision) is the first writer of
 * `Conversations.status: 'CLOSED'`.
 *
 * Template usage is parsed from `Messages.messageText`'s `"[Template: name]"` marker
 * (set by Phase6Api.sendTemplateReply) since `Messages` has no `templateId` column and
 * SheetRepository has no safe migration path to add one to a live-data entity (the
 * same constraint documented since Phase 8).
 */
class Phase14Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.phase5_ = new Phase5Api();
    this.conversations_ = new ConversationRepository();
    this.messages_ = new MessageRepository();
    this.customerStages_ = new CustomerStageRepository();
    this.stages_ = new StageRepository();
  }

  getDashboardMetrics() {
    var actor = this.access_.require(Phase1Permissions.REPORTS_VIEW);
    var numbers = this.phase5_.listMyNumbers(); // ADMIN: every number; else: only admin-granted numbers
    var numberIds = {};
    numbers.forEach(function (n) { numberIds[n.id] = true; });

    var conversations = this.conversations_.list().filter(function (c) { return numberIds[c.numberId]; });
    var messages = this.messages_.list().filter(function (m) { return numberIds[m.numberId]; });
    var customerIds = {};
    conversations.forEach(function (c) { customerIds[c.customerId] = true; });
    var assignedToMe = conversations.filter(function (c) { return c.status === 'OPEN' && c.assignedUserId === actor.id; }).length;

    var summarize = function (list) {
      return {
        total: list.length,
        open: list.filter(function (c) { return c.status === 'OPEN'; }).length,
        unassigned: list.filter(function (c) { return c.status === 'OPEN' && !c.assignedUserId; }).length,
        needsResponse: list.filter(function (c) { return c.status === 'OPEN' && c.needsResponse === true; }).length,
        resolved: list.filter(function (c) { return c.status === 'CLOSED'; }).length
      };
    };

    var byNumber = numbers.map(function (number) {
      var forNumber = conversations.filter(function (c) { return c.numberId === number.id; });
      return Object.assign({ numberId: number.id, displayName: number.displayName }, summarize(forNumber));
    });

    var self = this;
    var byAgentMap = {};
    conversations.forEach(function (c) {
      if (!c.assignedUserId || c.status !== 'OPEN') return;
      if (!byAgentMap[c.assignedUserId]) byAgentMap[c.assignedUserId] = { open: 0, needsResponse: 0 };
      byAgentMap[c.assignedUserId].open++;
      if (c.needsResponse) byAgentMap[c.assignedUserId].needsResponse++;
    });
    var byAgent = Object.keys(byAgentMap).map(function (userId) {
      var user = self.repository_.get('users', userId);
      return { userId: userId, displayName: user ? user.displayName : userId, open: byAgentMap[userId].open, needsResponse: byAgentMap[userId].needsResponse };
    });

    return {
      conversations: summarize(conversations),
      totalCustomers: Object.keys(customerIds).length,
      assignedToMe: assignedToMe,
      byNumber: byNumber,
      byAgent: byAgent,
      responseTime: this.computeResponseTime_(conversations, messages),
      stageDistribution: this.computeStageDistribution_(customerIds),
      templateUsage: this.computeTemplateUsage_(messages),
      leadConversion: this.computeLeadConversion_(customerIds)
    };
  }

  /** Average minutes from a conversation's createdAt to its first OUTBOUND message, across conversations that have at least one reply. */
  computeResponseTime_(conversations, messages) {
    var byConversation = {};
    messages.forEach(function (m) {
      if (m.direction !== 'OUTBOUND') return;
      if (!byConversation[m.conversationId] || m.timestamp < byConversation[m.conversationId]) byConversation[m.conversationId] = m.timestamp;
    });
    var samples = [];
    conversations.forEach(function (c) {
      var firstReply = byConversation[c.id];
      if (!firstReply || !c.createdAt) return;
      var minutes = (new Date(firstReply).getTime() - new Date(c.createdAt).getTime()) / 60000;
      if (minutes >= 0) samples.push(minutes);
    });
    var average = samples.length ? samples.reduce(function (sum, m) { return sum + m; }, 0) / samples.length : null;
    return { averageFirstResponseMinutes: average === null ? null : Math.round(average * 10) / 10, sampleSize: samples.length };
  }

  computeStageDistribution_(customerIds) {
    var stages = this.stages_.list();
    var byStageId = {};
    this.customerStages_.list().filter(function (record) { return customerIds[record.customerId]; })
      .forEach(function (record) { byStageId[record.stageId] = (byStageId[record.stageId] || 0) + 1; });
    return stages.map(function (stage) { return { stageId: stage.id, name: stage.name, count: byStageId[stage.id] || 0 }; });
  }

  computeTemplateUsage_(messages) {
    var counts = {};
    messages.forEach(function (m) {
      if (m.messageType !== 'template') return;
      var match = /^\[Template: (.+)\]$/.exec(m.messageText || '');
      var name = match ? match[1] : '(unknown)';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.keys(counts).map(function (name) { return { name: name, count: counts[name] }; }).sort(function (a, b) { return b.count - a.count; });
  }

  computeLeadConversion_(customerIds) {
    var stages = this.stages_.list();
    var wonStage = stages.filter(function (s) { return s.key === 'won'; })[0];
    var stageRecords = this.customerStages_.list().filter(function (r) { return customerIds[r.customerId]; });
    var wonCount = wonStage ? stageRecords.filter(function (r) { return r.stageId === wonStage.id; }).length : 0;
    var totalWithStage = stageRecords.length;
    return { totalCustomersWithStage: totalWithStage, wonCount: wonCount, conversionRate: totalWithStage ? Math.round((wonCount / totalWithStage) * 1000) / 10 : null };
  }
}
