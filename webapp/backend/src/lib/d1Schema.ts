/**
 * Single source of truth for the D1 schema — one entry per Firebase collection this backend
 * uses (see `Repository`'s `collection` argument at every `new Repository<T>(db, '...')` call
 * site). Each collection's table has `id TEXT PRIMARY KEY` + `data TEXT NOT NULL` (the full
 * record as JSON — round-trips exactly what Firebase stored) plus real typed columns only for
 * fields something actually filters/sorts on today (see each service's `.filter()`/`.find()`/
 * `.findOne()` predicates). Everything else — arrays, nested objects, rarely-queried fields —
 * stays JSON-only inside `data`.
 *
 * This registry drives three things that must never drift out of sync with each other:
 * migrations/0001_init.sql (the actual CREATE TABLE statements — kept hand-written but
 * structurally mirroring this file), d1Store.ts (recomputes every indexed column from the
 * merged record on every write), and the future backfill/parity scripts.
 *
 * Column naming: camelCase record field -> snake_case SQL column, mechanical and reversible.
 * Booleans are stored as INTEGER (0/1) -- SQLite has no native boolean type.
 */

export type D1ColumnType = 'TEXT' | 'INTEGER' | 'REAL';

export interface D1ColumnSpec {
  /** The record field this column mirrors (dot-path not supported -- top-level fields only). */
  field: string;
  column: string;
  type: D1ColumnType;
  /** true for boolean record fields -- stored as INTEGER 0/1, converted on read/write. */
  boolean?: boolean;
}

export interface D1TableSpec {
  table: string;
  columns: D1ColumnSpec[];
}

function col(field: string, column: string, type: D1ColumnType = 'TEXT', boolean = false): D1ColumnSpec {
  return { field, column, type, boolean };
}

/** Every collection this backend's Repository<T> instances are constructed against. Keep this
 * list in sync with `grep -roh "new Repository<[^,]*,\s*'[a-zA-Z_]*'" src` -- see PROGRESS.md /
 * the D1 migration plan for how this list was derived. */
