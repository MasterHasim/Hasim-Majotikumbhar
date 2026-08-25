import type { ChatbotMode, Conversation, WhatsAppNumber } from '../domain/types';

/**
 * Pure routing guard shared by inbound ingestion and the future chatbot provider adapter.
 * It deliberately does not call an external engine: provider credentials and a verified request
 * contract must be added before any live WhatsApp number can receive automatic bot replies.
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
