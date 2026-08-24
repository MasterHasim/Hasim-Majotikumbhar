/** Direct port of apps-script/src/Phase3Services.gs's Phase3Api — thin, authorized CRUD over WhatsApp numbers. */
import { ApiError } from '../types';
import { Ids, Permissions, Validation } from '../domain/phase1';
import type { WhatsAppNumber } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { AppDb } from '../lib/appDb';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

const ALLOWED_UPDATE_FIELDS = ['displayName', 'phoneNumber', 'provider', 'providerAccountId', 'wabaId', 'providerNumberId', 'active'];

export class Phase3Api {
  private access: AccessControl;
  private audit: AuditLogService;
  numbers: Repository<WhatsAppNumber>;

  constructor(db: AppDb, identityEmail: string) {
    const repos: Phase1Repositories = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(repos, this.audit, identityEmail);
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
  }

  async createNumber(input: { displayName: string; phoneNumber: string; provider: string; providerAccountId?: string; wabaId?: string; providerNumberId?: string; active?: boolean }): Promise<WhatsAppNumber> {
    const actor = await this.access.require(Permissions.NUMBERS_ADMIN);
    const displayName = Validation.requiredString(input.displayName, 'displayName');
    const phoneNumber = Validation.requiredString(input.phoneNumber, 'phoneNumber');
    if (await this.numbers.findOne((n) => n.phoneNumber === phoneNumber)) throw new ApiError(409, 'CONFLICT', 'A number with this phoneNumber already exists.');
    const now = Ids.now();
    const record: WhatsAppNumber = {
      id: Ids.create('number'), displayName, phoneNumber, provider: Validation.requiredString(input.provider, 'provider'),
      providerAccountId: input.providerAccountId || '', wabaId: input.wabaId || '', providerNumberId: input.providerNumberId || '',
      active: input.active !== false, createdAt: now, updatedAt: now,
    };
    await this.numbers.create(record);
    await this.audit.write(actor.id, 'number.created', 'number', record.id, {});
    return record;
  }

  async updateNumber(id: string, patch: Record<string, unknown>): Promise<WhatsAppNumber> {
    const actor = await this.access.require(Permissions.NUMBERS_ADMIN);
    if (!(await this.numbers.get(id))) throw new ApiError(404, 'NOT_FOUND', 'Number was not found.');
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!ALLOWED_UPDATE_FIELDS.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    if (Object.keys(safePatch).length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'At least one permitted field is required.');
    const record = await this.numbers.update(id, safePatch as Partial<WhatsAppNumber>);
    await this.audit.write(actor.id, 'number.updated', 'number', id, {});
    return record;
  }

  async listNumbers(): Promise<WhatsAppNumber[]> {
    await this.access.require(Permissions.NUMBERS_ADMIN);
    return this.numbers.list();
  }
}
