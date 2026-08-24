import { describe, expect, it } from 'vitest';
import { setupMockD1 } from './helpers/mockD1';
import { AppDb } from '../src/lib/appDb';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Repository, type Record_ } from '../src/lib/repository';
import { D1_TABLES } from '../src/lib/d1Schema';

// AppDb needs a FirebaseDb instance even when every collection under test is in 'd1' mode
// (it's never actually called for a 'd1'-mode collection except the `get('')` whole-db-export
// special case, which these tests don't exercise) -- a throwaway instance pointed at an unused
// URL is enough, same reasoning as mockFirebase.ts's disposable service account.
const unusedFirebase = new FirebaseDb({ client_email: 'unused@test', private_key: 'unused', project_id: 'unused' }, 'https://unused.example.test');

interface TestLead extends Record_ {
  phone: string;
  location: string;
  status: string;
  assignedUserId?: string;
  name: string;
}

interface TestSettings extends Record_ {
  enabled: boolean;
  updatedAt: string;
}

function d1Db(collections: string[]) {
  const { db, tables } = setupMockD1();
  const modes = Object.fromEntries(collections.map((c) => [c, 'd1' as const]));
  return { app: new AppDb(unusedFirebase, db, modes), tables };
}

describe('D1-backed Repository<T> (AppDb in \'d1\' mode against mockD1) -- migration plan Phase 2/3', () => {
  it('create/get/list round-trip a full record through JSON, and populate every indexed column', async () => {
    const { app, tables } = d1Db(['leads']);
    const repo = new Repository<TestLead>(app, 'leads');
    const lead: TestLead = { id: 'lead-1', phone: '+919876543210', location: 'Raipur', status: 'NEW', name: 'Priya' };

    const created = await repo.create(lead);
    expect(created).toEqual(lead);

    const fetched = await repo.get('lead-1');
    expect(fetched).toEqual(lead);

    const listed = await repo.list();
    expect(listed).toEqual([lead]);

    // Real SQL columns, not just the JSON blob -- this is the actual point of D1 over RTDB.
    const row = tables.get('leads')!.get('lead-1')!;
    expect(row.phone).toBe('+919876543210');
    expect(row.location).toBe('Raipur');
    expect(row.status).toBe('NEW');
  });

  it('create rejects a duplicate id with 409, matching Firebase-backed Repository exactly', async () => {
    const { app } = d1Db(['leads']);
    const repo = new Repository<TestLead>(app, 'leads');
    const lead: TestLead = { id: 'lead-1', phone: '+919876543210', location: 'Raipur', status: 'NEW', name: 'Priya' };
    await repo.create(lead);
    await expect(repo.create(lead)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('update merges a patch, bumps updatedAt, and recomputes indexed columns from the merged record', async () => {
    const { app, tables } = d1Db(['leads']);
    const repo = new Repository<TestLead>(app, 'leads');
    await repo.create({ id: 'lead-1', phone: '+919876543210', location: 'Raipur', status: 'NEW', name: 'Priya' });

    const updated = await repo.update('lead-1', { status: 'ASSIGNED', assignedUserId: 'user-1' });
    expect(updated.status).toBe('ASSIGNED');
    expect(updated.assignedUserId).toBe('user-1');
    expect(updated.phone).toBe('+919876543210'); // untouched fields preserved
    expect(typeof updated.updatedAt).toBe('string');

    const row = tables.get('leads')!.get('lead-1')!;
    expect(row.status).toBe('ASSIGNED');
  });

  it('update on a missing id throws 404, matching Firebase-backed Repository exactly', async () => {
    const { app } = d1Db(['leads']);
    const repo = new Repository<TestLead>(app, 'leads');
    await expect(repo.update('does-not-exist', { status: 'NEW' })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('remove deletes the row and returns the removed record; a second remove 404s', async () => {
    const { app, tables } = d1Db(['leads']);
    const repo = new Repository<TestLead>(app, 'leads');
    const lead: TestLead = { id: 'lead-1', phone: '+919876543210', location: 'Raipur', status: 'NEW', name: 'Priya' };
    await repo.create(lead);

    const removed = await repo.remove('lead-1');
    expect(removed).toEqual(lead);
    expect(tables.get('leads')!.has('lead-1')).toBe(false);
    await expect(repo.remove('lead-1')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('count matches list().length across a batch of records', async () => {
    const { app } = d1Db(['leads']);
    const repo = new Repository<TestLead>(app, 'leads');
    for (let i = 0; i < 5; i++) {
      await repo.create({ id: `lead-${i}`, phone: `+9198765${i}`, location: 'Raipur', status: 'NEW', name: `Lead ${i}` });
    }
    expect(await repo.count()).toBe(5);
    expect((await repo.list()).length).toBe(5);
  });

  it('findOne filters the full in-memory list by an arbitrary predicate, same as Firebase-backed Repository', async () => {
    const { app } = d1Db(['leads']);
    const repo = new Repository<TestLead>(app, 'leads');
    await repo.create({ id: 'lead-1', phone: '+91100', location: 'Raipur', status: 'NEW', name: 'A' });
    await repo.create({ id: 'lead-2', phone: '+91200', location: 'Coimbatore', status: 'NEW', name: 'B' });

    const found = await repo.findOne((l) => l.location === 'Coimbatore');
    expect(found?.id).toBe('lead-2');
    expect(await repo.findOne((l) => l.location === 'Alibaug')).toBeNull();
  });

  it('a singleton, zero-indexed-column table (autoDialerSettings) works with the same generic mechanism', async () => {
    const { app } = d1Db(['autoDialerSettings']);
    const repo = new Repository<TestSettings>(app, 'autoDialerSettings');
    await repo.create({ id: 'default', enabled: true, updatedAt: '2026-08-24T00:00:00.000Z' });
    const fetched = await repo.get('default');
    expect(fetched?.enabled).toBe(true);

    const replaced = await repo.replace('default', { id: 'default', enabled: false, updatedAt: '2026-08-25T00:00:00.000Z' });
    expect(replaced.enabled).toBe(false);
    expect((await repo.get('default'))?.enabled).toBe(false);
  });

  it('every collection in D1_TABLES round-trips a minimal record without throwing (schema-driven, not hand-coded per table)', async () => {
    for (const collection of Object.keys(D1_TABLES)) {
      const { app } = d1Db([collection]);
      const repo = new Repository<Record_>(app, collection);
      const record: Record_ = { id: 'smoke-1' };
      await repo.create(record);
      expect(await repo.get('smoke-1')).toEqual(record);
    }
  });
});
