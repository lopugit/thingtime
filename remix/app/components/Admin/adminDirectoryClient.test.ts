import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCompleteAdminSnapshot } from './adminDirectoryClient.ts';

type Row = { id: string; marker?: string };

test('complete admin snapshots drain every cursor page and deduplicate by row id', async () => {
  const pages = new Map<string | undefined, any>([
    [undefined, { ok: true, users: [{ id: '1' }, { id: '2', marker: 'old' }], limit: 2, nextCursor: 'two' }],
    ['two', { ok: true, users: [{ id: '2', marker: 'new' }, { id: '3' }], limit: 2, nextCursor: 'three' }],
    ['three', { ok: true, users: [{ id: '4' }], limit: 2, nextCursor: null }]
  ]);
  const requested: Array<string | undefined> = [];
  const snapshot = await loadCompleteAdminSnapshot<Row>(
    async (cursor) => {
      requested.push(cursor);
      return pages.get(cursor);
    },
    'users',
    (row) => row.id
  );

  assert.deepEqual(requested, [undefined, 'two', 'three']);
  assert.deepEqual(snapshot.rows, [
    { id: '1' },
    { id: '2', marker: 'new' },
    { id: '3' },
    { id: '4' }
  ]);
});

test('complete admin snapshots reject failed, malformed, or repeated cursor pages', async () => {
  await assert.rejects(
    () => loadCompleteAdminSnapshot(async () => ({ ok: false }), 'apps', (row: Row) => row.id),
    /Could not load/
  );

  await assert.rejects(
    () =>
      loadCompleteAdminSnapshot(
        async () => ({ ok: true, apps: [], nextCursor: 'same' }),
        'apps',
        (row: Row) => row.id
      ),
    /repeated cursor/
  );

  await assert.rejects(
    () => loadCompleteAdminSnapshot(async () => ({ ok: true, nextCursor: null }), 'users', (row: Row) => row.id),
    /malformed rows/
  );
  await assert.rejects(
    () => loadCompleteAdminSnapshot(async () => ({ ok: true, users: [] }), 'users', (row: Row) => row.id),
    /malformed cursor/
  );
  await assert.rejects(
    () => loadCompleteAdminSnapshot(async () => ({ ok: true, users: [], nextCursor: 42 }), 'users', (row: Row) => row.id),
    /malformed cursor/
  );
  await assert.rejects(
    () => loadCompleteAdminSnapshot(async () => ({ ok: true, users: [{ id: '' }], nextCursor: null }), 'users', (row: Row) => row.id),
    /without an id/
  );
});

test('complete admin snapshots stop between pages when aborted', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    () =>
      loadCompleteAdminSnapshot<Row>(
        async () => {
          calls += 1;
          controller.abort();
          return { ok: true, users: [{ id: '1' }], nextCursor: 'two' };
        },
        'users',
        (row) => row.id,
        controller.signal
      ),
    (error: any) => error?.name === 'AbortError'
  );
  assert.equal(calls, 1);
});
