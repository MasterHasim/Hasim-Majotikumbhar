/** Typed wrappers around apiFetch for the endpoints the Inbox UI needs — one-to-one with webapp/backend/src/routes/{phase1,messaging,crm,phase22}.ts. */
import { apiFetch } from './api';
import type {
  AssignableUser, CallLog, Conversation, ConversationListItem, Customer, CustomerStage, Lead, LeadRemark, LeadStageAssignment,
  LocationAssignmentConfig, LocationAssignmentUser, Remark, Reminder, SnoozeStatus, Stage, UploadLeadsResult, User, WhatsAppNumber, WhoAmI, Workspace,
} from '../types';

export const backendApi = {
  whoAmI: () => apiFetch<WhoAmI>('/api/whoami'),

  listMyNumbers: () => apiFetch<WhatsAppNumber[]>('/api/my-numbers'),

  createNumber: (input: { displayName: string; phoneNumber: string; provider: string }) =>
    apiFetch<WhatsAppNumber>('/api/numbers', { method: 'POST', body: JSON.stringify(input) }),

  listConversations: (numberId: string) => apiFetch<ConversationListItem[]>(`/api/conversations?numberId=${encodeURIComponent(numberId)}`),

  getWorkspace: (conversationId: string, includeRealtime = false) =>
    apiFetch<Workspace>(`/api/workspace/${encodeURIComponent(conversationId)}${includeRealtime ? '?includeRealtime=true' : ''}`),

  sendReply: (conversationId: string, text: string) =>
    apiFetch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),

  resolveConversation: (conversationId: string) =>
    apiFetch<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/resolve`, { method: 'POST' }),

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

  setUserPhone: (userId: string, phone: string) =>
    apiFetch<User>(`/api/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ phone }) }),

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
};

export type { AssignableUser, Customer };
