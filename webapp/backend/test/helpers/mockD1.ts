/**
 * In-memory fake implementing exactly the D1Database/D1PreparedStatement surface d1Store.ts
 * actually uses (prepare/bind/first/all/run) -- same "faithfully replicate just the real usage,
 * not the whole API surface" spirit as mockFirebase.ts. Real Miniflare D1 emulation would catch
 * genuine SQLite quirks this can't (type coercion, UNIQUE constraint errors, etc.) -- that's
 * optional future hardening, not required for the migration itself (see the D1 migration plan).
 *
 * Parses the small, fixed set of SQL shapes d1Store.ts issues (SELECT by id, SELECT all,
 * COUNT(*), INSERT OR REPLACE, DELETE by id) via regex rather than a real SQL engine -- this
 * mock only needs to understand queries this codebase actually generates.
 */
import { D1_TABLES } from '../../src/lib/d1Schema';

type Row = Record<string, unknown>;

class MockD1PreparedStatement {
  private params: unknown[] = [];
  constructor(private tables: Map<string, Map<string, Row>>, private sql: string) {}

  bind(...params: unknown[]): MockD1PreparedStatement {
    const next = new MockD1PreparedStatement(this.tables, this.sql);
    next.params = params;
    return next;
  }

  private table(): Map<string, Row> {
    const match = this.sql.match(/FROM\s+(\w+)/i) ?? this.sql.match(/INTO\s+(\w+)/i);
    const name = match?.[1];
    if (!name) throw new Error(`mockD1: could not find table name in SQL: ${this.sql}`);
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (/^SELECT COUNT\(\*\)/i.test(this.sql.trim())) {
      return { n: this.table().size } as unknown as T;
    }
    if (/WHERE id = \?/i.test(this.sql)) {
      const row = this.table().get(this.params[0] as string);
      return row ? ({ data: row.data as string } as unknown as T) : null;
    }
    throw new Error(`mockD1: first() unsupported SQL: ${this.sql}`);
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const rows = [...this.table().values()].map((r) => ({ data: r.data as string }) as unknown as T);
    return { results: rows };
  }

  async run(): Promise<{ success: boolean }> {
    if (/^INSERT OR REPLACE/i.test(this.sql.trim())) {
      const columnsMatch = this.sql.match(/\(([^)]+)\)\s+VALUES/i);
      const columns = columnsMatch![1]!.split(',').map((c) => c.trim());
      const row: Row = {};
      columns.forEach((col, i) => { row[col] = this.params[i]; });
      this.table().set(row.id as string, row);
      return { success: true };
    }
    if (/^DELETE FROM/i.test(this.sql.trim())) {
      this.table().delete(this.params[0] as string);
      return { success: true };
    }
    throw new Error(`mockD1: run() unsupported SQL: ${this.sql}`);
  }
}

export interface MockD1Context {
  db: D1Database;
  /** Direct access to the in-memory tables, for assertions (e.g. checking an indexed column's
   * real value, not just the JSON blob) — mirrors mockFirebase.ts's exposed `store`. */
  tables: Map<string, Map<string, Row>>;
}

export function setupMockD1(): MockD1Context {
  const tables = new Map<string, Map<string, Row>>();
  for (const name of Object.keys(D1_TABLES)) tables.set(name, new Map());

  const db = {
    prepare: (sql: string) => new MockD1PreparedStatement(tables, sql),
  } as unknown as D1Database;

  return { db, tables };
}
