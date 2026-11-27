import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let streamFaultAfter = Infinity;
let rows: any[] = [], reads: any[] = [], aggregates: any[] = [], custom = false, actor: any = { kind: 'anonymous' };
const value = (row: any, key: string) => key.split('.').reduce((v, part) => v?.[part], row);
const equal = (actual: any, expected: any): boolean => expected === null ? actual == null :
  expected instanceof Date ? +actual === +expected : Array.isArray(expected) ? JSON.stringify(actual) === JSON.stringify(expected) :
  Array.isArray(actual) ? actual.includes(expected) : actual === expected;
const matches = (row: any, query: any): boolean => Object.entries(query).every(([key, expected]: any) => {
  if (key === '$and') return expected.every((q: any) => matches(row, q));
  if (key === '$or') return expected.some((q: any) => matches(row, q));
  if (key === '$nor') return !expected.some((q: any) => matches(row, q));
  const actual = value(row, key);
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) return Object.entries(expected).every(([op, test]: any) => {
    if (op === '$in') return test.some((item: any) => equal(actual, item));
    if (op === '$nin') return !test.some((item: any) => equal(actual, item));
    if (op === '$exists') return (actual !== undefined) === test;
    if (op === '$ne') return !equal(actual, test);
    if (op === '$lt') return actual < test;
    if (op === '$gt') return actual > test;
    if (op === '$regex') return (test instanceof RegExp ? test : new RegExp(test, expected.$options || '')).test(String(actual ?? ''));
    if (op === '$options') return true;
    throw new Error(`Unexpected query operator ${op}`);
  });
  return equal(actual, expected);
});
const sortRows = (input: any[], sort: any) => [...input].sort((a, b) => {
  for (const [key, direction] of Object.entries(sort)) {
    const av = value(a, key), bv = value(b, key);
    if (av < bv) return -(direction as number);
    if (av > bv) return direction as number;
  }
  return 0;
});
const collection = {
  findOne: async (query: any) => { reads.push({ query, one: true }); return rows.find(row => matches(row, query)) || null; },
  find: (query: any) => {
    const record: any = { query }; reads.push(record);
    const cursor = { project: (projection: any) => { record.projection = projection; return cursor; }, batchSize: (size: number) => { record.batchSize = size; return cursor; }, close: async () => { record.closed = true; },
      [Symbol.asyncIterator]: async function* () {
        const found = rows.filter(row => matches(row, query));
        const sorted = record.sort ? sortRows(found, record.sort) : found;
        let emitted = 0;
        for (const row of sorted) {
          if (emitted++ === streamFaultAfter) throw new Error('Synthetic cursor failure');
          const projected: any = {};
          for (const key of Object.keys(record.projection || row)) {
            const v = value(row, key); if (v === undefined) continue;
            const parts = key.split('.'); let target = projected;
            for (const part of parts.slice(0, -1)) target = target[part] ||= {};
            target[parts.at(-1)!] = v;
          }
          yield projected;
        }
      }, sort: (sort: any) => { record.sort = sort; return cursor; }, limit: (limit: number) => { record.limit = limit; return cursor; },
      toArray: async () => {
        const result = rows.filter(row => matches(row, query));
        return (record.sort ? sortRows(result, record.sort) : result).slice(0, record.limit);
      } };
    return cursor;
  },
  countDocuments: async (query: any) => { reads.push({ query, count: true }); return rows.filter(row => matches(row, query)).length; },
  aggregate: (pipeline: any[]) => {
    aggregates.push(pipeline);
    // Search candidates now join only ACL control rows before pagination. The
    // discussion paths above must still avoid aggregation/body hydration.
    let result = rows.map(row => ({ ...row }));
    for (const stage of pipeline) {
      if (stage.$match) result = result.filter(row => matches(row, stage.$match));
      else if (stage.$set) {
        assert.deepEqual(Object.keys(stage.$set), ['_aclCandidateIds'], 'Only the canonical ACL candidate set is allowed');
      } else if (stage.$lookup) {
        assert.equal(stage.$lookup.as, '_aclCandidate', 'Attachment/body lookups remain forbidden');
        assert.equal(stage.$lookup.localField, '_aclCandidateIds');
        assert.equal(stage.$lookup.foreignField, 'shareId');
        assert.equal(stage.$lookup.pipeline.length, 3, 'The candidate lookup has no nested hydration stages');
        assert.equal(stage.$lookup.pipeline[0].$match.thingtime, 'acl-entry');
        assert.deepEqual(stage.$lookup.pipeline[1], { $limit: 1 });
        assert.deepEqual(stage.$lookup.pipeline.at(-1), { $project: { _id: 1 } });
        assert(result.every(row => row.aclGeneration === undefined), 'This fixture models legacy ACL roots only');
        result = result.map(row => ({ ...row, _aclCandidate: [] }));
      } else if (stage.$unset) {
        const keys = Array.isArray(stage.$unset) ? stage.$unset : [stage.$unset];
        result = result.map(row => { const clean = { ...row }; for (const key of keys) delete clean[key]; return clean; });
      } else if (stage.$sort) result = sortRows(result, stage.$sort);
      else if (stage.$skip !== undefined) result = result.slice(stage.$skip);
      else if (stage.$limit !== undefined) result = result.slice(0, stage.$limit);
      else if (stage.$count) result = result.length ? [{ [stage.$count]: result.length }] : [];
      else throw new Error('Unexpected aggregate purpose in discussion fixture');
    }
    return { toArray: async () => result };
  }
};
mock.module('../mongodb/collections', { namedExports: { getThingsCollection: async () => collection, getHomeThingsCollection: async () => collection, getUsersCollection: async () => collection, withMongoTransaction: async () => { throw new Error('No writes'); } } });
mock.module('../mongodb/legacyThingLayout', { namedExports: { legacyThingReadsRequired: async () => false } });
mock.module('../mongodb/endpoint', { namedExports: { isCustomMongoEndpointActive: () => custom } });
mock.module('../auth/resolveActor', { namedExports: { resolveActor: async () => actor, actorUser: () => null, actorPat: () => null, actorCors: () => ({}) } });
mock.module('../rateLimit/enforce', { namedExports: { enforceRateLimit: async () => ({ allowed: false }), rateLimitedResponseInit: () => ({ status: 429 }), getRequestIp: () => null } });
const { listThings, getThing, countThings, getThings, getLibraryArchiveAction, setLibraryArchive, bulkThings } = await import('./things');
const { loader } = await import('../../../routes/api/v1/things/_things.tsx');
const { searchThings } = await import('./search');
const date = new Date('2026-09-21T00:00:00Z');
const doc = (id: string, extra: any = {}) => ({ shareId: id, ownerId: 'author', thingtime: ['data'], acl: ['tt:all'], crystal: {}, schemaVersion: 2, createdAt: date, updatedAt: date, ...extra });
const comment = (id: string, extra: any = {}) => doc(id, { thingtime: ['post', 'comment'], targetId: 'root', acl: ['tt:inherit'], crystal: { text: id, richText: { blocks: [{ type: 'paragraph', data: { text: 'Rich text' } }] } }, ...extra });
const viewer = { id: 'reader', friendIds: new Set<string>(), groupIds: new Set<string>(), subspaceRoles: new Map() };
const page = (extra: any = {}, asViewer: any = viewer) => listThings(asViewer, { targetId: 'root', thingtime: ['comment'], commentProjection: true, ...extra });
const unknownTotals = (body: any) => {
  for (const key of ['reactionCounts', 'viewerReactions', 'votes', 'commentCount', 'commentCounts', 'shareCount', 'viewCount', 'viewStats', 'pollVotes']) assert.equal(key in body, false, key);
  assert.deepEqual(body.comments, []); assert.equal(body.repliesLoaded, false);
};
beforeEach(() => { rows = [doc('root'), doc('author', { thingtime: ['user'], crystal: { username: 'author' } })]; reads = []; aggregates = []; custom = false; actor = { kind: 'anonymous' }; });

