/**
 * Ad Performance — admin registers which ad accounts to report on (Admin -> Ad Accounts,
 * ADMIN-only since this is spend/financial data), then anyone with REPORTS_VIEW (the same
 * permission the rest of the Dashboard already gates on) can pull insights for one.
 */
import { ApiError } from '../types';
import { Ids, Permissions, Validation } from '../domain/phase1';
import type { AdAccount, AdInsightRow } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { MetaAdsProvider, requireMetaAdsConfig } from './metaAdsProvider';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class AdsApi {
  private access: AccessControl;
  private audit: AuditLogService;
  private accounts: Repository<AdAccount>;

  constructor(private db: FirebaseDb, identityEmail: string, private env: { META_ACCESS_TOKEN?: string }) {
    const repos: Phase1Repositories = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(repos, this.audit, identityEmail);
    this.accounts = new Repository<AdAccount>(db, 'adAccounts');
  }

  async listAdAccounts(): Promise<AdAccount[]> {
    await this.access.require(Permissions.REPORTS_VIEW);
    return this.accounts.list();
  }

  async createAdAccount(input: { name: string; externalAccountId: string; platform?: string }): Promise<AdAccount> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    const name = Validation.requiredString(input.name, 'name');
    const externalAccountId = Validation.requiredString(input.externalAccountId, 'externalAccountId').replace(/^act_/, '');
    if (!/^\d+$/.test(externalAccountId)) throw new ApiError(400, 'VALIDATION_ERROR', 'externalAccountId should be the numeric Meta ad account id (the "act_" prefix is added automatically).');
    if (await this.accounts.findOne((a) => a.externalAccountId === externalAccountId)) throw new ApiError(409, 'CONFLICT', 'This ad account is already registered.');
    const now = Ids.now();
    const record: AdAccount = { id: Ids.create('adaccount'), platform: 'meta', name, externalAccountId, active: true, createdAt: now, updatedAt: now };
    await this.accounts.create(record);
    await this.audit.write(actor.id, 'adAccount.created', 'adAccount', record.id, { name, externalAccountId });
    return record;
  }

  async updateAdAccount(id: string, patch: Record<string, unknown>): Promise<AdAccount> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    if (!(await this.accounts.get(id))) throw new ApiError(404, 'NOT_FOUND', 'Ad account was not found.');
    const allowed = ['name', 'active'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    const record = await this.accounts.update(id, safePatch as Partial<AdAccount>);
    await this.audit.write(actor.id, 'adAccount.updated', 'adAccount', id, { patch: safePatch });
    return record;
  }

  /** from/to as YYYY-MM-DD, inclusive. Adds a synthetic "Total" row so the dashboard doesn't need
   * its own summation logic. */
  async getAdInsights(accountId: string, from: string, to: string): Promise<{ platform: string; rows: (AdInsightRow & { isTotal?: boolean })[] }> {
    await this.access.require(Permissions.REPORTS_VIEW);
    const account = await this.accounts.get(accountId);
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'Ad account was not found.');
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new ApiError(400, 'VALIDATION_ERROR', 'from/to must be YYYY-MM-DD.');

    if (account.platform === 'meta') {
      const token = requireMetaAdsConfig(this.env);
      const rows = await new MetaAdsProvider(token).getInsights(account.externalAccountId, from, to);
      const total: AdInsightRow & { isTotal: true } = {
        campaignName: 'Total', isTotal: true,
        spend: rows.reduce((sum, r) => sum + r.spend, 0),
        reach: rows.reduce((sum, r) => sum + r.reach, 0),
        messagesInitiated: rows.reduce((sum, r) => sum + r.messagesInitiated, 0),
      };
      return { platform: 'Meta', rows: rows.length > 0 ? [...rows, total] : [] };
    }
    throw new ApiError(500, 'CONFIGURATION_ERROR', `Unsupported ad platform: ${account.platform}`);
  }

  /**
   * Campaign names currently running across every active registered ad account — backs the
   * 'campaign' CustomFieldType dropdown (see customFieldsApi.ts), so an agent tagging a Lead
   * picks from real live campaigns instead of typing a free-text name. Deliberately not gated on
   * REPORTS_VIEW like the rest of this file: unlike spend/reach, a bare campaign name isn't
   * financial data, and any agent editing lead custom fields needs to see this list, not just
   * SUPERVISOR+. Any authenticated user, matching listCustomFieldDefinitions' own reasoning.
   * Soft-fails to an empty list when Meta isn't configured or no account is registered — this
   * runs inline while editing a Lead, so it should never block that on an ads-integration gap.
   */
  async listActiveCampaigns(): Promise<{ name: string }[]> {
    await this.access.currentUser();
    if (!this.env.META_ACCESS_TOKEN) return [];
    const accounts = (await this.accounts.list()).filter((a) => a.active && a.platform === 'meta');
    if (accounts.length === 0) return [];
    try {
      const perAccount = await Promise.all(accounts.map((a) => new MetaAdsProvider(this.env.META_ACCESS_TOKEN!).listActiveCampaigns(a.externalAccountId)));
      const names = new Set<string>();
      for (const campaigns of perAccount) for (const c of campaigns) names.add(c.name);
      return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
    } catch {
      // Best-effort convenience list for a field editor — a transient Meta error should never
      // block editing a Lead's custom fields, unlike getAdInsights which is the real reporting path.
      return [];
    }
  }
}
