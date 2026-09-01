import { describe, expect, it } from 'vitest';
import { decideProfileDispatch } from '../src/services/chatbotProfileRouting';
import type { ChatbotProfile, Conversation } from '../src/domain/types';

function profile(overrides: Partial<ChatbotProfile> & Pick<ChatbotProfile, 'id' | 'priority'>): ChatbotProfile {
  return { numberId: 'number-1', name: overrides.id, mode: 'active', active: true, createdAt: '', updatedAt: '', ...overrides };
}
function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return { id: 'conversation-1', customerId: 'customer-1', numberId: 'number-1', assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '', ...overrides };
}

describe('decideProfileDispatch (multi-bot-per-number priority-order routing, 2026-09-01)', () => {
  it('picks the highest-priority active+eligible profile among several, ignoring a lower-priority one', () => {
    const profiles = [
      profile({ id: 'sales', priority: 1, mode: 'active' }),
      profile({ id: 'support', priority: 0, mode: 'active' }),
    ];
    const decision = decideProfileDispatch(profiles, conversation());
    expect(decision).toMatchObject({ action: 'reply', profile: { id: 'support' } });
  });

  it('skips an off/paused profile during initial selection', () => {
    const profiles = [
      profile({ id: 'disabled-one', priority: 0, mode: 'off' }),
      profile({ id: 'paused-one', priority: 1, mode: 'paused' }),
      profile({ id: 'eligible', priority: 2, mode: 'shadow' }),
    ];
    const decision = decideProfileDispatch(profiles, conversation());
    expect(decision).toMatchObject({ action: 'shadow', profile: { id: 'eligible' } });
  });

  it('a sticky-assigned profile that has since gone off/paused returns disabled, not a fallback to another profile', () => {
    const profiles = [
      profile({ id: 'assigned-but-paused', priority: 0, mode: 'paused' }),
      profile({ id: 'would-otherwise-win', priority: 1, mode: 'active' }),
    ];
    const decision = decideProfileDispatch(profiles, conversation({ chatbotProfileId: 'assigned-but-paused' }));
    expect(decision).toEqual({ action: 'disabled', reason: 'profile_mode_paused' });
  });

  it('a sticky-assigned profile that was deactivated (soft-deleted) returns disabled', () => {
    const profiles = [
      profile({ id: 'assigned-but-inactive', priority: 0, mode: 'active', active: false }),
      profile({ id: 'would-otherwise-win', priority: 1, mode: 'active' }),
    ];
    const decision = decideProfileDispatch(profiles, conversation({ chatbotProfileId: 'assigned-but-inactive' }));
    expect(decision).toEqual({ action: 'disabled', reason: 'assigned_profile_inactive_or_missing' });
  });

  it('sticky assignment is not overridden by a later, higher-priority profile', () => {
    const profiles = [
      profile({ id: 'originally-assigned', priority: 5, mode: 'active' }),
      profile({ id: 'newly-added-higher-priority', priority: 0, mode: 'active' }),
    ];
    const decision = decideProfileDispatch(profiles, conversation({ chatbotProfileId: 'originally-assigned' }));
    expect(decision).toMatchObject({ action: 'reply', profile: { id: 'originally-assigned' } });
  });

  it('conversation.chatbotState HUMAN blocks regardless of profiles or existing assignment', () => {
    const profiles = [profile({ id: 'sales', priority: 0, mode: 'active' })];
    const decision = decideProfileDispatch(profiles, conversation({ chatbotProfileId: 'sales', chatbotState: 'HUMAN' }));
    expect(decision).toEqual({ action: 'blocked_by_human', reason: 'conversation_human_handoff' });
  });

  it('no profiles at all returns no_active_profile', () => {
    expect(decideProfileDispatch([], conversation())).toEqual({ action: 'no_active_profile', reason: 'no_eligible_profile_in_priority_order' });
  });

  it('profiles exist but none are active/eligible (all off, paused, or soft-deleted) returns no_active_profile', () => {
    const profiles = [
      profile({ id: 'one', priority: 0, mode: 'off' }),
      profile({ id: 'two', priority: 1, mode: 'active', active: false }),
    ];
    expect(decideProfileDispatch(profiles, conversation())).toEqual({ action: 'no_active_profile', reason: 'no_eligible_profile_in_priority_order' });
  });
});
