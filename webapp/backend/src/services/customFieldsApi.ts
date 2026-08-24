/**
 * Admin/Supervisor-configurable field definitions for Leads and Customers, plus the shared
 * value-validation helper other services (Phase22Api for leads, Phase8Api for customers) call
 * before merging submitted values onto a record. Definitions are a small, low-write-volume
 * collection of their own; values themselves stay denormalized directly on Lead/Customer
 * (see domain/types.ts), matching the tags precedent rather than a separate per-value table.
 */
import { ApiError } from '../types';
import { Ids, Permissions, Validation } from '../domain/phase1';
import type { CustomFieldDefinition, CustomFieldEntityType, CustomFieldType } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { AppDb } from '../lib/appDb';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

const FIELD_TYPES: readonly CustomFieldType[] = ['text', 'number', 'select', 'date', 'campaign'];
const ENTITY_TYPES: readonly CustomFieldEntityType[] = ['lead', 'customer'];

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export class CustomFieldsApi {
  private access: AccessControl;
  private audit: AuditLogService;
  private definitions: Repository<CustomFieldDefinition>;

  constructor(db: AppDb, identityEmail: string) {
    const repos: Phase1Repositories = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(repos, this.audit, identityEmail);
    this.definitions = new Repository<CustomFieldDefinition>(db, 'customFieldDefinitions');
  }

  /** Any authenticated user can read definitions — needed to render a Lead/Customer's own
   * fields for anyone who can already touch that record, not just the managers who define them. */
  async listDefinitions(entityType?: string): Promise<CustomFieldDefinition[]> {
    await this.access.currentUser();
    const all = await this.definitions.list();
    return all
      .filter((d) => !entityType || d.entityType === entityType)
      .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  async createDefinition(input: { entityType: string; label: string; type: string; options?: unknown }): Promise<CustomFieldDefinition> {
    const actor = await this.access.require(Permissions.CUSTOM_FIELDS_MANAGE);
    const entityType = Validation.enumValue(input.entityType, ENTITY_TYPES, 'entityType');
    const label = Validation.requiredString(input.label, 'label');
    const type = Validation.enumValue(input.type, FIELD_TYPES, 'type');
    const key = slugify(label);
    if (!key) throw new ApiError(400, 'VALIDATION_ERROR', 'label must contain at least one letter or number.');
    if (await this.definitions.findOne((d) => d.entityType === entityType && d.key === key)) {
      throw new ApiError(409, 'CONFLICT', 'A field with this name already exists for this entity type.');
    }
    const options = type === 'select' ? Validation.stringArray(input.options ?? [], 'options').map((o) => o.trim()).filter(Boolean) : [];
    if (type === 'select' && options.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'A dropdown field needs at least one option.');
    const now = Ids.now();
    const sameEntity = (await this.definitions.list()).filter((d) => d.entityType === entityType);
    const record: CustomFieldDefinition = {
      id: Ids.create('customfield'), entityType, key, label, type, options, active: true,
      sequenceOrder: sameEntity.length + 1, createdAt: now, updatedAt: now,
    };
    await this.definitions.create(record);
    await this.audit.write(actor.id, 'customField.created', 'customFieldDefinition', record.id, { entityType, key, type });
    return record;
  }

  /** key/entityType/type are immutable after creation — changing a field's type would orphan
   * already-stored values of the old type, and the key is what those values are keyed by. */
  async updateDefinition(id: string, patch: Record<string, unknown>): Promise<CustomFieldDefinition> {
    const actor = await this.access.require(Permissions.CUSTOM_FIELDS_MANAGE);
    const existing = await this.definitions.get(id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Custom field was not found.');
    const allowed = ['label', 'options', 'active', 'sequenceOrder'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    if (safePatch.label !== undefined) safePatch.label = Validation.requiredString(safePatch.label, 'label');
    if (safePatch.options !== undefined) safePatch.options = Validation.stringArray(safePatch.options, 'options').map((o) => String(o).trim()).filter(Boolean);
    const record = await this.definitions.update(id, safePatch as Partial<CustomFieldDefinition>);
    await this.audit.write(actor.id, 'customField.updated', 'customFieldDefinition', id, { patch: safePatch });
    return record;
  }
}

/**
 * Shared by Phase22Api (leads) and Phase8Api (customers) — validates a submitted values object
 * against the live field definitions for that entity type and returns a clean value map ready
 * to merge onto the record. Rejects unknown/inactive keys (same "fail fast on a stale client"
 * philosophy as updateCustomer's own allowed-fields check) rather than silently dropping them.
 * A blank/null value clears that field instead of being stored as "".
 */
export function validateCustomFieldValues(definitions: CustomFieldDefinition[], entityType: CustomFieldEntityType, values: Record<string, unknown>): Record<string, string | number> {
  const byKey = new Map(definitions.filter((d) => d.entityType === entityType && d.active).map((d) => [d.key, d]));
  const result: Record<string, string | number> = {};
  for (const key of Object.keys(values || {})) {
    const def = byKey.get(key);
    if (!def) throw new ApiError(400, 'VALIDATION_ERROR', `Unknown or inactive custom field: ${key}`);
    const raw = values[key];
    if (raw === '' || raw === null || raw === undefined) continue;
    if (def.type === 'number') {
      const num = Number(raw);
      if (Number.isNaN(num)) throw new ApiError(400, 'VALIDATION_ERROR', `${def.label} must be a number.`);
      result[key] = num;
    } else if (def.type === 'select') {
      if (!def.options.includes(String(raw))) throw new ApiError(400, 'VALIDATION_ERROR', `${def.label} must be one of: ${def.options.join(', ')}.`);
      result[key] = String(raw);
    } else {
      result[key] = String(raw).trim().slice(0, 500);
    }
  }
  return result;
}
