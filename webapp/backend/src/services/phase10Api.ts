/**
 * Direct port of apps-script/src/Phase10Services.gs's Phase10Api — WhatsApp
 * template draft -> admin review -> submit -> pending -> approved/rejected, plus
 * syncing real templates from Exotel. TEMPLATES_MANAGE (create/edit/submit/sync) is
 * ADMIN-only per Phase 1's role definitions; AGENT has TEMPLATES_USE instead, for
 * sending an already-approved template via Phase6Api.
 *
 * submitTemplateForReview and syncTemplatesFromProvider both call ExotelProvider for
 * real, same "built and tested, not invoked live unattended" boundary as Phase 6's
 * sendReply — submitting creates a real template on the WABA pending Meta's review.
 */
import { ApiError } from '../types';
import { Ids, Permissions, Validation } from '../domain/phase1';
import type { Template } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { ExotelProvider, requireExotelConfig, type ExotelConfig } from './exotelProvider';

function extractTemplateEntries(raw: unknown): { data?: Record<string, unknown> }[] {
  // Confirmed live shape (Phase 3, apps-script): {response: {whatsapp: {templates: [{data: {...}}]}}}.
  const r = raw as { response?: { whatsapp?: { templates?: { data?: Record<string, unknown> }[] } } } | undefined;
  return r?.response?.whatsapp?.templates ?? [];
}

function extractProviderTemplateId(response: unknown): string | null {
  // UNVERIFIED — createTemplate has never been called live, same flag the source carries.
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  if (typeof r.id === 'string') return r.id;
  const data = (r.data as Record<string, unknown> | undefined) ?? ((r.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined);
  return (data?.id as string | undefined) ?? null;
}

export class Phase10Api {
  readonly access: AccessControl;
  private phase1Repos: Phase1Repositories;
  private audit: AuditLogService;
  private templates: Repository<Template>;
  private exotelConfig?: ExotelConfig;

  constructor(db: FirebaseDb, identityEmail: string, env?: { EXOTEL_API_KEY?: string; EXOTEL_API_TOKEN?: string; EXOTEL_ACCOUNT_SID?: string; EXOTEL_SUBDOMAIN?: string }) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.templates = new Repository<Template>(db, 'templates');
    if (env) this.exotelConfig = requireExotelConfig(env);
  }

  async createDraftTemplate(input: { wabaId?: string; name: string; language: string; category: string; components?: unknown[]; variables?: string[] }): Promise<Template> {
    const actor = await this.access.require(Permissions.TEMPLATES_MANAGE);
    const now = Ids.now();
    const record: Template = {
      id: Ids.create('template'), wabaId: input.wabaId || '', providerTemplateId: '',
      name: Validation.requiredString(input.name, 'name'), language: Validation.requiredString(input.language, 'language'),
      category: Validation.requiredString(input.category, 'category'), status: 'LOCAL_DRAFT',
      components: input.components || [], variables: input.variables || [], createdAt: now, updatedAt: now, lastSyncedAt: '',
    };
    await this.templates.create(record);
    await this.audit.write(actor.id, 'template.draftCreated', 'template', record.id, {});
    return record;
  }

  async updateDraftTemplate(id: string, patch: Record<string, unknown>): Promise<Template> {
    const actor = await this.access.require(Permissions.TEMPLATES_MANAGE);
    const record = await this.templates.get(id);
    if (!record) throw new ApiError(404, 'NOT_FOUND', 'Template was not found.');
    if (record.status !== 'LOCAL_DRAFT') throw new ApiError(400, 'VALIDATION_ERROR', 'Only a LOCAL_DRAFT template can be edited.');
    const allowed = ['wabaId', 'name', 'language', 'category', 'components', 'variables'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    const updated = await this.templates.update(id, safePatch as Partial<Template>);
    await this.audit.write(actor.id, 'template.draftUpdated', 'template', id, {});
    return updated;
  }

  async listTemplates(): Promise<Template[]> {
    await this.access.currentUser();
    return this.templates.list();
  }

  async getTemplate(id: string): Promise<Template> {
    await this.access.currentUser();
    const record = await this.templates.get(id);
    if (!record) throw new ApiError(404, 'NOT_FOUND', 'Template was not found.');
    return record;
  }

  async submitTemplateForReview(id: string): Promise<Template> {
    const actor = await this.access.require(Permissions.TEMPLATES_MANAGE);
    const record = await this.templates.get(id);
    if (!record) throw new ApiError(404, 'NOT_FOUND', 'Template was not found.');
    if (record.status !== 'LOCAL_DRAFT') throw new ApiError(400, 'VALIDATION_ERROR', 'Only a LOCAL_DRAFT template can be submitted.');
    if (!record.wabaId) throw new ApiError(400, 'VALIDATION_ERROR', 'wabaId is required before submission.');

    const response = await new ExotelProvider(this.requireExotel()).createTemplate(record.wabaId, { name: record.name, language: record.language, category: record.category, components: record.components });
    const providerTemplateId = extractProviderTemplateId(response) || '';
    const updated = await this.templates.update(id, { status: 'PENDING', providerTemplateId, lastSyncedAt: Ids.now() });
    await this.audit.write(actor.id, 'template.submitted', 'template', id, { wabaId: record.wabaId });
    return updated;
  }

  /** Refreshes local template records from a live getTemplates() call — that part of ExotelProvider is confirmed live, only this sync/upsert logic is new. */
  async syncTemplatesFromProvider(wabaId: string): Promise<Template[]> {
    const actor = await this.access.require(Permissions.TEMPLATES_MANAGE);
    const validWabaId = Validation.requiredString(wabaId, 'wabaId');
    const raw = await new ExotelProvider(this.requireExotel()).getTemplates(validWabaId);
    const entries = extractTemplateEntries(raw);
    const now = Ids.now();
    const results: Template[] = [];
    for (const entry of entries) {
      const data = entry.data ?? (entry as unknown as Record<string, unknown>);
      if (!data || !data.id) continue;
      const existing = await this.templates.findOne((t) => t.providerTemplateId === data.id);
      const record: Template = {
        id: existing ? existing.id : Ids.create('template'),
        wabaId: validWabaId, providerTemplateId: data.id as string, name: data.name as string, language: data.language as string, category: data.category as string,
        status: (data.status as Template['status']) || 'PENDING', components: (data.components as unknown[]) || [], variables: existing ? existing.variables : [],
        createdAt: existing ? existing.createdAt : now, updatedAt: now, lastSyncedAt: now,
      };
      await this.templates.replace(record.id, record);
      results.push(record);
    }
    await this.audit.write(actor.id, 'templates.synced', 'waba', validWabaId, { count: results.length });
    return results;
  }

  private requireExotel(): ExotelConfig {
    if (!this.exotelConfig) throw new ApiError(500, 'CONFIGURATION_ERROR', 'Exotel credentials are not fully configured.');
    return this.exotelConfig;
  }
}