test('each page authorizes children before hydration and never reads siblings, replies or interactions', async () => {
  rows.push(comment('visible'), comment('private', { ownerId: 'private-author', acl: ['tt:user'] }), comment('blocked', { moderation: { status: 'blocked' } }),
    comment('pending', { moderation: { status: 'pending' } }), comment('namespace', { appId: 'client' }), comment('protected', { thingtime: ['post', 'comment', 'chat-archive'] }),
    comment('nested-private', { targetId: 'visible', acl: ['tt:user'] }), doc('interaction', { targetId: 'visible', thingtime: ['reaction'] }));
  const result = await page(); assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.comments?.map(row => row.id), ['visible']); assert.deepEqual(result.things.map(row => row.id), ['visible']);
  assert.equal(result.comments?.[0].richText?.blocks[0].data.text, 'Rich text');
  assert.deepEqual(result.comments?.[0].audience, { sourceId: 'root', acl: ['tt:all'] });
  assert.equal(result.comments?.[0].targetId, 'root'); unknownTotals(result.comments![0]);
  assert.equal(reads.filter(read => read.query.thingtime === 'user').length, 1, 'authors batched once');
  assert.equal(reads.some(read => read.query.shareId?.$in?.includes('private-author')), false, 'denied child never hydrates author');
  assert.equal(aggregates.length, 0);
  const attachmentReads = reads.filter(read => read.query.$and?.some((clause: any) => clause.thingtime === 'attachment'));
  assert.equal(attachmentReads.length, 1);
  assert.deepEqual(attachmentReads[0].query.$and[1].$or.map((row: any) => row.targetId), ['visible']);
  assert.equal(reads.filter(read => read.query.shareId?.$in?.includes('root')).length, 2, 'ACL and audience each coalesce ancestry, never per child');
});

test('a denied page still advances its cursor, including underscore IDs and equal timestamps', async () => {
  rows.push(comment('a_private', { acl: ['tt:user'] }), comment('b_private', { acl: ['tt:user'] }), comment('c_visible'), comment('d_visible'));
  const first = await page({ limit: 2 }); assert.equal(first.ok, true); if (!first.ok) return;
  assert.deepEqual(first.comments, []); assert.ok(first.nextCursor?.startsWith('dc1.')); assert.equal(first.nextCursor!.includes('b_private'), false);
  assert.equal(aggregates.length, 0, 'no hydration for a fully denied page');
  const second = await page({ limit: 2, cursor: first.nextCursor }); assert.equal(second.ok, true); if (!second.ok) return;
  assert.deepEqual(second.comments?.map(row => row.id), ['c_visible', 'd_visible']); assert.equal(second.nextCursor, null);
  assert.equal(reads.filter(read => read.limit).every(read => read.limit === 3), true);
});

test('parent revocation, blocked ancestors and token visibility are enforced again on the next page', async () => {
  rows.push(comment('child'));
  assert.equal((await page({}, null)).ok, true);
  rows[0].acl = ['tt:user'];
  assert.deepEqual(await page({}, null), { ok: false, status: 404, error: 'Thing not found' });
  const ownerToken = { ...viewer, id: 'author', pat: { tokenId: 'public-only', onlyCreatedThings: false, visibility: 'public' } };
  assert.equal((await page({}, ownerToken)).ok, false);
  rows[0].acl = ['tt:all']; rows[0].moderation = { status: 'blocked' };
  assert.equal((await page()).ok, false);
});

