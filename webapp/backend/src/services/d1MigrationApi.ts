/**
 * Ops tooling for the Firebase RTDB -> D1 migration (see the migration plan / PROGRESS.md) —
 * Phase 4's backfill and parity-verification pieces. ADMIN-only (SETTINGS_MANAGE), same
 * authorization shape as Phase15Api.backupNow. Not exposed anywhere in the UI yet; triggered
 * directly against the API while a collection is being staged for cutover.
 */
import { ApiError } from '../types';
import { Permissions } from '../domain/phase1';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { AppDb } from '../lib/appDb';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { d1Put, d1List } from '../lib/d1Store';

export interface BackfillResult {
  collection: string;
  recordCount: number;
}

export interface ParityReport {
  collection: string;
  firebaseCount: number;
  d1Count: number;
  missingInD1: string[];
  extraInD1: string[];
  mismatched: string[];
}

/** Firebase RTDB silently drops empty arrays/objects on write (see phase1Api.ts's defensive
 * `?? []` code around TeamMember.numberIds), while D1's JSON `data` column faithfully keeps an
 * explicit `[]`/`{}`. Treating "field absent" and "field is empty array/object" as equivalent
 * here is what stops that real semantic difference from producing a stream of false-positive
 * mismatches on every parity check. */
function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 0) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) return undefined;
  return value;
}

function recordsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (JSON.stringify(normalizeForCompare(a[key])) !== JSON.stringify(normalizeForCompare(b[key]))) return false;
  }
  return true;
}

export class D1MigrationApi {
  private access: AccessControl;
  private audit: AuditLogService;

  constructor(private db: AppDb, identityEmail: string, private d1: D1Database | undefined) {
    const repos: Phase1Repositories = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(repos, this.audit, identityEmail);
  }

  private requireD1(): D1Database {
    if (!this.d1) throw new ApiError(400, 'VALIDATION_ERROR', 'No D1 binding configured.');
    return this.d1;
  }

  /** One-time (but idempotent — INSERT OR REPLACE — so safely re-runnable) copy of each named
   * collection's current data from Firebase into D1. Reads through AppDb.list(), so this always
   * sees exactly the same source of truth the app itself reads while that collection is still
   * in 'firebase' or 'dual' mode (both read from Firebase — see appDb.ts). */
  async backfill(collections: string[]): Promise<BackfillResult[]> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    const d1 = this.requireD1();
    const results: BackfillResult[] = [];
    for (const collection of collections) {
      const records = await this.db.list<{ id: string } & Record<string, unknown>>(collection);
      for (const record of records) await d1Put(d1, `${collection}/${record.id}`, record);
      results.push({ collection, recordCount: records.length });
    }
    await this.audit.write(actor.id, 'd1Migration.backfilled', 'd1Migration', collections.join(','), { collections, results });
    return results;
  }

  /** Diffs Firebase (source of truth throughout 'firebase'/'dual' mode) against D1, id by id,
   * per collection — the real evidence a collection's validation window actually passed before
   * it gets cut over to pure 'd1' mode. */
  async verifyParity(collections: string[]): Promise<ParityReport[]> {
    await this.access.require(Permissions.SETTINGS_MANAGE);
    const d1 = this.requireD1();
    const reports: ParityReport[] = [];
    for (const collection of collections) {
      const firebaseRecords = await this.db.list<{ id: string } & Record<string, unknown>>(collection);
      const d1Records = await d1List<{ id: string } & Record<string, unknown>>(d1, collection);
      const fbById = new Map(firebaseRecords.map((r) => [r.id, r]));
      const d1ById = new Map(d1Records.map((r) => [r.id, r]));
      const missingInD1 = [...fbById.keys()].filter((id) => !d1ById.has(id));
      const extraInD1 = [...d1ById.keys()].filter((id) => !fbById.has(id));
      const mismatched = [...fbById.keys()].filter((id) => d1ById.has(id) && !recordsEqual(fbById.get(id)!, d1ById.get(id)!));
      reports.push({ collection, firebaseCount: firebaseRecords.length, d1Count: d1Records.length, missingInD1, extraInD1, mismatched });
    }
    return reports;
  }
}
