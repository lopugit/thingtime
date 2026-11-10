import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_SNAPSHOT_MAX_QUERY_CHARS,
  InvalidAdminSnapshotCursorError,
  adminSnapshotAfterFilter,
  adminSnapshotCursorKey,
  adminSnapshotExcludingIdFilter,
  consumeAdminSnapshotNewest,
  createLiveSessionClause,
  decodeAdminSnapshotCursor,
  encodeAdminSnapshotCursor,
  mergeAdminSnapshotNewest,
  normalizeAdminSnapshotLimit,
  normalizeAdminSnapshotQuery,
  requireAdminSnapshotCursorKey
} from './adminSnapshot.ts';

test('admin snapshot limits clamp to the requested hard boundary', () => {
  assert.equal(normalizeAdminSnapshotLimit(undefined, 20), 20);
  assert.equal(normalizeAdminSnapshotLimit('not-a-number', 100), 100);
  assert.equal(normalizeAdminSnapshotLimit(0, 20), 1);
  assert.equal(normalizeAdminSnapshotLimit(27.9, 20), 27);
  assert.equal(normalizeAdminSnapshotLimit(999, 20), 200);
  assert.equal(normalizeAdminSnapshotLimit(999, 20, 201), 201);
});

test('admin snapshot queries are trimmed and bounded before regex compilation', () => {
  assert.equal(normalizeAdminSnapshotQuery('  rainbow  '), 'rainbow');
  assert.equal(normalizeAdminSnapshotQuery(null), '');
  assert.equal(normalizeAdminSnapshotQuery('x'.repeat(300)).length, ADMIN_SNAPSHOT_MAX_QUERY_CHARS);
});

test('live-session clauses use the request-time cutoff supplied by the caller', () => {
  const firstNow = new Date('2026-08-05T00:00:00.000Z');
  const secondNow = new Date('2026-08-06T00:00:00.000Z');

  const first = createLiveSessionClause(firstNow);
  const second = createLiveSessionClause(secondNow);

  assert.equal(first.$or[1].expiresAt.$gt, firstNow);
  assert.equal(second.$or[1].expiresAt.$gt, secondNow);
  assert.notStrictEqual(first.$or[1].expiresAt.$gt, second.$or[1].expiresAt.$gt);
});

test('admin snapshot merge is newest-first, stable, and keeps things-era twins', () => {
  const things = [
    { _id: 'b', createdAt: new Date('2026-01-02T00:00:00.000Z'), source: 'things' },
    { _id: 'a', createdAt: new Date('2026-01-02T00:00:00.000Z'), source: 'things' }
  ];
  const legacy = [
    { _id: 'a', createdAt: new Date('2026-01-03T00:00:00.000Z'), source: 'legacy-twin' },
    { _id: 'c', createdAt: new Date('2026-01-01T00:00:00.000Z'), source: 'legacy' },
    { _id: 'missing-date', source: 'legacy' }
  ];

  const rows = mergeAdminSnapshotNewest(things, legacy, 10);
  assert.deepEqual(
    rows.map((row) => [row._id, row.source]),
    [
      ['a', 'things'],
      ['b', 'things'],
      ['c', 'legacy'],
      ['missing-date', 'legacy']
    ]
  );
  assert.deepEqual(
    mergeAdminSnapshotNewest(things, legacy, 2).map((row) => row._id),
    ['a', 'b']
  );
});

test('admin cursors round-trip bounded opaque state and reject malformed input', () => {
  const state = {
    v: 1,
    kind: 'apps',
    q: 'rainbow',
    key: { createdAt: '2026-08-05T00:00:00.000Z', id: 'ttapp_123' }
  };
  const encoded = encodeAdminSnapshotCursor(state);
  assert.deepEqual(decodeAdminSnapshotCursor(encoded), state);
  assert.throws(() => decodeAdminSnapshotCursor('not-json'), InvalidAdminSnapshotCursorError);
  assert.throws(
    () => requireAdminSnapshotCursorKey({ createdAt: 'not-a-date', id: 'ttapp_123' }),
    InvalidAdminSnapshotCursorError
  );
});

