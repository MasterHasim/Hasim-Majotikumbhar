/**
 * Phase 14 Dashboard & Analytics. Gated on `REPORTS_VIEW` — a permission Phase 1
 * already defined (SUPERVISOR, SITE_MANAGER, VIEWER, and ADMIN all have it; AGENT does
 * not) but nothing used until now. It's a flat, non-team-scoped permission in Phase 1's
 * existing model — a SUPERVISOR/SITE_MANAGER with `REPORTS_VIEW` sees org-wide metrics,
 * not just their own team's, matching the permission as already defined rather than
 * inventing a team-scoped variant unprompted (see memory/DECISIONS.md; rule #12 says
 * not to redesign previously approved authorization without approval).
 *
 * All metrics are computed from existing entities — no new columns, no new tabs.
 *
 * "Resolved" conversations always report as 0: no phase has ever added a way to close
 * a conversation (`Conversations.status` is only ever written as `'OPEN'`, by Phase 4).
 * Rather than invent a close/resolve workflow under an analytics phase, this reports
 * the gap honestly and flags it in PROGRESS.md for the user to decide on.
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
    this.numbers_ = new NumberRepository();
    this.conversations_ = new ConversationRepository();
    this.messages_ = new MessageRepository();
    this.customerStages_ = new CustomerStageRepository();
    this.stages_ = new StageRepository();
  }

  getDashboardMetrics() {
    this.access_.require(Phase1Permissions.REPORTS_VIEW);
    var numbers = this.numbers_.list();
    var conversations = this.conversations_.list();
    var messages = this.messages_.list();
    var users = this.repository_.list('users');

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

    var byAgent = users.filter(function (u) { return u.status === Phase1Constants.ACTIVE; }).map(function (user) {
      var assigned = conversations.filter(function (c) { return c.assignedUserId === user.id; });
      return { userId: user.id, displayName: user.displayName, open: assigned.filter(function (c) { return c.status === 'OPEN'; }).length, needsResponse: assigned.filter(function (c) { return c.status === 'OPEN' && c.needsResponse === true; }).length };
    }).filter(function (row) { return row.open > 0 || row.needsResponse > 0; });

    return {
      conversations: summarize(conversations),
      byNumber: byNumber,
      byAgent: byAgent,
      responseTime: this.computeResponseTime_(conversations, messages),
      stageDistribution: this.computeStageDistribution_(),
      templateUsage: this.computeTemplateUsage_(messages),
      leadConversion: this.computeLeadConversion_()
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

  computeStageDistribution_() {
    var stages = this.stages_.list();
    var byStageId = {};
    this.customerStages_.list().forEach(function (record) { byStageId[record.stageId] = (byStageId[record.stageId] || 0) + 1; });
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

  computeLeadConversion_() {
    var stages = this.stages_.list();
    var wonStage = stages.filter(function (s) { return s.key === 'won'; })[0];
    var stageRecords = this.customerStages_.list();
    var wonCount = wonStage ? stageRecords.filter(function (r) { return r.stageId === wonStage.id; }).length : 0;
    var totalWithStage = stageRecords.length;
    return { totalCustomersWithStage: totalWithStage, wonCount: wonCount, conversionRate: totalWithStage ? Math.round((wonCount / totalWithStage) * 1000) / 10 : null };
  }
}