test('a canonical hidden root grants only its inherited children, not a hidden sibling with its own audience', async () => {
  rows[0].acl = ['tt:hidden']; rows[0].linkKey = 'secret';
  rows.push(comment('inherited'), comment('other-hidden', { acl: ['tt:hidden'], linkKey: 'different' }));
  const result = await page({}, null); assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.comments?.map(row => row.id), ['inherited']);
  assert.equal(result.comments![0].audience?.linkKey, undefined);
});

test('narrow root reads and the default generic discussion never hydrate private descendants or parent originals', async () => {
  rows.push(comment('private-descendant', { acl: ['tt:user'] }), comment('public-child'), comment('private-reply', { targetId: 'public-child', acl: ['tt:user'] }));
  for (const [id, options] of [['root', {}], ['root', { commentProjection: true }], ['public-child', { commentProjection: true }]] as const) {
    reads = []; aggregates = [];
    const result = await getThing(viewer, id, null, options); assert.equal(result.ok, true); if (!result.ok) continue;
    const body = result.post || result.discussion; assert.ok(body); unknownTotals(body);
    assert.equal(result.parent, null); assert.equal(result.root, null);
    assert.equal(JSON.stringify(result).includes('private-descendant'), false); assert.equal(JSON.stringify(result).includes('private-reply'), false);
    assert.equal(reads.some(read => read.query.targetId), false, 'no child find query');
  }
});

test('invalid cursor/limit and non-home/non-comment projection modes fail before database access', async () => {
  for (const cursor of ['', 'bad', 'NaN_a', '1.5_a', 'Infinity_a', '8640000000000001_a', '1_', '1_a b', `1_${'x'.repeat(129)}`]) {
    assert.equal((await page({ cursor })).ok, false);
  }
  for (const limit of [0, -1, 21, 1.5, NaN, Infinity]) assert.equal((await page({ limit })).ok, false);
  for (const query of [{ targetId: null }, { thingtime: ['post'] }, { thingtime: ['comment', 'post'] }, { appId: 'client' }, { folder: 'folder' }]) assert.equal((await page(query)).ok, false);
  assert.equal((await listThings(viewer, { targetId: 'root', thingtime: ['comment'], commentProjection: true }, {} as any)).ok, false);
  custom = true;
  assert.equal((await page()).ok, false); assert.equal((await getThing(viewer, 'root', null, { commentProjection: true })).ok, false);
  assert.equal(reads.length, 0); assert.equal(aggregates.length, 0);
});

test('linked references are batched and private or app-scoped linked records remain absent', async () => {
  rows.push(doc('public-link'), doc('private-link', { acl: ['tt:user'] }), doc('app-link', { appId: 'client' }),
    comment('rich', { crystal: { thing: { kind: 'thing-collection', items: ['public-link', 'private-link', 'app-link'].map(id => ({ id, mode: 'data' })) } } }));
  const result = await page(); assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.comments![0].linkedThings?.map(item => item.thing?.id || null), ['public-link', null, null]);
  assert.equal(reads.filter(read => read.query.shareId?.$in?.includes('public-link')).length, 1);
});

test('attachment hydration preserves every authorized source attachment and strips private storage metadata', async () => {
  rows.push(comment('with-files'));
  const file = (id: string, extra: any = {}) => doc(id, { thingtime: ['attachment'], targetId: 'with-files', acl: ['tt:inherit'], attachmentPurpose: 'comment', attachmentState: 'ready',
    crystal: { name: 'file.png', contentType: 'image/png', size: 1, mediaKind: 'image' }, objectKey: 'never-public', uploadId: 'private-upload', ...extra });
  for (let i = 0; i < 30; i++) rows.push(file(`file-${String(i).padStart(2, '0')}`, { attachmentSortIndex: i }));
  rows.push(file('foreign', { ownerId: 'stranger' }), file('private', { acl: ['tt:user'] }), file('wrong-purpose', { attachmentPurpose: 'post' }), file('blocked-file', { moderation: { status: 'blocked' } }));
  const result = await page(); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.comments![0].attachments.length, 30); assert.equal(result.comments![0].attachmentsTruncated, undefined);
  assert.deepEqual(result.comments![0].attachments.map((file: any) => file.id), Array.from({ length: 30 }, (_, index) => `file-${String(index).padStart(2, '0')}`));
  assert.equal(result.things[0].attachments?.length, 30); assert.equal(aggregates.length, 0);
  assert.equal(reads.filter(read => read.query.$and?.some((clause: any) => clause.thingtime === 'attachment')).length, 1);
  const text = JSON.stringify(result); for (const secret of ['never-public', 'private-upload', 'foreign', 'wrong-purpose', 'blocked-file']) assert.equal(text.includes(secret), false, secret);
});


test('legacy embedded comments share the bounded cursor window and a standalone private replacement stays private', async () => {
  rows[0].comments = ['a_legacy', 'b_replaced', 'd_legacy'].map(id => ({ id, userId: 'author', text: id, createdAt: date }));
  rows.push(comment('b_replaced', { acl: ['tt:user'] }), comment('c_standalone'));
  const first = await page({ limit: 2 }); assert.equal(first.ok, true); if (!first.ok) return;
  assert.deepEqual(first.comments?.map(row => row.id), ['a_legacy']); assert.ok(first.nextCursor?.startsWith('dc1.'));
  const second = await page({ limit: 2, cursor: first.nextCursor }); assert.equal(second.ok, true); if (!second.ok) return;
  assert.deepEqual(second.comments?.map(row => row.id), ['c_standalone', 'd_legacy']); assert.equal(second.nextCursor, null);
  assert.equal(JSON.stringify(first.things).includes('b_replaced'), false);
});

