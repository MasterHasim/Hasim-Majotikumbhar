/** Typed wrappers around apiFetch for the endpoints the Inbox UI needs — one-to-one with webapp/backend/src/routes/{phase1,messaging,crm,phase22}.ts. */
import { apiFetch } from './api';
import type {
  AdAccount, AdInsights, AssignableUser, AssignmentEligibility, AssignmentEligibilityStatus, AuditEntry, AuditEntryWithActor, Availability,
  AutoDialerSettings, AvailabilityStatus, CallLog,
  CallLogWithContext, Conversation, ConversationListItem, Customer, CustomerStage, CustomFieldDefinition, CustomFieldEntityType, CustomFieldType,
  DashboardMetrics, Lead, LeadFunnel, LeadRemark, LeadStageAssignment,
  LocationAssignmentConfig, LocationAssignmentUser, NumberAccess, NumberAssignmentConfig, NumberAssignmentUser, Product, PublicQuotationView,
  QuickReply, Quotation, Remark, Reminder,
  ReminderWithContext, Role, SearchFilters, SearchResultItem, SnoozeStatus, Stage, Team, TeamMember, Template, UploadLeadsResult, User,
  WhatsAppNumber, WhoAmI, Workspace,
} from '../types';

export const backendApi = {
  whoAmI: () => apiFetch<WhoAmI>('/api/whoami'),

  listMyNumbers: () => apiFetch<WhatsAppNumber[]>('/api/my-numbers'),

  listNumbers: () => apiFetch<WhatsAppNumber[]>('/api/numbers'),

  createNumber: (input: { displayName: string; phoneNumber: string; provider: string }) =>
    apiFetch<WhatsAppNumber>('/api/numbers', { method: 'POST', body: JSON.stringify(input) }),

  updateNumber: (id: string, patch: Record<string, unknown>) =>
    apiFetch<WhatsAppNumber>(`/api/numbers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listConversations: (numberId: string) => apiFetch<ConversationListItem[]>(`/api/conversations?numberId=${encodeURIComponent(numberId)}`),

  searchConversations: (filters: SearchFilters) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return apiFetch<SearchResultItem[]>(`/api/search-conversations?${params.toString()}`);
  },

  getNeedsResponseCounts: () => apiFetch<Record<string, number>>('/api/needs-response-counts'),

  getWorkspace: (conversationId: string, includeRealtime = false) =>
    apiFetch<Workspace>(`/api/workspace/${encodeURIComponent(conversationId)}${includeRealtime ? '?includeRealtime=true' : ''}`),

  startNewConversation: (numberId: string, phone: string, name?: string) =>
    apiFetch<{ customerId: string; conversationId: string; numberId: string }>('/api/conversations/start', { method: 'POST', body: JSON.stringify({ numberId, phone, name }) }),

  sendReply: (conversationId: string, text: string) =>
    apiFetch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),

  resolveConversation: (conversationId: string) =>
    apiFetch<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/resolve`, { method: 'POST' }),

  updateConversationProducts: (conversationId: string, productIds: string[]) =>
    apiFetch<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/products`, { method: 'PATCH', body: JSON.stringify({ productIds }) }),

  sendTemplateReply: (conversationId: string, templateId: string, variables: Record<string, unknown>) =>
    apiFetch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/send-template`, { method: 'POST', body: JSON.stringify({ templateId, variables }) }),

  sendMediaReply: (conversationId: string, mediaType: string, mediaUrl: string, caption: string) =>
    apiFetch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/send-media`, { method: 'POST', body: JSON.stringify({ mediaType, mediaUrl, caption }) }),

  uploadConversationMedia: (conversationId: string, base64Data: string, filename: string, mimeType: string) =>
    apiFetch<{ url: string; key: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/upload-media`, { method: 'POST', body: JSON.stringify({ base64Data, filename, mimeType }) }),

  reassignConversation: (conversationId: string, newUserId: string) =>
    apiFetch<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/reassign`, { method: 'POST', body: JSON.stringify({ newUserId }) }),

  listStages: () => apiFetch<Stage[]>('/api/lead-stages'),

  createStage: (input: { key: string; name: string; sequenceOrder?: number }) =>
    apiFetch<Stage>('/api/lead-stages', { method: 'POST', body: JSON.stringify(input) }),

  updateStage: (id: string, patch: Record<string, unknown>) =>
    apiFetch<Stage>(`/api/lead-stages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  seedDefaultLeadStages: () => apiFetch<Stage[]>('/api/lead-stages/seed-defaults', { method: 'POST' }),

  setCustomerStage: (customerId: string, stageId: string) =>
    apiFetch<CustomerStage>(`/api/customers/${encodeURIComponent(customerId)}/stage`, { method: 'POST', body: JSON.stringify({ stageId }) }),

  addRemark: (conversationId: string, text: string) =>
    apiFetch<Remark>(`/api/conversations/${encodeURIComponent(conversationId)}/remarks`, { method: 'POST', body: JSON.stringify({ text }) }),

  addReminder: (conversationId: string, text: string, dueAt: string) =>
    apiFetch<Reminder>(`/api/conversations/${encodeURIComponent(conversationId)}/reminders`, { method: 'POST', body: JSON.stringify({ text, dueAt }) }),

  updateReminderStatus: (reminderId: string, status: string) =>
    apiFetch<Reminder>(`/api/reminders/${encodeURIComponent(reminderId)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  snoozeConversation: (conversationId: string, until: string) =>
    apiFetch<SnoozeStatus>(`/api/conversations/${encodeURIComponent(conversationId)}/snooze`, { method: 'POST', body: JSON.stringify({ until }) }),

  unsnoozeConversation: (conversationId: string) =>
    apiFetch<{ conversationId: string; snoozed: false }>(`/api/conversations/${encodeURIComponent(conversationId)}/unsnooze`, { method: 'POST' }),

  listMyReminders: (numberId?: string) =>
    apiFetch<ReminderWithContext[]>(`/api/my-reminders${numberId ? `?numberId=${encodeURIComponent(numberId)}` : ''}`),

  addLeadReminder: (leadId: string, text: string, dueAt: string) =>
    apiFetch<Reminder>(`/api/leads/${encodeURIComponent(leadId)}/reminders`, { method: 'POST', body: JSON.stringify({ text, dueAt }) }),

  listLeadReminders: (leadId: string) =>
    apiFetch<Reminder[]>(`/api/leads/${encodeURIComponent(leadId)}/reminders`),

  getAutoDialerSettings: () => apiFetch<AutoDialerSettings>('/api/auto-dialer-settings'),

  updateAutoDialerSettings: (patch: Partial<AutoDialerSettings>) =>
    apiFetch<AutoDialerSettings>('/api/auto-dialer-settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  listCustomers: (numberId?: string) =>
    apiFetch<Customer[]>(`/api/customers${numberId ? `?numberId=${encodeURIComponent(numberId)}` : ''}`),

  updateCustomer: (customerId: string, patch: Record<string, unknown>) =>
    apiFetch<Customer>(`/api/customers/${encodeURIComponent(customerId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listUsers: () => apiFetch<User[]>('/api/users'),

  createUser: (input: { email: string; displayName: string; phone?: string; roleIds: string[] }) =>
    apiFetch<User>('/api/users', { method: 'POST', body: JSON.stringify(input) }),

  updateUser: (id: string, patch: Record<string, unknown>) =>
    apiFetch<User>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  setUserPhone: (userId: string, phone: string) =>
    apiFetch<User>(`/api/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ phone }) }),

  sendWelcomeEmail: (userId: string) =>
    apiFetch<{ sent: true }>(`/api/users/${encodeURIComponent(userId)}/welcome-email`, { method: 'POST' }),

  listRoles: () => apiFetch<Role[]>('/api/roles'),

  listTeams: () => apiFetch<Team[]>('/api/teams'),

  createTeam: (input: { ownerUserId: string; name: string }) =>
    apiFetch<Team>('/api/teams', { method: 'POST', body: JSON.stringify(input) }),

  listTeamMembers: (teamId: string) => apiFetch<TeamMember[]>(`/api/teams/${encodeURIComponent(teamId)}/members`),

  addTeamMember: (input: { teamId: string; userId: string; numberIds?: string[] }) =>
    apiFetch<TeamMember>('/api/team-members', { method: 'POST', body: JSON.stringify(input) }),

  updateTeamMember: (id: string, patch: Record<string, unknown>) =>
    apiFetch<TeamMember>(`/api/team-members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listNumberAccess: () => apiFetch<NumberAccess[]>('/api/number-access'),

  grantNumberAccess: (userId: string, numberId: string) =>
    apiFetch<NumberAccess>('/api/number-access', { method: 'POST', body: JSON.stringify({ userId, numberId }) }),

  revokeNumberAccess: (id: string) => apiFetch<NumberAccess>(`/api/number-access/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),

  reactivateNumberAccess: (id: string) => apiFetch<NumberAccess>(`/api/number-access/${encodeURIComponent(id)}/reactivate`, { method: 'POST' }),

  getNumberAssignmentConfig: (numberId: string) => apiFetch<NumberAssignmentConfig | null>(`/api/numbers/${encodeURIComponent(numberId)}/assignment-config`),

  setNumberAssignmentConfig: (numberId: string, patch: Record<string, unknown>) =>
    apiFetch<NumberAssignmentConfig>(`/api/numbers/${encodeURIComponent(numberId)}/assignment-config`, { method: 'POST', body: JSON.stringify(patch) }),

  listNumberAssignmentParticipants: (numberId: string) => apiFetch<NumberAssignmentUser[]>(`/api/numbers/${encodeURIComponent(numberId)}/assignment-participants`),

  addNumberAssignmentParticipant: (numberId: string, userId: string, sequenceOrder?: number) =>
    apiFetch<NumberAssignmentUser>(`/api/numbers/${encodeURIComponent(numberId)}/assignment-participants`, { method: 'POST', body: JSON.stringify({ userId, sequenceOrder }) }),

  updateNumberAssignmentParticipant: (id: string, patch: Record<string, unknown>) =>
    apiFetch<NumberAssignmentUser>(`/api/assignment-participants/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listAuditLog: () => apiFetch<AuditEntry[]>('/api/audit-log'),

  // --- Phase 22: location leads + Exotel click-to-call ---

  listLeadLocations: () => apiFetch<readonly string[]>('/api/lead-locations'),

  uploadLeads: (rows: { name: string; phone: string; location: string }[]) =>
    apiFetch<UploadLeadsResult>('/api/leads/upload', { method: 'POST', body: JSON.stringify({ rows }) }),

  createLead: (lead: { name: string; phone: string; location: string }) =>
    apiFetch<Lead>('/api/leads', { method: 'POST', body: JSON.stringify(lead) }),

  listLeads: (filters: { location?: string; status?: string; assignedUserId?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.location) params.set('location', filters.location);
    if (filters.status) params.set('status', filters.status);
    if (filters.assignedUserId) params.set('assignedUserId', filters.assignedUserId);
    const qs = params.toString();
    return apiFetch<Lead[]>(`/api/leads${qs ? `?${qs}` : ''}`);
  },

  reassignLead: (leadId: string, userId: string) =>
    apiFetch<Lead>(`/api/leads/${encodeURIComponent(leadId)}/reassign`, { method: 'POST', body: JSON.stringify({ userId }) }),

  getLeadFunnel: (location?: string) => apiFetch<LeadFunnel>(`/api/leads/funnel${location ? `?location=${encodeURIComponent(location)}` : ''}`),

  // --- Ad Performance (Meta Ads) ---

  listAdAccounts: () => apiFetch<AdAccount[]>('/api/ad-accounts'),

  createAdAccount: (input: { name: string; externalAccountId: string }) =>
    apiFetch<AdAccount>('/api/ad-accounts', { method: 'POST', body: JSON.stringify(input) }),

  updateAdAccount: (id: string, patch: Record<string, unknown>) =>
    apiFetch<AdAccount>(`/api/ad-accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getAdInsights: (accountId: string, from: string, to: string) =>
    apiFetch<AdInsights>(`/api/ad-accounts/${encodeURIComponent(accountId)}/insights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  listActiveCampaigns: () => apiFetch<{ name: string }[]>('/api/ad-campaigns/active'),

  getLocationAssignmentConfig: (location: string) => apiFetch<LocationAssignmentConfig | null>(`/api/locations/${encodeURIComponent(location)}/assignment-config`),

  setLocationAssignmentConfig: (location: string, patch: Record<string, unknown>) =>
    apiFetch<LocationAssignmentConfig>(`/api/locations/${encodeURIComponent(location)}/assignment-config`, { method: 'POST', body: JSON.stringify(patch) }),

  listLocationAssignmentParticipants: (location: string) => apiFetch<LocationAssignmentUser[]>(`/api/locations/${encodeURIComponent(location)}/assignment-participants`),

  addLocationAssignmentParticipant: (location: string, userId: string, sequenceOrder?: number) =>
    apiFetch<LocationAssignmentUser>(`/api/locations/${encodeURIComponent(location)}/assignment-participants`, { method: 'POST', body: JSON.stringify({ userId, sequenceOrder }) }),

  updateLocationAssignmentParticipant: (id: string, patch: Record<string, unknown>) =>
    apiFetch<LocationAssignmentUser>(`/api/location-assignment-participants/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  initiateLeadCall: (leadId: string) => apiFetch<CallLog>(`/api/leads/${encodeURIComponent(leadId)}/call`, { method: 'POST' }),

  updateLeadTags: (leadId: string, tags: string[]) =>
    apiFetch<Lead>(`/api/leads/${encodeURIComponent(leadId)}/tags`, { method: 'POST', body: JSON.stringify({ tags }) }),

  updateLeadDetails: (leadId: string, patch: { name?: string; phone?: string }) =>
    apiFetch<Lead>(`/api/leads/${encodeURIComponent(leadId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listCallHistory: () => apiFetch<CallLogWithContext[]>('/api/call-history'),

  refreshCallStatus: (callId: string) => apiFetch<CallLog>(`/api/calls/${encodeURIComponent(callId)}/refresh-status`, { method: 'POST' }),

  getAvailability: (userId: string) => apiFetch<Availability | null>(`/api/availability/${encodeURIComponent(userId)}`),
  setAvailability: (status: AvailabilityStatus) => apiFetch<Availability>('/api/availability', { method: 'POST', body: JSON.stringify({ status }) }),

  getAssignmentEligibility: (userId: string, numberId: string) =>
    apiFetch<AssignmentEligibilityStatus>(`/api/assignment-eligibility?userId=${encodeURIComponent(userId)}&numberId=${encodeURIComponent(numberId)}`),
  setAssignmentEligibility: (input: { userId: string; numberId: string; teamId: string; eligible: boolean }) =>
    apiFetch<AssignmentEligibility>('/api/assignment-eligibility', { method: 'POST', body: JSON.stringify(input) }),

  /** Calls the conversation's customer via Exotel Voice, ringing the agent's own phone first —
   * same underlying provider as initiateLeadCall, just not tied to a Lead record. Uses the
   * WhatsApp number's own phone as caller ID so the customer sees the number they're already
   * chatting with. */
  initiateConversationCall: (conversationId: string) =>
    apiFetch<CallLog>(`/api/conversations/${encodeURIComponent(conversationId)}/call`, { method: 'POST' }),

  listLeadCallLog: (leadId: string) => apiFetch<CallLog[]>(`/api/leads/${encodeURIComponent(leadId)}/call-log`),

  setLeadStage: (leadId: string, stageId: string) =>
    apiFetch<LeadStageAssignment>(`/api/leads/${encodeURIComponent(leadId)}/stage`, { method: 'POST', body: JSON.stringify({ stageId }) }),

  getLeadStage: (leadId: string) => apiFetch<LeadStageAssignment | null>(`/api/leads/${encodeURIComponent(leadId)}/stage`),

  addLeadRemark: (leadId: string, text: string) =>
    apiFetch<LeadRemark>(`/api/leads/${encodeURIComponent(leadId)}/remarks`, { method: 'POST', body: JSON.stringify({ text }) }),

  listLeadRemarks: (leadId: string) => apiFetch<LeadRemark[]>(`/api/leads/${encodeURIComponent(leadId)}/remarks`),

  listLeadActivity: (leadId: string) => apiFetch<AuditEntryWithActor[]>(`/api/leads/${encodeURIComponent(leadId)}/activity`),

  listConversationActivity: (conversationId: string) => apiFetch<AuditEntryWithActor[]>(`/api/conversations/${encodeURIComponent(conversationId)}/activity`),

  startWhatsAppFromLead: (leadId: string) =>
    apiFetch<{ customerId: string; conversationId: string; numberId: string }>(`/api/leads/${encodeURIComponent(leadId)}/start-whatsapp`, { method: 'POST' }),

  updateLeadCustomFields: (leadId: string, values: Record<string, unknown>) =>
    apiFetch<Lead>(`/api/leads/${encodeURIComponent(leadId)}/custom-fields`, { method: 'POST', body: JSON.stringify(values) }),

  // --- Custom field definitions (Admin/Supervisor-managed, shared by Leads and Customers) ---

  listCustomFieldDefinitions: (entityType?: CustomFieldEntityType) =>
    apiFetch<CustomFieldDefinition[]>(`/api/custom-fields${entityType ? `?entityType=${encodeURIComponent(entityType)}` : ''}`),

  createCustomFieldDefinition: (input: { entityType: CustomFieldEntityType; label: string; type: CustomFieldType; options?: string[] }) =>
    apiFetch<CustomFieldDefinition>('/api/custom-fields', { method: 'POST', body: JSON.stringify(input) }),

  updateCustomFieldDefinition: (id: string, patch: Record<string, unknown>) =>
    apiFetch<CustomFieldDefinition>(`/api/custom-fields/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // --- Product Master + Quotations ---

  listProducts: (numberId: string) => apiFetch<Product[]>(`/api/products?numberId=${encodeURIComponent(numberId)}`),

  createProduct: (input: { numberId: string; name: string; sku?: string; unitPrice: number; description?: string }) =>
    apiFetch<Product>('/api/products', { method: 'POST', body: JSON.stringify(input) }),

  updateProduct: (id: string, patch: Record<string, unknown>) =>
    apiFetch<Product>(`/api/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listProductsForLead: (leadId: string) => apiFetch<Product[]>(`/api/leads/${encodeURIComponent(leadId)}/products`),

  listQuotations: (leadId: string) => apiFetch<Quotation[]>(`/api/leads/${encodeURIComponent(leadId)}/quotations`),

  createQuotation: (leadId: string, input: { lineItems: { productId: string; quantity: number; discountPercent?: number }[]; overallDiscountPercent?: number; notes?: string }) =>
    apiFetch<Quotation>(`/api/leads/${encodeURIComponent(leadId)}/quotations`, { method: 'POST', body: JSON.stringify(input) }),

  updateQuotation: (id: string, patch: Record<string, unknown>) =>
    apiFetch<Quotation>(`/api/quotations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getQuotation: (id: string) => apiFetch<Quotation>(`/api/quotations/${encodeURIComponent(id)}`),

  /** No auth token is sent (apiFetch omits it when nobody's signed in) — this is the one
   * deliberately public read, for the link shared with the customer over WhatsApp. */
  getPublicQuotation: (id: string) => apiFetch<PublicQuotationView>(`/api/public/quotations/${encodeURIComponent(id)}`),

  // --- Phase 10/11: templates, quick replies ---

  listTemplates: () => apiFetch<Template[]>('/api/templates'),

  createDraftTemplate: (input: { name: string; language: string; category: string; wabaId?: string; components?: unknown[] }) =>
    apiFetch<Template>('/api/templates', { method: 'POST', body: JSON.stringify(input) }),

  updateDraftTemplate: (id: string, patch: Record<string, unknown>) =>
    apiFetch<Template>(`/api/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  submitTemplateForReview: (id: string) => apiFetch<Template>(`/api/templates/${encodeURIComponent(id)}/submit`, { method: 'POST' }),

  syncTemplatesFromProvider: (wabaId: string) => apiFetch<Template[]>('/api/templates/sync', { method: 'POST', body: JSON.stringify({ wabaId }) }),

  updateTemplateVariableLabels: (id: string, variables: string[]) =>
    apiFetch<Template>(`/api/templates/${encodeURIComponent(id)}/labels`, { method: 'PATCH', body: JSON.stringify({ variables }) }),

  listQuickReplies: () => apiFetch<QuickReply[]>('/api/quick-replies'),

  createQuickReply: (input: { shortcut: string; text: string }) =>
    apiFetch<QuickReply>('/api/quick-replies', { method: 'POST', body: JSON.stringify(input) }),

  updateQuickReply: (id: string, patch: Record<string, unknown>) =>
    apiFetch<QuickReply>(`/api/quick-replies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getDashboardMetrics: (numberId?: string) =>
    apiFetch<DashboardMetrics>(`/api/dashboard${numberId ? `?numberId=${encodeURIComponent(numberId)}` : ''}`),

  backupNow: () => apiFetch<Record<string, unknown>>('/api/backup', { method: 'POST' }),
};

export type { AssignableUser, Customer };
