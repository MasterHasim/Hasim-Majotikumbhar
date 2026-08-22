/**
 * Meta Marketing API client — read-only ad performance (spend/reach/messages-initiated) for the
 * Dashboard's "Ad Performance" section. UNVERIFIED against a real Meta response — modeled on the
 * documented Insights endpoint shape, not yet exercised against a real ad account/token (same
 * "flag it, don't pretend it's tested" convention ExotelProvider/ExotelVoiceProvider used for
 * their own first-build methods).
 */
import { ApiError } from '../types';

const GRAPH_API_VERSION = 'v21.0';

export interface MetaInsightRow {
  campaignName: string;
  spend: number;
  reach: number;
  messagesInitiated: number;
}

interface MetaAction {
  action_type?: string;
  value?: string;
}

interface MetaInsightsApiRow {
  campaign_name?: string;
  spend?: string;
  reach?: string;
  actions?: MetaAction[];
}

/** Click-to-WhatsApp ads report the conversation-started metric under one of these action_type
 * values depending on API version/attribution window — checked in order, first match wins. */
const MESSAGING_ACTION_TYPES = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started_28d',
  'onsite_conversion.messaging_conversation_started',
];

function extractMessagesInitiated(actions: MetaAction[] | undefined): number {
  if (!actions) return 0;
  for (const type of MESSAGING_ACTION_TYPES) {
    const match = actions.find((a) => a.action_type === type);
    if (match) return Number(match.value) || 0;
  }
  return 0;
}

export class MetaAdsProvider {
  constructor(private accessToken: string) {}

  /** from/to as YYYY-MM-DD. Reports per-campaign, which is the natural "Ad Name" grain for the
   * dashboard table (an ad set/ad-level breakdown would be finer than what was asked for). */
  async getInsights(externalAccountId: string, from: string, to: string): Promise<MetaInsightRow[]> {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/act_${externalAccountId}/insights`);
    url.searchParams.set('level', 'campaign');
    url.searchParams.set('fields', 'campaign_name,spend,reach,actions');
    url.searchParams.set('time_range', JSON.stringify({ since: from, until: to }));
    url.searchParams.set('access_token', this.accessToken);

    const res = await fetch(url.toString());
    const body = (await res.json().catch(() => null)) as { data?: MetaInsightsApiRow[]; error?: { message?: string } } | null;
    if (!res.ok || !body || body.error) {
      throw new ApiError(502, 'PROVIDER_ERROR', `Meta Ads request failed: ${body?.error?.message || res.statusText}`);
    }
    return (body.data ?? []).map((row) => ({
      campaignName: row.campaign_name || '(unnamed campaign)',
      spend: Number(row.spend) || 0,
      reach: Number(row.reach) || 0,
      messagesInitiated: extractMessagesInitiated(row.actions),
    }));
  }
}

export function requireMetaAdsConfig(env: { META_ACCESS_TOKEN?: string }): string {
  if (!env.META_ACCESS_TOKEN) throw new ApiError(500, 'CONFIGURATION_ERROR', 'Meta Ads is not configured yet — set META_ACCESS_TOKEN.');
  return env.META_ACCESS_TOKEN;
}
