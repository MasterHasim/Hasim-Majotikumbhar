import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { AdsApi } from '../src/services/adsApi';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';
const VIEWER_EMAIL = 'viewer@example.com';

describe('AdsApi (Meta Ads reporting)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;

  function apiAs(email: string) {
    return new AdsApi(db, email, mock.metaAdsEnv as never);
  }

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);

    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === Roles.AGENT)!.id;
    const viewerRoleId = roles.find((r) => r.key === Roles.VIEWER)!.id;

    const agent = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [] });
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(agent.id, { roleIds: [agentRoleId] });
    const viewer = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: VIEWER_EMAIL, displayName: 'Viewer', roleIds: [] });
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(viewer.id, { roleIds: [viewerRoleId] });
  });

  afterEach(() => mock.restore());

  describe('createAdAccount / updateAdAccount', () => {
    it('is ADMIN-only (SETTINGS_MANAGE) — denies AGENT and VIEWER', async () => {
      await expect(apiAs(AGENT_EMAIL).createAdAccount({ name: 'X', externalAccountId: '123' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(apiAs(VIEWER_EMAIL).createAdAccount({ name: 'X', externalAccountId: '123' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('strips a leading "act_" and validates the id is numeric', async () => {
      const account = await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Entartica Sea World', externalAccountId: 'act_1030851627297277' });
      expect(account.externalAccountId).toBe('1030851627297277');
      expect(account.platform).toBe('meta');
      expect(account.active).toBe(true);

      await expect(apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Bad', externalAccountId: 'not-a-number' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects a duplicate externalAccountId', async () => {
      await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'First', externalAccountId: '1030851627297277' });
      await expect(apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Second', externalAccountId: '1030851627297277' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('updateAdAccount can deactivate/rename, and rejects an unknown field', async () => {
      const account = await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Entartica Sea World', externalAccountId: '1030851627297277' });
      const updated = await apiAs(ADMIN_EMAIL).updateAdAccount(account.id, { active: false, name: 'Renamed' });
      expect(updated.active).toBe(false);
      expect(updated.name).toBe('Renamed');
      await expect(apiAs(ADMIN_EMAIL).updateAdAccount(account.id, { externalAccountId: '999' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('listAdAccounts', () => {
    it('is readable by anyone with REPORTS_VIEW (VIEWER included), denied for AGENT', async () => {
      await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Entartica Sea World', externalAccountId: '1030851627297277' });
      await expect(apiAs(VIEWER_EMAIL).listAdAccounts()).resolves.toHaveLength(1);
      await expect(apiAs(AGENT_EMAIL).listAdAccounts()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('getAdInsights', () => {
    it('fetches per-campaign rows from Meta, extracts messagesInitiated from the actions array, and appends a Total row', async () => {
      const account = await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Entartica Sea World', externalAccountId: '1030851627297277' });
      mock.setNextMetaAdsResponse(200, {
        data: [
          { campaign_name: 'Solar Leads - Raipur', spend: '1234.56', reach: '8000', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '45' }, { action_type: 'link_click', value: '120' }] },
          { campaign_name: 'Solar Leads - Rajsamand', spend: '500', reach: '2000', actions: [] },
        ],
      });
      const result = await apiAs(ADMIN_EMAIL).getAdInsights(account.id, '2026-08-01', '2026-08-22');
      expect(result.platform).toBe('Meta');
      expect(result.rows).toHaveLength(3); // 2 campaigns + total
      expect(result.rows[0]).toMatchObject({ campaignName: 'Solar Leads - Raipur', spend: 1234.56, reach: 8000, messagesInitiated: 45 });
      expect(result.rows[1]).toMatchObject({ campaignName: 'Solar Leads - Rajsamand', spend: 500, reach: 2000, messagesInitiated: 0 });
      const total = result.rows[2]!;
      expect(total.campaignName).toBe('Total');
      expect(total.spend).toBeCloseTo(1734.56, 2);
      expect(total.reach).toBe(10000);
      expect(total.messagesInitiated).toBe(45);

      const call = mock.metaAdsCalls.at(-1)!;
      expect(call.url).toContain('act_1030851627297277/insights');
      expect(call.url).toContain('access_token=test-meta-token');
    });

    it('returns no rows (not an error) for a date range with no campaign activity', async () => {
      const account = await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Entartica Sea World', externalAccountId: '1030851627297277' });
      mock.setNextMetaAdsResponse(200, { data: [] });
      const result = await apiAs(ADMIN_EMAIL).getAdInsights(account.id, '2026-08-01', '2026-08-22');
      expect(result.rows).toEqual([]);
    });

    it('surfaces a Meta API error as PROVIDER_ERROR', async () => {
      const account = await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Entartica Sea World', externalAccountId: '1030851627297277' });
      mock.setNextMetaAdsResponse(400, { error: { message: 'Invalid OAuth access token' } });
      await expect(apiAs(ADMIN_EMAIL).getAdInsights(account.id, '2026-08-01', '2026-08-22')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });

    it('rejects a malformed date and an unknown account id', async () => {
      const account = await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Entartica Sea World', externalAccountId: '1030851627297277' });
      await expect(apiAs(ADMIN_EMAIL).getAdInsights(account.id, '08-01-2026', '2026-08-22')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(apiAs(ADMIN_EMAIL).getAdInsights('nope', '2026-08-01', '2026-08-22')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('is denied for AGENT (no REPORTS_VIEW)', async () => {
      const account = await apiAs(ADMIN_EMAIL).createAdAccount({ name: 'Entartica Sea World', externalAccountId: '1030851627297277' });
      await expect(apiAs(AGENT_EMAIL).getAdInsights(account.id, '2026-08-01', '2026-08-22')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