test('narrow companions omit cached descendant fields and redact moderator-removed bodies', async () => {
  rows[0].crystal = { name: 'Root', comments: [{ text: 'secret child' }], replies: [{ text: 'secret reply' }] };
  const root = await getThing(viewer, 'root'); assert.equal(root.ok, true); if (!root.ok) return;
  assert.equal(JSON.stringify(root).includes('secret child'), false); assert.equal(JSON.stringify(root).includes('secret reply'), false);
  rows.push(comment('removed', { crystal: { text: 'removed secret', thing: { field: 'removed data' }, subspaceId: 'community' }, extended: { secret: true }, subspaceMod: { status: 'removed', reason: 'private mod reason' } }));
  const result = await page(); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(JSON.stringify(result).includes('removed secret'), false); assert.equal(JSON.stringify(result).includes('removed data'), false);
  assert.equal(JSON.stringify(result).includes('private mod reason'), false); assert.equal(result.things[0].extended, null);
});


test('the actual HTTP loader returns narrow root and cursor page shapes with private no-store responses', async () => {
  rows.push(comment('child'), comment('private', { acl: ['tt:user'] }));
  for (const query of ['id=root&commentProjection=true', 'target=root&thingtime=comment&limit=20&commentProjection=true']) {
    const response = await loader({ request: new Request(`https://thingtime.test/api/v1/things?${query}`) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json(); assert.equal(body.ok, true);
    if (body.discussion) unknownTotals(body.discussion);
    if (body.comments) { assert.deepEqual(body.comments.map((row: any) => row.id), ['child']); unknownTotals(body.comments[0]); }
    assert.equal(JSON.stringify(body).includes('"id":"private"'), false);
  }
});

test('HTTP projection guards reject ambiguous selectors, malformed limits/cursors, app and custom planes before reads', async () => {
  const invalid = ['id=root&target=root', 'id=root&limit=20', 'id=root&cursor=1_a', 'id=root&commentSort=new', 'id=root&archive=true', 'id=root&sharedRoot=x',
    'target=root&thingtime=comment&appId=', 'target=root&thingtime=comment&folder=', 'target=root&thingtime=post', 'thingtime=comment',
    'target=root&thingtime=comment&limit=NaN', 'target=root&thingtime=comment&limit=0', 'target=root&thingtime=comment&limit=1.5',
    'target=root&thingtime=comment&cursor=', 'target=root&thingtime=comment&cursor=garbage', 'id=root&id=other'];
  for (const query of invalid) assert.equal((await loader({ request: new Request(`https://thingtime.test/api/v1/things?${query}&commentProjection=true`) })).status, 400, query);
  assert.equal((await loader({ request: new Request('https://thingtime.test/api/v1/things?id=root&commentProjection=false') })).status, 400);
  actor = { kind: 'app', scope: {} };
  assert.equal((await loader({ request: new Request('https://thingtime.test/api/v1/things?id=root&commentProjection=true') })).status, 400);
  actor = { kind: 'anonymous' }; custom = true;
  assert.equal((await loader({ request: new Request('https://thingtime.test/api/v1/things?id=root&commentProjection=true') })).status, 400);
  assert.equal(reads.length, 0); assert.equal(aggregates.length, 0);
});

test('a full 20-item page uses fixed batch work and the next page returns the remaining five', async () => {
  for (let i = 0; i < 25; i++) rows.push(comment(`comment-${String(i).padStart(2, '0')}`));
  const first = await page({ limit: 20 }); assert.equal(first.ok, true); if (!first.ok) return;
  assert.equal(first.comments?.length, 20); assert.ok(first.nextCursor);
  assert.equal(reads.filter(read => read.limit).length, 1); assert.equal(reads.find(read => read.limit)?.limit, 21);
  assert.equal(reads.filter(read => read.query.thingtime === 'user').length, 1); assert.equal(aggregates.length, 0);
  assert.equal(reads.filter(read => read.query.$and?.some((clause: any) => clause.thingtime === 'attachment')).length, 1);
  assert.equal(reads.filter(read => read.query.shareId?.$in?.includes('root')).length, 2);
  const second = await page({ limit: 20, cursor: first.nextCursor }); assert.equal(second.ok, true); if (!second.ok) return;
  assert.equal(second.comments?.length, 5); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.comments!, ...second.comments!].map(row => row.id)).size, 25);
});


test('opaque denied-row cursors cannot reveal a hidden link and reject mutation, other targets and other viewers', async () => {
  rows.push(comment('secret_hidden_capability', { acl: ['tt:hidden'] }), comment('z-visible'));
  const result = await page({ limit: 1 }); assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.comments, []); const cursor = result.nextCursor!; assert.ok(cursor);
  assert.equal(cursor.includes('secret_hidden_capability'), false);
  assert.equal(Buffer.from(cursor.slice(4), 'base64url').toString().includes('secret_hidden_capability'), false);
  assert.equal((await page({ cursor: cursor.slice(0, -4) + 'AAAA' })).ok, false);
  assert.equal((await page({ cursor, targetId: 'different' })).ok, false);
  assert.equal((await page({ cursor }, { ...viewer, id: 'other' })).ok, false);
  assert.equal((await page({ cursor }, { ...viewer, pat: { tokenId: 'different', visibility: null, onlyCreatedThings: false } })).ok, false);
  const next = await page({ cursor }); assert.equal(next.ok, true); if (next.ok) assert.deepEqual(next.comments?.map(row => row.id), ['z-visible']);
});

