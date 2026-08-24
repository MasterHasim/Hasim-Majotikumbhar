/**
 * The data-layer entry point every service actually depends on (Repository<T> is constructed
 * with an AppDb, not a raw FirebaseDb) -- matches FirebaseDb's exact method surface
 * (get/put/patch/delete/list + serviceAccount/databaseUrl passthrough) so repository.ts and
 * every service constructor needed only a type-annotation swap, not a rewrite.
 *
 * Holds a real FirebaseDb permanently (needed forever for the realtime-ping slice and for
 * mintCustomToken/RealtimeListenApi, regardless of any collection's data-backend mode) plus an
 * optional D1 binding, and a per-collection mode: 'firebase' (default, today's behavior,
 * passthrough), 'dual' (write Firebase first -- authoritative for the response the caller
 * gets -- then best-effort fan out to D1, swallowing D1 failures so they can never affect a
 * real request), or 'd1' (D1 only, post-cutover for that collection). See the D1 migration
 * plan for the full phased rollout this exists to support.
 */
import { FirebaseDb, type FirebaseServiceAccount } from './firebaseAdmin';
import { d1Get, d1List, d1Put, d1Patch, d1Delete, splitPath } from './d1Store';

export type DataBackendMode = 'firebase' | 'dual' | 'd1';

function logD1Failure(op: string, path: string, err: unknown): void {
  // Dual-write must never affect the real (Firebase) response -- this is the one place a D1
  // failure is allowed to happen silently from the caller's perspective, logged for the
  // verifyD1Parity comparison job to catch instead.
  console.error(`AppDb: dual-write D1 ${op} failed for '${path}'`, err);
}

export class AppDb {
  constructor(
    private firebase: FirebaseDb,
    private d1: D1Database | undefined,
    /** Per-collection override; any collection absent from this map defaults to 'firebase' --
     * the safe, zero-behavior-change default for a collection nobody has explicitly cut over yet. */
    private modes: Record<string, DataBackendMode> = {},
  ) {}

  get serviceAccount(): FirebaseServiceAccount { return this.firebase.serviceAccount; }
  get databaseUrl(): string { return this.firebase.databaseUrl; }

  private modeFor(collection: string): DataBackendMode {
    return this.modes[collection] ?? 'firebase';
  }

  private requireD1(): D1Database {
    if (!this.d1) throw new Error('AppDb: a collection is configured for D1/dual mode but no D1 binding was provided.');
    return this.d1;
  }

  async get<T>(path: string): Promise<T | null> {
    const { collection } = splitPath(path);
    // The whole-database export (Phase15Api.backupNow's `this.db.get('')`) has no D1
    // equivalent yet -- always Firebase for now. Revisit once any collection reaches pure
    // 'd1' mode (see the migration plan's Phase 6 "Firebase footprint reduction").
    if (collection === '') return this.firebase.get<T>(path);
    if (this.modeFor(collection) === 'd1') return d1Get<T>(this.requireD1(), path);
    return this.firebase.get<T>(path);
  }

  async put<T extends Record<string, unknown>>(path: string, data: T): Promise<T> {
    const { collection } = splitPath(path);
    const mode = this.modeFor(collection);
    if (mode === 'firebase') return this.firebase.put<T>(path, data);
    if (mode === 'dual') {
      const result = await this.firebase.put<T>(path, data);
      try { await d1Put(this.requireD1(), path, data); } catch (err) { logD1Failure('put', path, err); }
      return result;
    }
    await d1Put(this.requireD1(), path, data);
    return data;
  }

  async patch<T extends Record<string, unknown>>(path: string, data: Partial<T>): Promise<T> {
    const { collection } = splitPath(path);
    const mode = this.modeFor(collection);
    if (mode === 'firebase') return this.firebase.patch<T>(path, data);
    if (mode === 'dual') {
      const result = await this.firebase.patch<T>(path, data);
      try { await d1Patch<T>(this.requireD1(), path, data); } catch (err) { logD1Failure('patch', path, err); }
      return result;
    }
    return d1Patch<T>(this.requireD1(), path, data);
  }

  async delete(path: string): Promise<null> {
    const { collection } = splitPath(path);
    const mode = this.modeFor(collection);
    if (mode === 'firebase') return this.firebase.delete(path);
    if (mode === 'dual') {
      const result = await this.firebase.delete(path);
      try { await d1Delete(this.requireD1(), path); } catch (err) { logD1Failure('delete', path, err); }
      return result;
    }
    await d1Delete(this.requireD1(), path);
    return null;
  }

  async list<T>(collection: string): Promise<T[]> {
    if (this.modeFor(collection) === 'd1') return d1List<T>(this.requireD1(), collection);
    return this.firebase.list<T>(collection);
  }
}

/** Single construction point for every route that builds a database handle (buildContext plus
 * the 3 webhook routes that bypass it, since webhooks authenticate via a shared-secret token
 * rather than a Firebase ID token and so build their own db directly) -- keeps mode-map
 * parsing in exactly one place. DATA_BACKEND_MODES is an optional JSON env var,
 * `{"collectionName": "firebase"|"dual"|"d1", ...}`; a collection absent from it defaults to
 * 'firebase', so an empty/unset var is the zero-behavior-change default. */
export function buildAppDb(serviceAccount: FirebaseServiceAccount, databaseUrl: string, env: { DB?: D1Database; DATA_BACKEND_MODES?: string }): AppDb {
  const firebase = new FirebaseDb(serviceAccount, databaseUrl);
  const modes = env.DATA_BACKEND_MODES ? (JSON.parse(env.DATA_BACKEND_MODES) as Record<string, DataBackendMode>) : {};
  return new AppDb(firebase, env.DB, modes);
}
