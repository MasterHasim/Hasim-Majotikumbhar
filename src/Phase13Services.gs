/**
 * Phase 13: search & filters across conversations, plus a lightweight in-UI
 * "notifications" surface.
 *
 * "Notifications" is scoped deliberately narrow here: needs-response badge counts per
 * number (getNeedsResponseCounts), not push/email/SMS notifications — Apps Script has
 * no clean push channel, and building one (time triggers, email quota, subscription
 * state) is real new infrastructure the roadmap doesn't ask for explicitly. See
 * memory/DECISIONS.md.
 *
 * searchConversations deliberately does not re-implement AccessControl's authorization
 * rules — it composes Phase5Api.listMyNumbers()/listConversations(), which already
 * enforce the full role/team/assignment scoping, then filters/searches within that
 * already-authorized set. This keeps exactly one place (Phase 1's AccessControl, via
 * Phase 5) deciding what a user is allowed to see.
 */
class Phase13Api {
  constructor() {
    this.phase5_ = new Phase5Api();
    this.customers_ = new CustomerRepository();
    this.messages_ = new MessageRepository();
    this.numbers_ = new NumberRepository();
    this.customerStages_ = new CustomerStageRepository();
  }

  /**
   * filters: { numberId, query, assignedUserId, stageId, status, needsResponse,
   * unassigned, dateFrom, dateTo }. numberId is optional — omitted means "every number
   * the signed-in user can access" (via Phase5Api.listMyNumbers()).
   */
  searchConversations(filters) {
    filters = filters || {};
    var self = this;
    var numberIds = filters.numberId ? [filters.numberId] : this.phase5_.listMyNumbers().map(function (n) { return n.id; });
    var results = [];
    numberIds.forEach(function (numberId) {
      self.phase5_.listConversations(numberId).forEach(function (conversation) { results.push(conversation); });
    });

    if (filters.assignedUserId) results = results.filter(function (c) { return c.assignedUserId === filters.assignedUserId; });
    if (filters.status) results = results.filter(function (c) { return c.status === filters.status; });
    if (filters.needsResponse) results = results.filter(function (c) { return c.needsResponse === true; });
    if (filters.unassigned) results = results.filter(function (c) { return !c.assignedUserId; });
    if (filters.dateFrom) results = results.filter(function (c) { return (c.lastMessageAt || '') >= filters.dateFrom; });
    if (filters.dateTo) results = results.filter(function (c) { return (c.lastMessageAt || '') <= filters.dateTo; });
    if (filters.stageId) {
      results = results.filter(function (c) {
        var stage = self.customerStages_.get(c.customerId);
        return stage && stage.stageId === filters.stageId;
      });
    }
    if (filters.query) {
      var query = String(filters.query).toLowerCase();
      var allMessages = this.messages_.list();
      results = results.filter(function (c) {
        var customer = self.customers_.get(c.customerId);
        if (customer && (String(customer.name || '').toLowerCase().indexOf(query) !== -1 || String(customer.phone || '').toLowerCase().indexOf(query) !== -1)) return true;
        return allMessages.some(function (m) { return m.conversationId === c.id && String(m.messageText || '').toLowerCase().indexOf(query) !== -1; });
      });
    }

    return results.map(function (c) {
      var customer = self.customers_.get(c.customerId);
      var number = self.numbers_.get(c.numberId);
      return Object.assign({}, c, {
        customerName: customer ? (customer.name || customer.phone) : '',
        customerPhone: customer ? customer.phone : '',
        numberDisplayName: number ? number.displayName : ''
      });
    });
  }

  /** { numberId: count } of currently-open, needs-response conversations, across every number the signed-in user can access. */
  getNeedsResponseCounts() {
    var self = this;
    var counts = {};
    this.phase5_.listMyNumbers().forEach(function (number) {
      counts[number.id] = self.phase5_.listConversations(number.id).filter(function (c) { return c.needsResponse === true; }).length;
    });
    return counts;
  }
}
