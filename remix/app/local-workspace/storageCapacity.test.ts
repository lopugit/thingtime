import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { createQuotaFactory } from './storageTestFixture';

const anonymous = { kind: 'anonymous' } as const;
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate() { return () => {}; } };

test('workspace admission preserves records and bytes beyond the former app-wide budgets', async () => {
  const factory = new IDBFactory(), name = crypto.randomUUID();
  const db = new WorkspaceDatabase(factory, name, 10_000, IDBKeyRange);
  try {
    const value = 'exact 🦄\n'.repeat(150_000), bytes = new Uint8Array(17 * 1024 * 1024).fill(7);
    await db.transaction(anonymous, 'readwrite', lease, async tx => {
      await tx.put('notes', 'large', { value });
      for (let index = 0; index < 4; index++) await tx.putBytes(`file-${index}`, bytes);
      for (let index = 0; index < 10_001; index++) await tx.put('rows', String(index), { index });
    });
    await db.close();
    await db.transaction(anonymous, 'readonly', lease, async tx => {
      assert.deepEqual(await tx.get('notes', 'large'), { value });
      const usage = await tx.usage(); assert.equal(usage.records, 10_006); assert.ok(usage.bytes > 64 * 1024 * 1024);
      assert.equal((await tx.list('rows')).length, 10_001);
      const retained = (await tx.getBytes('file-3'))!;
      assert.equal(retained.length, bytes.length); assert.equal(retained[0], 7); assert.equal(retained.at(-1), 7);
    });
  } finally { await db.close(); }
});

test('actual quota-class storage errors roll back content and accounting, then permit retry', async () => {
  const factory = createQuotaFactory({ bytes: 1024, records: 100 });
  const db = new WorkspaceDatabase(factory, crypto.randomUUID(), 10_000, IDBKeyRange);
  try {
    await db.transaction(anonymous, 'readwrite', lease, tx => tx.put('notes', 'saved', { text: 'Keep this exact version' }));
    const before = await db.transaction(anonymous, 'readonly', lease, tx => tx.usage());
    await assert.rejects(db.transaction(anonymous, 'readwrite', lease, async tx => {
      await tx.put('notes', 'saved', { text: 'Uncommitted replacement' });
      await tx.putBytes('oversize', new Uint8Array(1024));
    }), (error: any) => error.code === 'LOCAL_QUOTA' && error.status === 507 && /browser/.test(error.message));
    await db.transaction(anonymous, 'readonly', lease, async tx => {
      assert.deepEqual(await tx.get('notes', 'saved'), { text: 'Keep this exact version' });
      assert.equal(await tx.getBytes('oversize'), undefined); assert.deepEqual(await tx.usage(), before);
    });
    factory.capacity.bytes = 4096;
    await db.transaction(anonymous, 'readwrite', lease, tx => tx.putBytes('retry', new Uint8Array(1024)));
    assert.equal((await db.transaction(anonymous, 'readonly', lease, tx => tx.getBytes('retry')))!.length, 1024);
  } finally { await db.close(); }
});
