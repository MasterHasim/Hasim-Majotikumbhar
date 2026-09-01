import type { ChatbotProfile, Conversation } from '../domain/types';

/**
 * Pure routing guard for the multi-bot-per-number system (Phase 1, added 2026-09-01). Mirrors
 * chatbotRouting.ts's "decide, don't act" shape exactly — this function only decides WHICH
 * profile (if any) should handle a message and how, it never makes the outbound call itself, so
 * the decision stays trivially unit-testable in isolation from network/signing concerns. See
 * chatbotProfileApi.ts's dispatchInboundMessageToChatbotProfiles for the caller that acts on this.
 */
export type ChatbotProfileDispatchDecision =
  | { action: 'disabled'; reason: string }
  | { action: 'blocked_by_human'; reason: string }
  | { action: 'no_active_profile'; reason: string }
  | { action: 'shadow'; profile: ChatbotProfile; reason: string }
  | { action: 'reply'; profile: ChatbotProfile; reason: string };

/**
 * profiles should be every ChatbotProfile row for the conversation's number (any priority order,
 * this function does its own sort). Sticky assignment: once a conversation has a
 * chatbotProfileId, that exact profile is used for every later message — never re-picked by
 * priority, even if a higher-priority profile is added or reordered afterward — and if that
 * profile is no longer active/eligible, dispatch returns `disabled` rather than silently
 * failing over to a different bot.
 */
export function decideProfileDispatch(profiles: ChatbotProfile[], conversation: Conversation): ChatbotProfileDispatchDecision {
  if (conversation.chatbotState === 'HUMAN') return { action: 'blocked_by_human', reason: 'conversation_human_handoff' };
  const active = profiles.filter((p) => p.active);

  let profile: ChatbotProfile | undefined;
  if (conversation.chatbotProfileId) {
    profile = active.find((p) => p.id === conversation.chatbotProfileId);
    if (!profile) return { action: 'disabled', reason: 'assigned_profile_inactive_or_missing' };
  } else {
    profile = active
      .filter((p) => p.mode === 'active' || p.mode === 'shadow')
      .sort((a, b) => a.priority - b.priority)[0];
    if (!profile) return { action: 'no_active_profile', reason: 'no_eligible_profile_in_priority_order' };
  }

  if (profile.mode === 'off' || profile.mode === 'paused') return { action: 'disabled', reason: `profile_mode_${profile.mode}` };
  if (profile.mode === 'shadow') return { action: 'shadow', profile, reason: 'shadow_draft_only' };
  return { action: 'reply', profile, reason: 'active_pending_provider' };
}