test('cursor expiry and absent production signing authority fail closed without reading the page', async (context) => {
  const { encodeDiscussionCursor, decodeDiscussionCursor } = await import('./discussionCursor');
  const scope = { targetId: 'root', viewerId: 'reader', tokenId: '' };
  let now = Date.now(); context.mock.method(Date, 'now', () => now);
  const encoded = encodeDiscussionCursor({ id: 'last_id', createdAt: date }, scope);
  assert.equal(decodeDiscussionCursor(encoded, scope)?.id, 'last_id');
  now += 8 * 24 * 60 * 60 * 1000;
  assert.equal(decodeDiscussionCursor(encoded, scope), null);
  assert.equal(decodeDiscussionCursor('dc1.' + 'A'.repeat(1024), scope), null);
  const names = ['NODE_ENV', 'JWT_PRIVATE_KEY', 'JWT_SECRET', 'THINGTIME_ADMIN_VAULT_KEY'] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = 'production';
    for (const name of names.slice(1)) delete process.env[name];
    assert.deepEqual(await page(), { ok: false, status: 503, error: 'Discussion pagination is unavailable' });
    assert.equal(reads.length, 0); assert.equal(aggregates.length, 0);
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
});

test('the legacy list contract retains raw cursors and generic attachment projection', async () => {
  rows.push(comment('a_legacy'), comment('b_legacy'));
  const result = await listThings(viewer, { targetId: 'root', thingtime: ['comment'], limit: 1 });
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.nextCursor, `${+date}_a_legacy`); assert.equal('comments' in result, false);
  assert.deepEqual(result.things[0].attachments, []); assert.equal(aggregates.length, 0);
});


test('generic reads cannot bypass device command byte redaction or result expiry, including owner PATs and inherited rows', async () => {
  const owner = { ...viewer, id: 'author' };
  const pat = { ...owner, pat: { tokenId: 'things-read-only', onlyCreatedThings: false, visibility: null } };
  rows.push(doc('device', { thingtime: ['device'], acl: ['tt:user'] }));
  for (const kind of ['device-command', 'device-command-event', 'device-ai-live-state', 'device-approval']) {
    for (const expiresAt of [new Date(Date.now() - 60_000), new Date(Date.now() + 600_000)]) {
      const id = `${kind}-${+expiresAt}`;
      rows.push(doc(id, { thingtime: [kind], targetId: 'device', acl: ['tt:inherit'], crystal: {
        kind: 'filesystem', input: { op: 'write', data: 'private-upload-bytes' }, result: { data: 'private-download-bytes' }, resultExpiresAt: expiresAt } }));
      for (const actor of [owner, pat]) for (const commentProjection of [false, true]) {
        assert.deepEqual(await getThing(actor, id, null, { commentProjection }), { ok: false, status: 404, error: 'Thing not found' });
      }
      rows.push(comment(`child-${id}`, { targetId: id }));
      assert.equal((await getThing(owner, `child-${id}`, null, { commentProjection: true })).ok, false, 'an inherited child cannot reopen a control-plane ancestor');
    }
  }
  for (const actor of [owner, pat]) {
    const list = await listThings(actor, { targetId: 'device' }); assert.equal(list.ok, true); if (list.ok) assert.deepEqual(list.things, []);
  }
  assert.equal(aggregates.length, 0, 'no body/media hydration occurs for control records');
});

test('the control-row fence preserves personal library theme, algorithm and ready file discussions', async () => {
  const owner = { ...viewer, id: 'author' };
  for (const kind of ['theme', 'feed-algorithm', 'attachment']) {
    const id = `library-${kind}`;
    rows.push(doc(id, { thingtime: [kind], acl: ['tt:user'], attachmentPurpose: 'file', attachmentState: 'ready', crystal: { name: 'My library item' } }));
    const result = await getThing(owner, id, null, { commentProjection: true }); assert.equal(result.ok, true, kind);
    if (result.ok) { assert.equal(result.thing.crystal.name, 'My library item'); assert.equal((result.post || result.discussion)?.repliesLoaded, false); }
  }
});


test('exact count shares filters, excludes private terminal/blocked rows, and omits content hydration', async () => {
  const crystal = { schemaId: 'route-schema', parentId: 'route-1' };
  rows.push(doc('active', { ownerId: 'reader', crystal }),
    doc('archived', { ownerId: 'reader', crystal: { ...crystal, archived: true } }),
    doc('string-archived', { ownerId: 'reader', crystal: { ...crystal, archived: 'true' } }),
    doc('blocked', { ownerId: 'reader', crystal, moderation: { status: 'blocked' } }), doc('other-owner', { crystal }),
    doc('other-schema', { ownerId: 'reader', crystal: { ...crystal, schemaId: 'different' } }),
    doc('other-parent', { ownerId: 'reader', crystal: { ...crystal, parentId: 'route-2' } }),
    doc('denied', { ownerId: 'reader', crystal, targetId: 'private-terminal', acl: ['tt:inherit'] }),
    doc('private-terminal', { acl: ['tt:user'] }),
    doc('inherited', { ownerId: 'reader', crystal, targetId: 'public-terminal', acl: ['tt:inherit'] }), doc('public-terminal'));
  const query = { thingtime: ['data'], schemaId: 'route-schema', parentId: 'route-1', excludeArchived: true };
  assert.deepEqual(await countThings(viewer, query), { ok: true, count: 3 });
  assert.equal(reads.filter(read => read.count).length, 1);
  const stream = reads.find(read => read.batchSize); assert.equal(stream.batchSize, 100); assert.equal(stream.closed, true);
  assert.equal(stream.projection.crystal, undefined);
  assert.equal(reads.some(read => read.query.thingtime === 'user'), false);
  const page = await listThings(viewer, { ...query, offset: 0, limit: 20 });
  assert.equal(page.ok, true); if (page.ok) assert.deepEqual(page.things.map(row => row.id).sort(), ['active', 'inherited', 'string-archived']);
});

