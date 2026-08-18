/** Typed wrappers around apiFetch for the endpoints the Inbox UI needs — one-to-one with webapp/backend/src/routes/{phase1,messaging,crm}.ts. */
import { apiFetch } from './api';
import type {
  AssignableUser, Conversation, ConversationListItem, Customer, CustomerStage, Remark, Reminder,
  SnoozeStatus, Stage, WhatsAppNumber, WhoAmI, Workspace,
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
};

export type { AssignableUser, Customer };
