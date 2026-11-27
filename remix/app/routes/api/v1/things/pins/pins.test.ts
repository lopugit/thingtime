import assert from 'node:assert/strict';
import test from 'node:test';
import { createThingBrowserPinsHandler } from './_pins';
import { parseThingBrowserPinChange, parseThingBrowserPinPath } from '~/utils/thingBrowserPins';
import { thingBrowserPinScope, thingBrowserPinCursorClause } from '~/api/utils/things/thingBrowserPins';
import { isBillableStorageThing } from '~/api/utils/storage/storageCore';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';

const path = ['/things', 'parent-a', 'child'];
const command = { path, revision: '0', operation: 'pin', thingId: 'source' };
const req = (body: unknown = command, headers: Record<string, string> = {}) => new Request('https://pins.test/api/v1/things/pins', {
  method: 'POST', headers: { Origin: 'https://pins.test', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const fixture = (actor: unknown = { kind: 'user', user: { id: 'owner', accountKind: 'user' } }, allowed = true) => {
  const calls: unknown[] = [];
  const handler = createThingBrowserPinsHandler({ actor: async () => actor, limit: async () => ({ allowed }),
    read: async (...args: unknown[]) => { calls.push(args); return { ok: true, revision: '0', pins: [], nextCursor: null }; },
    update: async (...args: unknown[]) => { calls.push(args); return { ok: true, revision: 'new', pins: [], nextCursor: null }; }
  } as any);
  return { handler, calls };
};
test('pin identities isolate full ordered parent paths, owner, origin and content plane', () => {
  const scope = thingBrowserPinScope('https://pins.test', 'a', 'home', path);
  for (const [origin, owner, plane, next] of [
    ['https://other.test', 'a', 'home', path], ['https://pins.test', 'b', 'home', path],
    ['https://pins.test', 'a', 'custom-123', path], ['https://pins.test', 'a', 'home', ['/things', 'parent-b', 'child']],
    ['https://pins.test', 'a', 'home', ['/builder', 'parent-a', 'child']]
  ] as const) assert.notEqual(thingBrowserPinScope(origin, owner, plane, next), scope);
});
test('pin changes reject authority injection, duplicate order IDs and malformed scopes without a count cap', () => {
  for (const value of [null, [], {}, { ...command, ownerId: 'victim' }, { ...command, path: [] }, { ...command, path: ['\u0000'] },
    { ...command, operation: { toString: () => 'pin' } }, { path, revision: '0', operation: 'reorder', thingIds: ['a', 'a'] }]) assert.throws(() => parseThingBrowserPinChange(value));
  const ids = Array.from({ length: 1000 }, (_, i) => `thing-${i}`);
  assert.equal(parseThingBrowserPinChange({ path, revision: '0', operation: 'reorder', thingIds: ids }).operation, 'reorder');
  assert.deepEqual(parseThingBrowserPinPath(path), path);
});
test('pins derive viewer and origin exclusively from request and live full-user actor', async () => {
  const f = fixture(), response = await f.handler({ request: req() });
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.deepEqual(f.calls, [[{ id: 'owner' }, 'https://pins.test', command]]);
});
test('pins deny app, PAT, device, anonymous and temporary actors before dispatch', async () => {
  for (const actor of [{ kind: 'app' }, { kind: 'pat' }, { kind: 'device' }, { kind: 'anonymous' }, { kind: 'user', user: { accountKind: 'user', temporary: true } }]) {
    const f = fixture(actor); assert.equal((await f.handler({ request: req() })).status, 401); assert.equal(f.calls.length, 0);
  }
});
test('cross-origin, non-JSON, malformed and stale-plane requests cannot dispatch', async () => {
  for (const [request, status] of [[req(command, { Origin: 'https://evil.test' }), 403], [req(command, { 'Sec-Fetch-Site': 'cross-site' }), 403],
    [req(command, { 'Content-Type': 'text/plain' }), 415], [req({ ...command, ownerId: 'victim' }), 400], [req(command, { 'X-Thingtime-Expected-Data-Plane': 'home' }), 409]] as const) {
    const f = fixture();
    const response = await runWithMongoEndpoint({ url: 'mongodb://127.0.0.1/foreign' } as any, () => f.handler({ request }));
    assert.equal(response.status, status); assert.equal(f.calls.length, 0);
  }
});
test('GET forwards exact paging revision and rejects unknown/duplicate parameters', async () => {
  const f = fixture();
  const response = await f.handler({ request: new Request(`https://pins.test/api/v1/things/pins?path=${encodeURIComponent(JSON.stringify(path))}&cursor=cursor&revision=revision`) });
  assert.equal(response.status, 200); assert.deepEqual(f.calls, [[{ id: 'owner' }, 'https://pins.test', path, { cursor: 'cursor', revision: 'revision' }]]);
  for (const suffix of ['&ownerId=victim', '&path=[]']) assert.equal((await f.handler({ request: new Request(`https://pins.test/api/v1/things/pins?path=[]${suffix}`) })).status, 400);
});


test('both user-expandable pin and scope records participate in canonical storage accounting', () => {
  for (const kind of ['thing-browser-pin', 'thing-browser-pin-scope']) {
    assert.equal(isBillableStorageThing({ ownerId: 'owner', thingtime: [kind] }), true);
    assert.equal(isBillableStorageThing({ ownerId: 'owner', thingtime: [kind], storageClass: 'content' }), true);
  }
});


test('ascending pin cursor matches the shared creation index and keeps tied timestamps disjoint', () => {
  const createdAt = new Date('2026-11-13T00:00:00.000Z');
  const clause = thingBrowserPinCursorClause({ createdAt, id: 'b' });
  assert.deepEqual(clause, { $or: [{ createdAt: { $gt: createdAt } }, { createdAt, shareId: { $gt: 'b' } }] });
  const rows = ['a', 'b', 'c', 'd'].map(shareId => ({ createdAt, shareId }));
  const [newer, tie] = clause.$or as [{ createdAt: { $gt: Date } }, { createdAt: Date; shareId: { $gt: string } }];
  const after = rows.filter(row => row.createdAt > newer.createdAt.$gt || (row.createdAt === tie.createdAt && row.shareId > tie.shareId.$gt));
  assert.deepEqual(after.map(row => row.shareId), ['c', 'd']);
  assert.deepEqual([...rows.slice(0, 2), ...after].map(row => row.shareId), ['a', 'b', 'c', 'd']);
});

// The exact card reader uses the canonical archive predicate and its static
// projection, rather than letting the preference API read a protected body.
test('exact archived dedicated cards preserve owner, home and protected-body boundaries', async () => {
  const { readOwnedArchivedLibraryCard } = await import('~/api/utils/things/things');
  const doc = { shareId: 'archived-message', ownerId: 'owner', thingtime: ['chat-message'], libraryArchived: true,
    createdAt: new Date('2026-11-13T00:00:00.000Z'), updatedAt: new Date('2026-11-13T00:00:00.000Z'),
    crystal: { text: 'PRIVATE BODY', name: 'PRIVATE NAME', participantIds: ['private-person'] },
    extended: { secret: 'PRIVATE EXTENDED' }, targetId: 'private-chat', attachmentIds: ['private-media'] };
  const calls: { filter: unknown; options: unknown }[] = [];
  let selected: any = doc;
  const collection = async () => ({ findOne: async (filter: unknown, options: unknown) => { calls.push({ filter, options }); return selected; } }) as any;
  const session = { testTransaction: true };
  const card = await readOwnedArchivedLibraryCard({ id: 'owner' }, doc.shareId, session, collection);
  assert.equal(card?.id, doc.shareId); assert.deepEqual(card?.crystal, { name: 'Archived message' });
  assert.equal(card?.libraryArchivePresentation, 'metadata'); assert.equal(card?.author, null);
  assert.equal(JSON.stringify(card).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(card).includes('private-'), false);
  assert.match(JSON.stringify(calls[0].filter), /"ownerId":"owner"/);
  assert.deepEqual(calls[0].options, { session });
  for (const patch of [{ ownerId: 'other' }, { libraryArchived: false }, { appId: 'app' }, { sandbox: true },
    { sandboxSpace: 'private-space' }, { moderation: { status: 'blocked' } }, { creationCheckpoint: { phase: 'restoring' } }]) {
    selected = { ...doc, ...patch };
    assert.equal(await readOwnedArchivedLibraryCard({ id: 'owner' }, doc.shareId, undefined, collection), null, JSON.stringify(patch));
  }
  selected = doc;
  assert.equal(await readOwnedArchivedLibraryCard({ id: 'owner', pat: {} as any }, doc.shareId, undefined, collection), null);
  assert.equal(await readOwnedArchivedLibraryCard(null, doc.shareId, undefined, collection), null);
  assert.equal(await runWithMongoEndpoint({ url: 'mongodb://127.0.0.1/other' } as any, () => readOwnedArchivedLibraryCard({ id: 'owner' }, doc.shareId, undefined, collection)), null);
});


test('pin target reader cannot bypass static archive cards through an accepted generic owner envelope', async () => {
  const { createThingBrowserPinTargetReader } = await import('~/api/utils/things/thingBrowserPins');
  const { minimalLibraryArchivePresentation } = await import('~/api/utils/things/libraryArchiveEligibility');
  let source: any = { shareId: 'protected-message', ownerId: 'owner', thingtime: ['chat-message'], libraryArchived: false,
    crystal: { text: 'PRIVATE BODY', participantIds: ['private-person'] } };
  let card: any = null, deviceReads = 0, custom = false;
  const reader = createThingBrowserPinTargetReader({ source: async () => source, archivedCard: async () => card,
    customPlane: () => custom, device: async () => { deviceReads++; return false; } } as any);
  assert.equal(await reader({ id: 'owner' }, 'protected-message'), false, 'active/unavailable protected source is refused even when generic owner lookup passes');
  source = { ...source, libraryArchived: true };
  card = minimalLibraryArchivePresentation({ id: 'protected-message', thingtime: ['chat-message'], author: null, createdAt: 'date', updatedAt: 'date' });
  const target = await reader({ id: 'owner' }, 'protected-message');
  assert.deepEqual(target, { presentation: card });
  assert.equal(JSON.stringify(target).includes('PRIVATE'), false);
  assert.equal(deviceReads, 0);
  custom = true;
  assert.equal(await reader({ id: 'owner' }, 'protected-message'), false);
  custom = false; source = { ...source, thingtime: ['data'] };
  assert.deepEqual(await reader({ id: 'owner' }, 'ordinary'), {}, 'ordinary authorized source does not gain a protected body projection');
});