test('count preserves PAT visibility and app namespace boundaries', async () => {
  rows.push(doc('public', { ownerId: 'reader' }), doc('private', { ownerId: 'reader', acl: ['tt:user'] }),
    doc('app-owned', { ownerId: 'reader', appId: 'app-one', acl: ['tt:user'] }), doc('other-app', { ownerId: 'reader', appId: 'app-two', acl: ['tt:user'] }));
  const query = { thingtime: ['data'] };
  assert.deepEqual(await countThings({ ...viewer, pat: { visibility: 'public' } } as any, query), { ok: true, count: 1 });
  assert.deepEqual(await countThings({ ...viewer, pat: { visibility: 'private' } } as any, query), { ok: true, count: 3 });
  const app = { appId: 'app-one', ownerId: 'reader', sharedRead: false, scopes: [], username: 'reader', sandbox: null };
  assert.deepEqual(await countThings(viewer, query, app), { ok: true, count: 1 });
  assert.equal(reads.some(read => read.count), false);
});

test('count has no batch cap and fails without a subtotal for cancellation or invalid paging', async () => {
  for (let index = 0; index < 231; index++) rows.push(doc(`row-${index}`, { ownerId: 'reader' }));
  assert.deepEqual(await countThings({ ...viewer, pat: { visibility: 'public' } } as any, { thingtime: ['data'] }), { ok: true, count: 231 });
  const controller = new AbortController(); controller.abort();
  const abort = await countThings(viewer, {}, null, { signal: controller.signal }); assert.equal(abort.ok, false);
  if (!abort.ok) assert.equal(abort.status, 499);
  for (const invalid of [{ cursor: 'x' }, { limit: 10 }, { offset: 0 }, { commentProjection: true }]) assert.equal((await countThings(viewer, invalid)).ok, false);
  const anonymous = await countThings(null, {}); assert.equal(anonymous.ok, false); if (!anonymous.ok) assert.equal(anonymous.status, 401);
});

test('offset pages skip authorized rows only and hydrate one content window', async () => {
  for (let index = 0; index < 22; index++) rows.push(doc(`row-${String(index).padStart(2, '0')}`, { ownerId: 'reader', moderation: index % 2 ? { status: 'blocked' } : undefined }));
  const page = await listThings(viewer, { thingtime: ['data'], offset: 3, limit: 4 });
  assert.equal(page.ok, true); if (!page.ok) return;
  assert.deepEqual(page.things.map(row => row.id), ['row-06', 'row-08', 'row-10', 'row-12']); assert.equal(page.offset, 3); assert.equal(page.nextOffset, 7);
  const content = reads.find(read => read.query.$and?.some((q: any) => q.shareId?.$in));
  assert.equal(content.query.$and.find((q: any) => q.shareId?.$in).shareId.$in.length, 5);
  const last = await listThings(viewer, { thingtime: ['data'], offset: 9, limit: 4 });
  assert.equal(last.ok, true); if (last.ok) { assert.equal(last.things.length, 2); assert.equal(last.nextOffset, null); }
  for (const invalid of [{ offset: -1 }, { offset: 1.5 }, { offset: 0, cursor: 'x' }]) assert.equal((await listThings(viewer, invalid)).ok, false);
});


test('later cursor failure never publishes a partial count', async () => {
  for (let index = 0; index < 131; index++) rows.push(doc(`row-${index}`, { ownerId: 'reader' }));
  streamFaultAfter = 110;
  try {
    const result = await countThings({ ...viewer, pat: { visibility: 'public' } } as any, { thingtime: ['data'] });
    assert.deepEqual(result, { ok: false, status: 503, error: 'Things count is unavailable' });
    assert.equal(reads.find(read => read.batchSize).closed, true);
  } finally { streamFaultAfter = Infinity; }
});

test('count route rejects ambiguous, paged and unsupported requests before data reads', async () => {
  for (const extra of ['limit=10', 'cursor=x', 'offset=0', 'id=anything', 'commentProjection=true', 'q=private', 'count=true', 'thingtime=data&thingtime=post']) {
    const response = await loader({ request: new Request('https://thingtime.test/api/v1/things?count=true&' + extra) });
    assert.equal(response.status, 400); assert.equal(reads.length, 0);
  }
  const anonymous = await loader({ request: new Request('https://thingtime.test/api/v1/things?count=true') });
  assert.equal(anonymous.status, 401); assert.match(anonymous.headers.get('Cache-Control') || '', /no-store/);
});


test('batch exact reads preserve input order and duplicates, while denied/missing/protected rows are null', async () => {
  rows.push(doc('public'), doc('own', { ownerId: 'reader', acl: ['tt:user'] }), doc('private', { acl: ['tt:user'] }),
    doc('hidden', { acl: ['tt:hidden'], linkKey: 'must-not-appear' }),
    doc('blocked', { ownerId: 'reader', moderation: { status: 'blocked' } }),
    doc('draft', { ownerId: 'reader', thingtime: ['draft'], crystal: { private: 'never' } }),
    doc('inherit', { ownerId: 'reader', acl: ['tt:inherit'], targetId: 'private' }));
  const result = await getThings(viewer, ['own', 'private', 'missing', 'public', 'public', 'hidden', 'blocked', 'draft', 'inherit']);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.things.map(row => row?.id ?? null), ['own', null, null, 'public', 'public', 'hidden', null, null, null]);
  assert.equal(JSON.stringify(result).includes('must-not-appear'), false);
  assert.equal(reads.some(read => read.query.targetId), false, 'batch reads never hydrate discussion descendants');
  const batch = reads.find(read => read.query.shareId?.$in?.includes('own'));
  assert.equal(batch.query.shareId.$in.filter((id: string) => id === 'public').length, 1, 'duplicates read once');
});

