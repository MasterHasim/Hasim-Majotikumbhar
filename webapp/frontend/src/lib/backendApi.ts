/** Typed wrappers around apiFetch for the endpoints the Inbox UI needs — one-to-one with webapp/backend/src/routes/{phase1,messaging,crm,phase22}.ts. */
import { apiFetch } from './api';
import type {
  AssignableUser, AuditEntry, CallLog, Conversation, ConversationListItem, Customer, CustomerStage, DashboardMetrics, Lead, LeadRemark,
  LeadStageAssignment, LocationAssignmentConfig, LocationAssignmentUser, NumberAccess, NumberAssignmentConfig, NumberAssignmentUser, QuickReply,
  Remark, Reminder, Role, SearchFilters, SearchResultItem, SnoozeStatus, Stage, Team, TeamMember, Template, UploadLeadsResult, User, WhatsAppNumber,
  WhoAmI, Workspace,
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

  sendReply: (conversationId: string, text: string) =>
    apiFetch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),

  resolveConversation: (conversationId: string) =>
    apiFetch<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/resolve`, { method: 'POST' }),

  sendTemplateReply: (conversationId: string, templateId: string, variables: Record<string, unknown>) =>
    apiFetch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/send-template`, { method: 'POST', body: JSON.stringify({ templateId, variables }) }),

  sendMediaReply: (conversationId: string, mediaType: string, mediaUrl: string, caption: string) =>
    apiFetch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/send-media`, { method: 'POST', body: JSON.stringify({ mediaType, mediaUrl, caption }) }),

  reassignConversation: (conversationId: string, newUserId: string) =>
    apiFetch<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/reassign`, { method: 'POST', body: JSON.stringify({ newUserId }) }),

  listStages: () => apiFetch<Stage[]>('/api/lead-stages'),

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

  listUsers: () => apiFetch<User[]>('/api/users'),

  createUser: (input: { email: string; displayName: string; roleIds: string[] }) =>
    apiFetch<User>('/api/users', { method: 'POST', body: JSON.stringify(input) }),

  updateUser: (id: string, patch: Record<string, unknown>) =>
    apiFetch<User>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  setUserPhone: (userId: string, phone: string) =>
    apiFetch<User>(`/api/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ phone }) }),

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

  listLeads: (filters: { location?: string; status?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.location) params.set('location', filters.location);
    if (filters.status) params.set('status', filters.status);
    const qs = params.toString();
    return apiFetch<Lead[]>(`/api/leads${qs ? `?${qs}` : ''}`);
  },

  reassignLead: (leadId: string, userId: string) =>
    apiFetch<Lead>(`/api/leads/${encodeURIComponent(leadId)}/reassign`, { method: 'POST', body: JSON.stringify({ userId }) }),

  getLocationAssignmentConfig: (location: string) => apiFetch<LocationAssignmentConfig | null>(`/api/locations/${encodeURIComponent(location)}/assignment-config`),

  setLocationAssignmentConfig: (location: string, patch: Record<string, unknown>) =>
    apiFetch<LocationAssignmentConfig>(`/api/locations/${encodeURIComponent(location)}/assignment-config`, { method: 'POST', body: JSON.stringify(patch) }),

  listLocationAssignmentParticipants: (location: string) => apiFetch<LocationAssignmentUser[]>(`/api/locations/${encodeURIComponent(location)}/assignment-participants`),

  addLocationAssignmentParticipant: (location: string, userId: string, sequenceOrder?: number) =>
    apiFetch<LocationAssignmentUser>(`/api/locations/${encodeURIComponent(location)}/assignment-participants`, { method: 'POST', body: JSON.stringify({ userId, sequenceOrder }) }),

  updateLocationAssignmentParticipant: (id: string, patch: Record<string, unknown>) =>
    apiFetch<LocationAssignmentUser>(`/api/location-assignment-participants/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  initiateLeadCall: (leadId: string) => apiFetch<CallLog>(`/api/leads/${encodeURIComponent(leadId)}/call`, { method: 'POST' }),

  listLeadCallLog: (leadId: string) => apiFetch<CallLog[]>(`/api/leads/${encodeURIComponent(leadId)}/call-log`),

  setLeadStage: (leadId: string, stageId: string) =>
    apiFetch<LeadStageAssignment>(`/api/leads/${encodeURIComponent(leadId)}/stage`, { method: 'POST', body: JSON.stringify({ stageId }) }),

  getLeadStage: (leadId: string) => apiFetch<LeadStageAssignment | null>(`/api/leads/${encodeURIComponent(leadId)}/stage`),

  addLeadRemark: (leadId: string, text: string) =>
    apiFetch<LeadRemark>(`/api/leads/${encodeURIComponent(leadId)}/remarks`, { method: 'POST', body: JSON.stringify({ text }) }),

  listLeadRemarks: (leadId: string) => apiFetch<LeadRemark[]>(`/api/leads/${encodeURIComponent(leadId)}/remarks`),

  startWhatsAppFromLead: (leadId: string) =>
    apiFetch<{ customerId: string; conversationId: string; numberId: string }>(`/api/leads/${encodeURIComponent(leadId)}/start-whatsapp`, { method: 'POST' }),

  // --- Phase 10/11: templates, quick replies ---

  listTemplates: () => apiFetch<Template[]>('/api/templates'),

  createDraftTemplate: (input: { name: string; language: string; category: string; wabaId?: string; components?: unknown[] }) =>
    apiFetch<Template>('/api/templates', { method: 'POST', body: JSON.stringify(input) }),

  updateDraftTemplate: (id: string, patch: Record<string, unknown>) =>
    apiFetch<Template>(`/api/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  submitTemplateForReview: (id: string) => apiFetch<Template>(`/api/templates/${encodeURIComponent(id)}/submit`, { method: 'POST' }),

  syncTemplatesFromProvider: (wabaId: string) => apiFetch<Template[]>('/api/templates/sync', { method: 'POST', body: JSON.stringify({ wabaId }) }),

  listQuickReplies: () => apiFetch<QuickReply[]>('/api/quick-replies'),

  createQuickReply: (input: { shortcut: string; text: string }) =>
    apiFetch<QuickReply>('/api/quick-replies', { method: 'POST', body: JSON.stringify(input) }),

  updateQuickReply: (id: string, patch: Record<string, unknown>) =>
    apiFetch<QuickReply>(`/api/quick-replies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getDashboardMetrics: (numberId?: string) =>
    apiFetch<DashboardMetrics>(`/api/dashboard${numberId ? `?numberId=${encodeURIComponent(numberId)}` : ''}`),
};

export type { AssignableUser, Customer };
