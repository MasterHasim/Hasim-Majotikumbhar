import type { ChatbotMode, Conversation, WhatsAppNumber } from '../domain/types';

/**
 * Pure routing guard shared by inbound ingestion and the chatbot provider adapter
 * (ChatbotIntegrationApi.notifyInboundMessage, wired up 2026-08-31). This function only decides
 * WHETHER and under what mode a message should reach the chatbot — it deliberately never makes
 * the actual outbound call itself, so the decision stays trivially unit-testable in isolation
 * from network/signing concerns.
 */
export type ChatbotInboundDecision =
  | { action: 'disabled'; mode: 'off' | 'paused'; reason: string }
  | { action: 'blocked_by_human'; mode: ChatbotMode; reason: string }
  | { action: 'shadow'; mode: 'shadow'; reason: string }
  | { action: 'reply'; mode: 'active'; reason: string };

export function chatbotModeFor(number: WhatsAppNumber): ChatbotMode {
  return number.chatbotMode ?? 'off';
}

export function decideInboundChatbotRouting(number: WhatsAppNumber, conversation: Conversation): ChatbotInboundDecision {
  const mode = chatbotModeFor(number);
  if (mode === 'off' || mode === 'paused') return { action: 'disabled', mode, reason: `number_mode_${mode}` };
  if (conversation.chatbotState === 'HUMAN') return { action: 'blocked_by_human', mode, reason: 'conversation_human_handoff' };
  if (mode === 'shadow') return { action: 'shadow', mode, reason: 'shadow_draft_only' };
  return { action: 'reply', mode, reason: 'active_pending_provider' };
}