test('batch exact reads preserve PAT and app scopes and do not cap item counts', async () => {
  rows.push(doc('public', { ownerId: 'reader' }), doc('private', { ownerId: 'reader', acl: ['tt:user'] }),
    doc('app', { ownerId: 'reader', appId: 'one', acl: ['tt:user'] }), doc('other-app', { ownerId: 'reader', appId: 'two', acl: ['tt:user'] }));
  const publicOnly = await getThings({ ...viewer, pat: { visibility: 'public' } } as any, ['private', 'public']);
  assert.equal(publicOnly.ok, true); if (publicOnly.ok) assert.deepEqual(publicOnly.things.map(row => row?.id ?? null), [null, 'public']);
  const app = { appId: 'one', ownerId: 'reader', sharedRead: false, scopes: [], username: 'reader', sandbox: null };
  const scoped = await getThings(viewer, ['private', 'app', 'other-app'], app);
  assert.equal(scoped.ok, true); if (scoped.ok) assert.deepEqual(scoped.things.map(row => row?.id ?? null), [null, 'app', null]);
  const many = await getThings(viewer, Array.from({ length: 231 }, (_, index) => index % 2 ? 'public' : 'missing'));
  assert.equal(many.ok, true); if (many.ok) { assert.equal(many.things.length, 231); assert.equal(many.things.filter(Boolean).length, 115); }
  assert.deepEqual(await getThings(viewer, []), { ok: true, things: [] });
});

test('batch exact reads validate all inputs before querying and never return partial cancellation results', async () => {
  for (const ids of [null, {}, 'public', [1], [' public'], ['a.b'], ['a$b'], [''], ['a\n']]) {
    const result = await getThings(viewer, ids); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.status, 400);
  }
  assert.equal(reads.length, 0);
  const anonymous = await getThings(null, ['public']); assert.equal(anonymous.ok, false); if (!anonymous.ok) assert.equal(anonymous.status, 401);
  const controller = new AbortController(); controller.abort();
  const aborted = await getThings(viewer, ['public'], null, { signal: controller.signal });
  assert.equal(aborted.ok, false); if (!aborted.ok) assert.equal(aborted.status, 499);
  for (const extra of ['id=public', 'thingtime=data', 'limit=10', 'count=true', 'ids=[]']) {
    const response = await loader({ request: new Request('https://thingtime.test/api/v1/things?ids=%5B%5D&' + extra) }); assert.equal(response.status, 400);
  }
});


test('batch exact reads process more than one DB chunk without changing requested order', async () => {
  const ids = Array.from({ length: 225 }, (_, index) => `many-${index}`);
  rows.push(...ids.map(id => doc(id, { ownerId: 'reader' })));
  ids.reverse();
  const result = await getThings(viewer, ids); assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.things.map(row => row?.id), ids);
  const chunks = reads.filter(read => read.query.shareId?.$in?.some((id: string) => id.startsWith('many-')));
  assert.equal(chunks.length, 3); assert.ok(chunks.every(read => read.query.shareId.$in.length <= 100));
});

test('batch exact projections match canonical single reads and batch public author reads', async () => {
  rows.push(doc('own', { ownerId: 'reader', acl: ['tt:user'] }), doc('private', { acl: ['tt:user'] }),
    doc('hidden-root', { acl: ['tt:hidden'], linkKey: 'redacted-root-key' }),
    doc('inherited-hidden', { acl: ['tt:inherit'], targetId: 'hidden-root' }),
    doc('blocked', { ownerId: 'reader', moderation: { status: 'blocked' } }),
    doc('private-subspace', { subspacePrivate: true, crystal: { subspaceId: 'members-only' } }));
  const ids = ['own', 'private', 'hidden-root', 'inherited-hidden', 'blocked', 'private-subspace', 'root'];
  const batch = await getThings(viewer, ids);
  assert.equal(batch.ok, true); if (!batch.ok) return;
  assert.equal(reads.filter(read => read.query.thingtime === 'user').length, 1, 'public authors hydrate in one read');
  for (let index = 0; index < ids.length; index++) {
    const exact = await getThing(viewer, ids[index]);
    const expected = exact.ok ? { ...exact.thing } : null;
    if (expected) delete expected.attachments; // Discussion hydration is deliberately absent in batch reads.
    assert.deepEqual(batch.things[index], expected, ids[index]);
  }
});

test('batch direct bodies omit cached descendants and apply canonical removed-body redaction', async () => {
  rows.push(doc('cached', { crystal: { title: 'Keep', comments: ['private child'], replies: ['private reply'], reactions: ['private reaction'] } }),
    doc('removed', { crystal: { text: 'removed secret', subspaceId: 'community' }, extended: { secret: 'removed extension' },
      tags: ['removed tag'], subspaceMod: { status: 'removed' } }));
  const result = await getThings(viewer, ['cached', 'removed']); assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.things[0]?.crystal, { title: 'Keep' });
  assert.deepEqual(result.things[1]?.crystal, { type: 'text' });
  assert.equal(result.things[1]?.extended, null); assert.deepEqual(result.things[1]?.tags, []);
  assert.equal(JSON.stringify(result).includes('private child'), false);
  assert.equal(JSON.stringify(result).includes('removed secret'), false);
  assert.equal(aggregates.length, 0, 'direct batches do not hydrate discussion attachments');
  assert.equal(result.things.some(thing => thing && 'attachments' in thing), false);
  const owner = await getThings({ ...viewer, id: 'author' }, ['removed']);
  assert.equal(owner.ok, true); if (owner.ok) assert.equal(owner.things[0]?.crystal.text, 'removed secret');
});

