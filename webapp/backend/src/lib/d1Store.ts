/**
 * Generic D1-backed read/write functions mirroring FirebaseDb's method surface
 * (get/put/patch/delete/list), driven entirely by the D1_TABLES registry in d1Schema.ts --
 * one implementation shared by all 34 tables instead of a hand-written repository per table.
 *
 * Path convention matches FirebaseDb exactly: "collection/id" (or "collection" alone for a
 * list()). put/patch always recompute every indexed column from the merged record, so a
 * column can never silently drift out of sync with the `data` JSON blob -- there is
 * deliberately no code path that updates a column without also updating data, or vice versa.
 */
import { tableSpecFor, type D1ColumnSpec } from './d1Schema';

export function splitPath(path: string): { collection: string; id: string } {
  const slash = path.indexOf('/');
  if (slash === -1) return { collection: path, id: '' };
  return { collection: path.slice(0, slash), id: path.slice(slash + 1) };
}

function toSqlValue(record: Record<string, unknown>, spec: D1ColumnSpec): unknown {
  const raw = record[spec.field];
  if (raw === undefined || raw === null) return null;
  if (spec.boolean) return raw ? 1 : 0;
  return raw as string | number;
}

function columnsClause(collection: string): { names: string[]; specs: D1ColumnSpec[] } {
  const { columns } = tableSpecFor(collection);
  return { names: columns.map((c) => c.column), specs: columns };
}

export async function d1Get<T>(db: D1Database, path: string): Promise<T | null> {
  const { collection, id } = splitPath(path);
  const row = await db.prepare(`SELECT data FROM ${collection} WHERE id = ?`).bind(id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as T) : null;
}

export async function d1List<T>(db: D1Database, collection: string): Promise<T[]> {
  const { results } = await db.prepare(`SELECT data FROM ${collection}`).all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as T);
}

export async function d1Count(db: D1Database, collection: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${collection}`).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Full upsert -- used for both create and replace/update, since D1 has no separate "patch a
 * few fields" primitive worth using here: Repository.update() already does get+merge in JS
 * before calling put, so by the time a write reaches here it's always the complete record. */
export async function d1Put<T extends Record<string, unknown>>(db: D1Database, path: string, data: T): Promise<void> {
  const { collection, id } = splitPath(path);
  const { names, specs } = columnsClause(collection);
  const columnList = ['id', 'data', ...names];
  const placeholders = columnList.map(() => '?').join(', ');
  const values: unknown[] = [id, JSON.stringify(data), ...specs.map((s) => toSqlValue(data, s))];
  await db.prepare(`INSERT OR REPLACE INTO ${collection} (${columnList.join(', ')}) VALUES (${placeholders})`).bind(...values).run();
}

/** Firebase's PATCH is a real partial merge server-side; nothing in this codebase calls
 * FirebaseDb.patch() directly today (Repository.update() does its own JS-side merge then
 * calls put), but this stays a real, distinct implementation -- not just an alias for
 * d1Put -- so AppDb's method surface genuinely matches FirebaseDb's, not just today's usage. */
export async function d1Patch<T extends Record<string, unknown>>(db: D1Database, path: string, patch: Partial<T>): Promise<T> {
  const existing = await d1Get<T>(db, path);
  const merged = { ...(existing ?? {}), ...patch } as T;
  await d1Put(db, path, merged);
  return merged;
}

export async function d1Delete(db: D1Database, path: string): Promise<void> {
  const { collection, id } = splitPath(path);
  await db.prepare(`DELETE FROM ${collection} WHERE id = ?`).bind(id).run();
}
