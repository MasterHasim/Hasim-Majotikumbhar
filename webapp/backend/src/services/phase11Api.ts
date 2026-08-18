/**
 * Direct port of apps-script/src/Phase11Services.gs's Phase11Api — quick replies
 * only (media messages live on Phase6Api, mirroring where the source put them:
 * Phase6Services.gs's sendMediaReply/uploadConversationMedia). Managing the list is
 * admin configuration (SETTINGS_MANAGE, ADMIN-only); any authenticated user may list
 * them, used to populate the compose box's shortcut picker — same shape as Phase 8's
 * Lead_Stages pattern.
 */
import { ApiError } from '../types';
import { Ids, Permissions, Validation } from '../domain/phase1';
import type { QuickReply } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

export class Phase11Api {
  readonly access: AccessControl;
  private phase1Repos: Phase1Repositories;
  private audit: AuditLogService;
  private quickReplies: Repository<QuickReply>;

  constructor(db: FirebaseDb, identityEmail: string) {
    this.phase1Repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
    this.quickReplies = new Repository<QuickReply>(db, 'quickReplies');
  }

  async createQuickReply(input: { shortcut: string; text: string; active?: boolean }): Promise<QuickReply> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    const shortcut = Validation.requiredString(input.shortcut, 'shortcut');
    if (await this.quickReplies.findOne((q) => q.shortcut === shortcut)) throw new ApiError(409, 'CONFLICT', 'A quick reply with this shortcut already exists.');
    const now = Ids.now();
    const record: QuickReply = { id: Ids.create('quickreply'), shortcut, text: Validation.requiredString(input.text, 'text'), active: input.active !== false, createdAt: now, updatedAt: now };
    await this.quickReplies.create(record);
    await this.audit.write(actor.id, 'quickReply.created', 'quickReply', record.id, {});
    return record;
  }

  async updateQuickReply(id: string, patch: Record<string, unknown>): Promise<QuickReply> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    if (!(await this.quickReplies.get(id))) throw new ApiError(404, 'NOT_FOUND', 'Quick reply was not found.');
    const allowed = ['shortcut', 'text', 'active'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    const record = await this.quickReplies.update(id, safePatch as Partial<QuickReply>);
    await this.audit.write(actor.id, 'quickReply.updated', 'quickReply', id, {});
    return record;
  }

  async listQuickReplies(): Promise<QuickReply[]> {
    await this.access.currentUser(); // any authenticated user may see the quick-reply list (used for the compose box)
    return (await this.quickReplies.list()).filter((q) => q.active !== false).sort((a, b) => (a.shortcut || '').localeCompare(b.shortcut || ''));
  }
}