test('later batch read failure never exposes an earlier partial batch', async context => {
  const ids = Array.from({ length: 101 }, (_, index) => `batch-${index}`);
  rows.push(...ids.map(id => doc(id, { ownerId: 'reader' })));
  const find = collection.find;
  context.mock.method(collection, 'find', (query: any) => {
    if (query.shareId?.$in?.includes('batch-100')) throw new Error('Synthetic later batch failure');
    return find(query);
  });
  assert.deepEqual(await getThings(viewer, ids), { ok: false, status: 503, error: 'Things read is unavailable' });
});


test('owner archive metadata and full-content list/count retain revoked, blocked and dangling parent gates', async () => {
  const own = { ...viewer, id: 'reader' };
  rows.push(comment('archived-child', { ownerId: own.id, libraryArchived: true }));
  for (const state of ['revoked', 'blocked', 'dangling']) {
    const root = rows.find(row => row.shareId === 'root');
    root.acl = state === 'revoked' ? ['tt:user'] : ['tt:all'];
    root.moderation = state === 'blocked' ? { status: 'blocked' } : undefined;
    const saved = [...rows];
    if (state === 'dangling') rows = rows.filter(row => row.shareId !== 'root');
    const result = await listThings(own, { libraryArchive: 'archived', limit: 1 }, null, { archiveOwnerId: own.id });
    assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.things, []);
    assert.deepEqual(await countThings(own, { libraryArchive: 'archived' }, null, { archiveOwnerId: own.id }), { ok: true, count: 0 });
    assert.deepEqual(await getLibraryArchiveAction(own.id, 'archived-child'), { ok: false, status: 404, error: 'Thing is not available in your library' });
    const search = await searchThings(own, { libraryArchive: 'archived', conditions: [] });
    assert.equal(search.ok, true); if (search.ok) assert.deepEqual(search.things, []);
    rows = saved;
  }
});

test('owner Archived paginates protected message cards without hydrating private source content', async () => {
  for (const id of ['message-a', 'message-b', 'message-c']) rows.push(doc(id, { ownerId: viewer.id, thingtime: ['chat-message'],
    libraryArchived: true, targetId: 'private-chat', acl: ['tt:user'], crystal: { text: 'PRIVATE', participantIds: ['PRIVATE'], name: 'PRIVATE' }, extended: { binding: 'PRIVATE' } }));
  rows.push(doc('vault', { ownerId: viewer.id, thingtime: ['password-manager-entry'], libraryArchived: true, crystal: { password: 'PRIVATE' } }));
  const context = { archiveOwnerId: viewer.id };
  const result = await listThings(viewer, { libraryArchive: 'archived', limit: 1 }, null, context);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.things.map(row => row.id), ['message-a']); assert.ok(result.nextCursor);
  assert.equal(JSON.stringify(result.things).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result.things).includes('private-chat'), false);
  assert.deepEqual(result.things[0].crystal, { name: 'Archived message' });
  const next = await listThings(viewer, { libraryArchive: 'archived', limit: 1, cursor: result.nextCursor }, null, context);
  assert.equal(next.ok, true); if (next.ok) assert.deepEqual(next.things.map(row => row.id), ['message-b']);
  assert.deepEqual(await countThings(viewer, { libraryArchive: 'archived' }, null, context), { ok: true, count: 3 });
  assert.equal(reads.some(read => read.query.thingtime === 'user'), false, 'minimal message cards never hydrate source authors');
});

test('single Archive and bulk share metadata-only placement updates with permission checks', async () => {
  const subject = doc('message', { ownerId: viewer.id, thingtime: ['chat-message'], targetId: 'private-chat', crystal: { text: 'PRIVATE' } });
  rows.push(subject);
  const writes: any[] = [];
  const fake = async () => ({ ...collection, updateOne: async (query: any, update: any) => { writes.push({ query, update }); return { matchedCount: matches(subject, query) ? 1 : 0 }; } }) as any;
  assert.equal((await getLibraryArchiveAction(viewer.id, 'message', fake)).ok, true);
  assert.deepEqual(await setLibraryArchive(viewer.id, 'message', 'archive', fake), { ok: true, id: 'message', ownerId: viewer.id, libraryArchived: true });
  assert.deepEqual(writes[0].update, { $set: { libraryArchived: true } });
  assert.equal(subject.crystal.text, 'PRIVATE'); assert.equal(subject.targetId, 'private-chat');
  assert.equal((await setLibraryArchive('foreign', 'message', 'archive', fake)).ok, false);
  assert.equal(writes.length, 1);
  const bulk = await bulkThings(viewer, { op: 'archive', ids: ['message'] }, { collection: fake }, { libraryOwnerId: viewer.id });
  assert.equal(bulk.ok, true); if (bulk.ok) assert.equal(bulk.succeeded, 1);
  assert.deepEqual(writes[1].update, writes[0].update);
});

test('structured archive search cannot match protected bodies through result existence', async () => {
  rows.push(doc('message', { ownerId: viewer.id, thingtime: ['chat-message'], libraryArchived: true, crystal: { text: 'PRIVATE BODY' } }));
  const result = await searchThings(viewer, { libraryArchive: 'archived', conditions: [{ field: 'text', op: 'contains', value: 'PRIVATE' }] });
  assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.things, []);
});