test('cursor keys normalize valid timestamps and missing dates', () => {
  assert.deepEqual(
    adminSnapshotCursorKey({ shareId: 'new', createdAt: new Date('2026-08-05T01:02:03.000Z') }),
    { createdAt: '2026-08-05T01:02:03.000Z', id: 'new' }
  );
  assert.deepEqual(adminSnapshotCursorKey({ _id: 'legacy' }), { createdAt: null, id: 'legacy' });
});

test('cursor keys prefer a Thing shareId over its physical Mongo id', () => {
  assert.deepEqual(
    adminSnapshotCursorKey({
      _id: 'physical-mongo-id',
      shareId: 'stable-share-id',
      createdAt: new Date('2026-08-05T00:00:00.000Z')
    }),
    { createdAt: '2026-08-05T00:00:00.000Z', id: 'stable-share-id' }
  );
});

test('keyset continuation covers timestamp ties and the missing-date tail', () => {
  const dated = adminSnapshotAfterFilter(
    { createdAt: '2026-08-05T00:00:00.000Z', id: 'b' },
    'shareId'
  );
  assert.deepEqual(dated, {
    $or: [
      { createdAt: { $lt: new Date('2026-08-05T00:00:00.000Z') } },
      { createdAt: new Date('2026-08-05T00:00:00.000Z'), shareId: { $gt: 'b' } },
      { createdAt: null }
    ]
  });
  assert.deepEqual(adminSnapshotAfterFilter({ createdAt: null, id: 'b' }, 'shareId'), {
    createdAt: null,
    shareId: { $gt: 'b' }
  });
});

test('multi-source paging stays globally newest-first and advances only consumed rows', () => {
  type Row = { shareId?: string; _id?: string; createdAt: Date };
  const things: Row[] = [
    { shareId: 'thing-newest', createdAt: new Date('2026-08-05T05:00:00.000Z') },
    { shareId: 'thing-newer', createdAt: new Date('2026-08-05T04:00:00.000Z') }
  ];
  const legacy: Row[] = [
    { _id: 'legacy-older', createdAt: new Date('2026-08-05T03:00:00.000Z') },
    { _id: 'legacy-oldest', createdAt: new Date('2026-08-05T02:00:00.000Z') }
  ];

  const page = consumeAdminSnapshotNewest(
    [
      { records: things, hasMore: true },
      { records: legacy, hasMore: true }
    ],
    2
  );

  assert.deepEqual(page.records.map((row) => row.shareId ?? row._id), ['thing-newest', 'thing-newer']);
  assert.deepEqual(page.consumed, [2, 0]);
});

test('multi-source paging stops at an unseen lookahead boundary after consuming a hidden twin', () => {
  const page = consumeAdminSnapshotNewest(
    [
      {
        records: [{ shareId: 'thing-older', createdAt: new Date('2026-08-05T01:00:00.000Z') }],
        hasMore: false
      },
      {
        records: [{ _id: 'legacy-twin', createdAt: new Date('2026-08-05T03:00:00.000Z') }],
        hasMore: true
      }
    ],
    2,
    (_row, sourceIndex) => sourceIndex !== 1
  );

  // The hidden twin is safe to advance. The older Things row is not: the next
  // unseen legacy row may still sort ahead of it, so it belongs to a later page.
  assert.deepEqual(page.records, []);
  assert.deepEqual(page.consumed, [0, 1]);
});

test('exact-match ids are excluded from the ordinary source scan while pending or consumed', () => {
  const base = { thingtime: 'user', $or: [{ 'crystal.username': /person/i }] };
  assert.deepEqual(adminSnapshotExcludingIdFilter(base, 'shareId', 'user-exact'), {
    $and: [base, { shareId: { $ne: 'user-exact' } }]
  });
  assert.strictEqual(adminSnapshotExcludingIdFilter(base, 'shareId', null), base);

  const page = consumeAdminSnapshotNewest(
    [
      {
        records: [{ shareId: 'user-exact', createdAt: new Date('2026-08-05T02:00:00.000Z') }],
        hasMore: false
      },
      {
        // Production's DB filter removes user-exact from this source.
        records: [{ shareId: 'user-other', createdAt: new Date('2026-08-05T03:00:00.000Z') }],
        hasMore: false
      }
    ],
    10
  );
  assert.deepEqual(page.records.map((row) => row.shareId), ['user-other', 'user-exact']);
});
