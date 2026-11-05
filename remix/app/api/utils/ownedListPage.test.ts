import assert from 'node:assert/strict';
import test from 'node:test';
import { ownedListPage, OWNED_LIST_PAGE_SIZE, OWNED_LIST_QUERY_TIMEOUT_MS } from './ownedListPage';
const matches = (doc: any, filter: any): boolean => Object.entries(filter).every(([key, value]: [string, any]) => {
  if (key === '$or') return value.some((part: any) => matches(doc, part));
  const actual = doc[key];
  if (value instanceof Date) return +actual === +value;
  if (value && typeof value === 'object') return Object.entries(value).every(([op, target]: [string, any]) =>
    op === '$in' ? target.includes(actual) : op === '$gt' ? actual > target : op === '$lt' ? actual < target : false);
  return Array.isArray(actual) ? actual.includes(value) : actual === value;
});
const fixtureCollection = (docs: any[], reads: any[] = []) => ({
  find(filter: any, options: any) {
    assert.equal(options.maxTimeMS, OWNED_LIST_QUERY_TIMEOUT_MS);
    let sort: any = {}, limit = Infinity;
    const cursor = {
      sort(order: any) { sort = order; return cursor; },
      limit(count: number) { assert.ok(count <= OWNED_LIST_PAGE_SIZE); limit = count; return cursor; },
      project(_projection: any) { return cursor; },
      async toArray() {
        reads.push({ filter, limit });
        return docs.filter(doc => matches(doc, filter)).sort((a, b) => {
          for (const [key, direction] of Object.entries(sort)) {
            if (a[key] < b[key]) return -Number(direction);
            if (a[key] > b[key]) return Number(direction);
          }
          return 0;
        }).slice(0, limit);
      }
    };
    return cursor;
  }
});
const row = (shareId: string, ordinal: number, ownerId = 'owner') => ({ shareId, ownerId,
  createdAt: new Date(1_700_000_000_000 + ordinal), updatedAt: new Date(1_700_000_000_000 + ordinal) });
for (const purpose of ['themes', 'algorithms'] as const) test(`${purpose}: exhaustive bounded pages, ties, stale twins and owner scope`, async () => {
  const kind = purpose === 'themes' ? 'theme' : 'feed-algorithm', field = purpose === 'themes' ? 'updatedAt' : 'createdAt', direction = purpose === 'themes' ? -1 : 1;
  const modern = Array.from({ length: 155 }, (_, index) => ({ ...row('modern-' + String(index).padStart(3, '0'), Math.floor(index / 3)), thingtime: [kind] }));
  const legacy = Array.from({ length: 139 }, (_, index) => row('legacy-' + String(index).padStart(3, '0'), Math.floor(index / 3)));
  for (let index = 0; index < modern.length; index++) legacy.push({ ...modern[index], updatedAt: new Date(1_700_000_000_000 + (index % 2 ? -1000 : 1000)), createdAt: new Date(1_700_000_000_000 + (index % 2 ? -1000 : 1000)) });
  modern.push({ ...row('foreign-modern', 10, 'other'), thingtime: [kind] });
  legacy.push(row('foreign-legacy', 10, 'other'));
  modern.push({ ...row('legacy-000', 0, 'other'), thingtime: [kind] });
  const reads: any[] = [], things = fixtureCollection(modern, reads), old = fixtureCollection(legacy, reads);
  const all: any[] = [], cursors = new Set<string>();
  let cursor: string | null = null, firstCursor: string | null = null;
  do {
    const page = await ownedListPage({ ownerId: 'owner', purpose, things, legacy: old, kind, field, direction, cursor, fromThing: (value: any) => value });
    assert.ok(page.items.length <= 64); all.push(...page.items); cursor = page.nextCursor; firstCursor ||= cursor;
    if (cursor) { assert.ok(!cursors.has(cursor)); cursors.add(cursor); }
  } while (cursor);
  const expected = [...modern.filter(doc => doc.ownerId === 'owner'), ...legacy.filter(doc => doc.ownerId === 'owner' && !modern.some(next => next.ownerId === 'owner' && next.shareId === doc.shareId))].sort((a, b) => direction * (+a[field] - +b[field]) || (a.shareId < b.shareId ? -1 : a.shareId > b.shareId ? 1 : 0));
  assert.deepEqual(all, expected); assert.equal(new Set(all.map(doc => doc.shareId)).size, 294);
  for (const read of reads) { assert.equal(read.filter.ownerId, 'owner'); assert.ok(read.limit <= 64); }
  for (const bad of ['', 'broken', '=', firstCursor + '=', Buffer.from('{}').toString('base64url')])
    await assert.rejects(ownedListPage({ ownerId: 'owner', purpose, things, legacy: old, kind, field, direction, cursor: bad, fromThing: (value: any) => value }), /Invalid owned list cursor/);
  const decoded = JSON.parse(Buffer.from(firstCursor!, 'base64url').toString('utf8'));
  for (const changed of [{ ...decoded, v: 2 }, { ...decoded, scope: 'foreign' }, { ...decoded, time: 'not-a-date' },
    { ...decoded, time: '2026-10-26' }, { ...decoded, id: '' }, { ...decoded, id: { $gt: '' } }, { ...decoded, extra: true }])
    await assert.rejects(ownedListPage({ ownerId: 'owner', purpose, things, legacy: old, kind, field, direction,
      cursor: Buffer.from(JSON.stringify(changed)).toString('base64url'), fromThing: (value: any) => value }), /Invalid owned list cursor/);
  for (const changed of [{ ownerId: 'other', purpose }, { ownerId: 'owner', purpose: purpose === 'themes' ? 'algorithms' as const : 'themes' as const }])
    await assert.rejects(ownedListPage({ ...changed, things, legacy: old, kind, field, direction, cursor: firstCursor, fromThing: (value: any) => value }), /Invalid owned list cursor/);
});

test('owned paging rejects cancellation before queries, after reads and after projection', async () => {
  const options = { ownerId: 'owner', purpose: 'themes' as const, kind: 'theme', field: 'updatedAt' as const, direction: -1 as const };
  const reason = new Error('fixture request cancelled');
  const before = new AbortController(); before.abort(reason);
  const untouched = { find() { assert.fail('An already aborted request must not query'); } };
  await assert.rejects(ownedListPage({ ...options, signal: before.signal, things: untouched, legacy: untouched, fromThing: (doc: any) => doc }), error => error === reason);
  for (const stage of ['read', 'projection']) {
    const controller = new AbortController();
    const rows = [{ ...row('fixture', 1), thingtime: ['theme'] }];
    const collection = fixtureCollection(rows);
    const things = { find(filter: any, queryOptions: any) {
      assert.equal(queryOptions.signal, controller.signal);
      const query = collection.find(filter, queryOptions);
      const toArray = query.toArray;
      query.toArray = async () => {
        const result = await toArray();
        if (stage === 'read') controller.abort(reason);
        return result;
      };
      return query;
    } };
    await assert.rejects(ownedListPage({ ...options, signal: controller.signal, things, legacy: fixtureCollection([]),
      fromThing: (doc: any) => { if (stage === 'projection') controller.abort(reason); return doc; } }), error => error === reason);
  }
});
