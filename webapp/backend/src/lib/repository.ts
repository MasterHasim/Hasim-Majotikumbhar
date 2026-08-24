/**
 * Same list/get/findOne/create/update/remove/replace/count contract every
 * Apps Script repository (PropertiesRepository, SheetRepository,
 * FirebaseRealtimeDbRepository) conformed to — kept identical here so the
 * ported business logic reads almost line-for-line the same as the source
 * it's ported from.
 *
 * Known simplification vs. the Apps Script build: writes here are a plain
 * read-check-write with no distributed lock (Apps Script used
 * LockService.getScriptLock() — a single script-wide mutex that was
 * discovered mid-migration to be a real bottleneck, see PROGRESS.md). Each
 * Workers request is already an independent, isolated execution rather than
 * competing on one shared lock, and per-collection write concurrency for an
 * internal admin-driven CRM is low, so this is a deliberate, low-risk
 * trade-off rather than a carried-over bug. Worth revisiting with Firebase's
 * conditional-write (ETag) support if write volume ever grows enough to matter.
 */
import { ApiError } from '../types';
import { AppDb } from './appDb';

export interface Record_ {
  id: string;
  [key: string]: unknown;
}

export class Repository<T extends Record_> {
  constructor(private db: AppDb, private collection: string) {}

  async list(): Promise<T[]> {
    return this.db.list<T>(this.collection);
  }

  async get(id: string): Promise<T | null> {
    return this.db.get<T>(`${this.collection}/${id}`);
  }

  async findOne(predicate: (record: T) => boolean): Promise<T | null> {
    const rows = await this.list();
    return rows.find(predicate) ?? null;
  }

  async create(record: T): Promise<T> {
    const existing = await this.get(record.id);
    if (existing) throw new ApiError(409, 'CONFLICT', `${this.collection} record already exists.`);
    await this.db.put(`${this.collection}/${record.id}`, record);
    return record;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const existing = await this.get(id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', `${this.collection} record was not found.`);
    const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() } as T;
    await this.db.put(`${this.collection}/${id}`, updated);
    return updated;
  }

  async remove(id: string): Promise<T> {
    const existing = await this.get(id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', `${this.collection} record was not found.`);
    await this.db.delete(`${this.collection}/${id}`);
    return existing;
  }

  async replace(id: string, record: T): Promise<T> {
    await this.db.put(`${this.collection}/${id}`, record);
    return record;
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }
}
