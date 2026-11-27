import assert from 'node:assert/strict';
import test from 'node:test';
import { orderCommentPage } from './updownCore';
import { relatedCommentPipeline, relatedInteractionPipeline, pagedThreadCounts, RELATED_COUNT_PAGE_SIZE, tallyRelatedPoll, tallyRelatedUpdown } from './relatedWindows';

test('bounded comment windows preserve default/new/old/top selection and equal-time tie order', () => {
  const rows = Array.from({ length: 1200 }, (_, index) => ({ id: `comment-${String(index).padStart(4, '0')}`, createdAtMs: Math.floor(index / 5), rawCreatedAt: index % 2 ? new Date(Math.floor(index / 5)) : new Date(Math.floor(index / 5)).toISOString(), score: index === 2 ? 50 : index % 3 }));
  for (const sort of [null, 'new', 'old', 'top'] as const) {
    const pipeline = relatedCommentPipeline({ ids: ['root'], collection: 'things_v2', moderation: { visible: true }, projection: { shareId: 1, createdAt: 1 }, limit: 20, legacy: true, includeEmbedded: true, sort, updownKind: 'updown' });
    const group = pipeline.at(-1).$group;
    assert.equal(group.docs.$topN.n, 20);
    assert.equal('$push' in group.docs, false);
    const projection = pipeline.at(-2).$project;
    assert.equal('crystal' in projection, false); assert.equal('crystal.text' in projection, false);
    const conversion = pipeline.find(stage => stage.$set?.createdAt)?.$set.createdAt.$convert;
    assert.equal(conversion?.input, '$createdAt'); assert.equal(conversion?.to, 'date');
    const fields = group.docs.$topN.sortBy;
    const selected = [...rows].sort((a, b) => {
      for (const [field, direction] of Object.entries(fields)) {
        const av = field === 'shareId' ? a.id : field === 'createdAt' ? (typeof a.rawCreatedAt === 'string' ? Date.parse(a.rawCreatedAt) : a.rawCreatedAt.getTime()) : a.score;
        const bv = field === 'shareId' ? b.id : field === 'createdAt' ? (typeof b.rawCreatedAt === 'string' ? Date.parse(b.rawCreatedAt) : b.rawCreatedAt.getTime()) : b.score;
        if (av < bv) return -Number(direction); if (av > bv) return Number(direction);
      }
      return 0;
    }).slice(0, 20).reverse();
    assert.deepEqual(orderCommentPage(selected, sort, 20).map(row => row.id), orderCommentPage(rows, sort, 20).map(row => row.id));
    if (sort === 'top') assert.ok(pipeline.some(stage => stage.$lookup));
  }
});

test('exact thread counts traverse more than500 descendants in bounded keyset pages and prune withheld branches', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ shareId: `c${String(index).padStart(5, '0')}`, targetId: 'root', visible: true }));
  rows.push({ shareId: 'reply', targetId: rows[0].shareId, visible: true }, { shareId: 'blocked', targetId: 'root', visible: false }, { shareId: 'behind-blocked', targetId: 'blocked', visible: true });
  let maximumPage = 0, maximumParents = 0;
  const collection = { find(query: any) {
    const selector = query.$and[0]; maximumParents = Math.max(maximumParents, selector.targetId.$in.length);
    const cursor = { project(projection: any) { assert.deepEqual(projection, { shareId: 1, targetId: 1, _id: 0 }); return cursor; }, sort() { return cursor; }, limit(limit: number) {
      assert.equal(limit, RELATED_COUNT_PAGE_SIZE);
      return { async toArray() {
        const page = rows.filter(row => row.visible && selector.targetId.$in.includes(row.targetId) && (!selector.shareId?.$gt || row.shareId > selector.shareId.$gt)).sort((a, b) => a.shareId.localeCompare(b.shareId)).slice(0, limit).map(row => ({ shareId: row.shareId, targetId: row.targetId }));
        maximumPage = Math.max(maximumPage, page.length); return page;
      } };
    } }; return cursor;
  } };
  const counts = await pagedThreadCounts(collection, ['root', rows[0].shareId, 'empty'], { visible: true });
  assert.equal(counts.get('root'), 1002); assert.equal(counts.get(rows[0].shareId), 1); assert.equal(counts.get('empty'), 0);
  assert.ok(maximumPage <= RELATED_COUNT_PAGE_SIZE); assert.ok(maximumParents <= RELATED_COUNT_PAGE_SIZE);
});

test('compact interaction groups preserve large counts and viewer state without per-user arrays', () => {
  assert.deepEqual(tallyRelatedUpdown([{ userId: '', direction: 'up', count: 100000 }, { userId: 'viewer', direction: 'down', count: 1 }], 'viewer'), { up: 100000, down: 1, score: 99999, viewerVote: 'down' });
  assert.deepEqual(tallyRelatedPoll(3, [{ userId: '', optionIndex: 1, count: 100000 }, { userId: 'viewer', optionIndex: 2, count: 1 }, { userId: '', optionIndex: 9, count: 50 }], 'viewer'), { counts: [0, 100000, 1], totalVotes: 100001, viewerVote: 2 });
  const pipeline = relatedInteractionPipeline({ ids: ['root'], collection: 'things_v2', moderation: { visible: true }, legacy: true, viewerId: 'viewer', updownKind: 'updown', excludeEmbedded: true });
  assert.ok(pipeline.some(stage => stage.$unionWith)); assert.ok(pipeline.some(stage => stage.$lookup));
  assert.deepEqual(pipeline.at(-1).$group.count, { $sum: 1 });
  assert.ok(!JSON.stringify(pipeline).includes('$push'));
});

test('empty feed pages batch root count reads instead of one query per post', async () => {
 let queries = 0;
 const collection = { find() { queries++; const cursor = { project() { return cursor; }, sort() { return cursor; }, limit() { return cursor; }, async toArray() { return []; } }; return cursor; } };
 const ids = Array.from({ length: 50 }, (_, index) => `root-${index}`);
 const counts = await pagedThreadCounts(collection, ids, {});
 assert.equal(queries, 1); assert.equal(counts.size, 50); assert.ok([...counts.values()].every(count => count === 0));
});
