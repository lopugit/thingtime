import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let rows: any[] = [], reads: any[] = [], aggregates: any[] = [], custom = false, actor: any = { kind: 'anonymous' };
const value = (row: any, key: string) => key.split('.').reduce((v, part) => v?.[part], row);
const equal = (actual: any, expected: any): boolean => expected === null ? actual == null :
  expected instanceof Date ? +actual === +expected : Array.isArray(expected) ? JSON.stringify(actual) === JSON.stringify(expected) :
  Array.isArray(actual) ? actual.includes(expected) : actual === expected;
const matches = (row: any, query: any): boolean => Object.entries(query).every(([key, expected]: any) => {
  if (key === '$and') return expected.every((q: any) => matches(row, q));
  if (key === '$or') return expected.some((q: any) => matches(row, q));
  const actual = value(row, key);
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) return Object.entries(expected).every(([op, test]: any) => {
    if (op === '$in') return test.some((item: any) => equal(actual, item));
    if (op === '$nin') return !test.some((item: any) => equal(actual, item));
    if (op === '$exists') return (actual !== undefined) === test;
    if (op === '$ne') return !equal(actual, test);
    if (op === '$lt') return actual < test;
    if (op === '$gt') return actual > test;
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
    const cursor = { project: (_projection: any) => cursor, sort: (sort: any) => { record.sort = sort; return cursor; }, limit: (limit: number) => { record.limit = limit; return cursor; },
      toArray: async () => {
        const result = rows.filter(row => matches(row, query));
        return (record.sort ? sortRows(result, record.sort) : result).slice(0, record.limit);
      } };
    return cursor;
  },
  aggregate: (pipeline: any[]) => {
    aggregates.push(pipeline);
    assert.equal(pipeline.length, 3, 'no graph/reply/count hydration is permitted');
    const top = pipeline[2].$group.docs.$topN;
    assert.equal(top.n, 26);
    return { toArray: async () => {
      const groups = new Map<string, any[]>();
      for (const row of rows.filter(row => matches(row, pipeline[0].$match))) groups.set(row.targetId, [...(groups.get(row.targetId) || []), row]);
      return [...groups].map(([id, docs]) => ({ _id: id, docs: sortRows(docs.map(doc => ({ ...doc, discussionAttachmentOrder: Number.isSafeInteger(doc.attachmentSortIndex) && doc.attachmentSortIndex >= 0 ? doc.attachmentSortIndex : Number.MAX_SAFE_INTEGER })), top.sortBy).slice(0, top.n) }));
    } };
  }
};
mock.module('../mongodb/collections', { namedExports: { getThingsCollection: async () => collection, getHomeThingsCollection: async () => collection, getUsersCollection: async () => collection, withMongoTransaction: async () => { throw new Error('No writes'); } } });
mock.module('../mongodb/legacyThingLayout', { namedExports: { legacyThingReadsRequired: async () => false } });
mock.module('../mongodb/endpoint', { namedExports: { isCustomMongoEndpointActive: () => custom } });
mock.module('../auth/resolveActor', { namedExports: { resolveActor: async () => actor, actorUser: () => null, actorPat: () => null, actorCors: () => ({}) } });
mock.module('../rateLimit/enforce', { namedExports: { enforceRateLimit: async () => ({ allowed: false }), rateLimitedResponseInit: () => ({ status: 429 }), getRequestIp: () => null } });
const { listThings, getThing } = await import('./things');
const { loader } = await import('../../../routes/api/v1/things/_things.tsx');
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
  assert.equal(aggregates.length, 1); assert.deepEqual(aggregates[0][0].$match.$and[1].$or.map((row: any) => row.targetId), ['visible']);
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

test('attachment hydration is bounded per source, owner/purpose/ACL/moderation fenced and strips private storage metadata', async () => {
  rows.push(comment('with-files'));
  const file = (id: string, extra: any = {}) => doc(id, { thingtime: ['attachment'], targetId: 'with-files', acl: ['tt:inherit'], attachmentPurpose: 'comment', attachmentState: 'ready',
    crystal: { name: 'file.png', contentType: 'image/png', size: 1, mediaKind: 'image' }, objectKey: 'never-public', uploadId: 'private-upload', ...extra });
  for (let i = 0; i < 30; i++) rows.push(file(`file-${String(i).padStart(2, '0')}`, { attachmentSortIndex: i }));
  rows.push(file('foreign', { ownerId: 'stranger' }), file('private', { acl: ['tt:user'] }), file('wrong-purpose', { attachmentPurpose: 'post' }), file('blocked-file', { moderation: { status: 'blocked' } }));
  const result = await page(); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.comments![0].attachments.length, 25); assert.equal(result.comments![0].attachmentsTruncated, true);
  assert.equal(result.things[0].attachments?.length, 25); assert.equal(aggregates.length, 1);
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
  assert.equal(reads.filter(read => read.query.thingtime === 'user').length, 1); assert.equal(aggregates.length, 1);
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