export const D1_TABLES: Record<string, D1TableSpec> = {
  users: { table: 'users', columns: [col('email', 'email'), col('status', 'status')] },
  roles: { table: 'roles', columns: [col('key', 'key'), col('status', 'status')] },
  teams: { table: 'teams', columns: [col('ownerUserId', 'owner_user_id'), col('status', 'status')] },
  teamMembers: { table: 'teamMembers', columns: [col('teamId', 'team_id'), col('userId', 'user_id'), col('status', 'status')] },
  numberAccess: { table: 'numberAccess', columns: [col('userId', 'user_id'), col('numberId', 'number_id'), col('status', 'status'), col('granted', 'granted', 'INTEGER', true)] },
  availability: { table: 'availability', columns: [col('userId', 'user_id'), col('status', 'status')] },
  assignmentEligibility: { table: 'assignmentEligibility', columns: [col('userId', 'user_id'), col('numberId', 'number_id'), col('teamId', 'team_id'), col('eligible', 'eligible', 'INTEGER', true)] },

  numbers: { table: 'numbers', columns: [col('phoneNumber', 'phone_number'), col('wabaId', 'waba_id'), col('active', 'active', 'INTEGER', true)] },
  customers: { table: 'customers', columns: [col('phone', 'phone'), col('name', 'name')] },
  webapp_conversations: {
    table: 'webapp_conversations',
    columns: [
      col('customerId', 'customer_id'), col('numberId', 'number_id'), col('assignedUserId', 'assigned_user_id'),
      col('status', 'status'), col('needsResponse', 'needs_response', 'INTEGER', true), col('lastMessageAt', 'last_message_at'),
    ],
  },
  webapp_messages: {
    table: 'webapp_messages',
    columns: [
      col('conversationId', 'conversation_id'), col('numberId', 'number_id'), col('providerMessageId', 'provider_message_id'),
      col('status', 'status'), col('direction', 'direction'), col('timestamp', 'timestamp'),
    ],
  },

  assignments: { table: 'assignments', columns: [col('conversationId', 'conversation_id'), col('userId', 'user_id')] },
  numberAssignmentConfig: { table: 'numberAssignmentConfig', columns: [col('numberId', 'number_id')] },
  numberAssignmentUsers: { table: 'numberAssignmentUsers', columns: [col('numberId', 'number_id'), col('userId', 'user_id'), col('sequenceOrder', 'sequence_order', 'INTEGER'), col('active', 'active', 'INTEGER', true)] },
  stages: { table: 'stages', columns: [col('key', 'key'), col('active', 'active', 'INTEGER', true), col('sequenceOrder', 'sequence_order', 'INTEGER')] },
  customerStages: { table: 'customerStages', columns: [col('customerId', 'customer_id'), col('stageId', 'stage_id')] },
  remarks: { table: 'remarks', columns: [col('conversationId', 'conversation_id'), col('createdAt', 'created_at')] },
  reminders: {
    table: 'reminders',
    columns: [
      col('conversationId', 'conversation_id'), col('leadId', 'lead_id'), col('ownerUserId', 'owner_user_id'),
      col('status', 'status'), col('dueAt', 'due_at'),
    ],
  },
  conversationSnoozes: { table: 'conversationSnoozes', columns: [col('conversationId', 'conversation_id'), col('snoozedUntil', 'snoozed_until')] },

  templates: { table: 'templates', columns: [col('wabaId', 'waba_id'), col('providerTemplateId', 'provider_template_id'), col('name', 'name'), col('status', 'status')] },
  quickReplies: { table: 'quickReplies', columns: [col('shortcut', 'shortcut'), col('active', 'active', 'INTEGER', true)] },
  messageMedia: { table: 'messageMedia', columns: [col('messageId', 'message_id')] },

  leads: {
    table: 'leads',
    columns: [
      col('phone', 'phone'), col('location', 'location'), col('status', 'status'),
      col('assignedUserId', 'assigned_user_id'), col('stageId', 'stage_id'), col('createdAt', 'created_at'),
    ],
  },
  customFieldDefinitions: { table: 'customFieldDefinitions', columns: [col('entityType', 'entity_type'), col('key', 'key'), col('active', 'active', 'INTEGER', true), col('sequenceOrder', 'sequence_order', 'INTEGER')] },
  adAccounts: { table: 'adAccounts', columns: [col('platform', 'platform'), col('externalAccountId', 'external_account_id'), col('active', 'active', 'INTEGER', true)] },

  locationAssignmentConfig: { table: 'locationAssignmentConfig', columns: [col('location', 'location')] },
  locationAssignmentUsers: { table: 'locationAssignmentUsers', columns: [col('location', 'location'), col('userId', 'user_id'), col('sequenceOrder', 'sequence_order', 'INTEGER'), col('active', 'active', 'INTEGER', true)] },
  callLog: {
    table: 'callLog',
    columns: [
      col('leadId', 'lead_id'), col('agentUserId', 'agent_user_id'), col('exotelCallSid', 'exotel_call_sid'),
      col('conversationId', 'conversation_id'), col('numberId', 'number_id'), col('status', 'status'), col('leadPhone', 'lead_phone'),
    ],
  },
  autoDialerSettings: { table: 'autoDialerSettings', columns: [] },
  leadStageAssignments: { table: 'leadStageAssignments', columns: [col('leadId', 'lead_id'), col('stageId', 'stage_id')] },
  leadRemarks: { table: 'leadRemarks', columns: [col('leadId', 'lead_id'), col('createdAt', 'created_at')] },

  products: { table: 'products', columns: [col('numberId', 'number_id'), col('active', 'active', 'INTEGER', true), col('sequenceOrder', 'sequence_order', 'INTEGER')] },
  quotations: { table: 'quotations', columns: [col('leadId', 'lead_id'), col('numberId', 'number_id'), col('status', 'status')] },

  auditLog: { table: 'auditLog', columns: [col('occurredAt', 'occurred_at'), col('actorUserId', 'actor_user_id'), col('action', 'action'), col('targetType', 'target_type'), col('targetId', 'target_id')] },
};

export function tableSpecFor(collection: string): D1TableSpec {
  const spec = D1_TABLES[collection];
  if (!spec) throw new Error(`No D1 table registered for collection '${collection}' -- add it to D1_TABLES in d1Schema.ts.`);
  return spec;
}
