import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createConnectionTracker, CONNECTION_SNAPSHOT_THINGTIME } from './connectionTracker';
import { buildConnectionSnapshotThing, createConnectionInventoryReader, createConnectionSnapshotPublisher, decodeConnectionInventoryCursor, projectConnectionSource, readServerConnectionTotals } from './connectionInventory';
import { EPHEMERAL_CONTROL_THINGTIMES, isProtectedThingtime } from '../../../schemas/registry';
import { CONTROL_PLANE_STORAGE_THINGTIMES } from '../storage/storageCore';

const now = Date.parse('2026-11-02T00:00:00Z');
const makeSource = () => {
  const tracker = createConnectionTracker({ runtimeId: '11111111-1111-4111-8111-111111111111', now: () => now });
  const client = new EventEmitter();
  tracker.track(client, 'home', 'thingtime-api').ready();
  client.emit('connectionPoolCreated', { address: 'home.example:27017', options: { maxPoolSize: 10 } });
  client.emit('connectionCreated', { address: 'home.example:27017', connectionId: 1 });
  client.emit('connectionReady', { address: 'home.example:27017', connectionId: 1 });
  return tracker.snapshot()[0];
};

test('snapshots are protected, non-billable home control Things using the shared expiry eligibility', () => {
  const source = makeSource(), doc = buildConnectionSnapshotThing(source, now);
  assert.equal(isProtectedThingtime([CONNECTION_SNAPSHOT_THINGTIME]), true);
  assert.ok((EPHEMERAL_CONTROL_THINGTIMES as readonly string[]).includes(CONNECTION_SNAPSHOT_THINGTIME));
  assert.ok((CONTROL_PLANE_STORAGE_THINGTIMES as readonly string[]).includes(CONNECTION_SNAPSHOT_THINGTIME));
  assert.deepEqual(doc.acl, []);
  assert.equal(doc.storageClass, 'control');
  assert.equal(doc.ownerId, 'tt:system:mongodb-connections');
  assert.equal(doc.expiresAt.getTime() - now, 24 * 60 * 60 * 1000);
});

test('stored projection strips arbitrary fields, all custom hostnames and invalid numbers without inventing zero', () => {
  const source: any = makeSource();
  source.credential = 'never-return'; source.deployment.secret = 'never-return'; source.pools[0].command = 'never-return';
  source.purpose = 'custom'; source.pools[0].address = 'tenant.private.example:27017';
  const view = projectConnectionSource(source, now + 300_000, 'different-runtime')!;
  assert.equal(view.freshness, 'stale');
  assert.equal(view.pools[0].address, null);
  assert.ok(!JSON.stringify(view).includes('never-return'));
  assert.ok(!JSON.stringify(view).includes('tenant.private'));
  source.pools[0].open = -1;
  assert.equal(projectConnectionSource(source, now, source.runtimeId), null);
  source.pools[0].open = 'unknown';
  assert.equal(projectConnectionSource(source, now, source.runtimeId), null);
});

test('publisher never accesses storage without an existing home client, coalesces and throttles ordinary requests', async () => {
  let time = now, available: unknown = null, collections = 0, writes = 0;
  const source = makeSource();
  const publish = createConnectionSnapshotPublisher({ now: () => time, snapshot: () => [source], available: async () => available,
    collection: async () => { collections++; return { bulkWrite: async () => { writes++; } }; }, pruneClosed: () => {} });
  assert.equal(await publish(), false);
  assert.equal(collections, 0, 'a proxy/cold runtime cannot create a home client for observability');
  available = {};
  assert.equal(await publish(), false, 'a failed attempt still applies backoff');
  time += 60_000;
  assert.deepEqual(await Promise.all([publish(), publish()]), [true, true]);
  assert.equal(writes, 1);
  assert.equal(await publish(), false);
  assert.equal(await publish(true), true, 'an explicit administrator refresh may request one fresh snapshot');
  assert.equal(writes, 2);
});

test('publisher captures terminal state before pruning, persists one idempotent row and contains storage failures', async () => {
  const source = { ...makeSource(), status: 'closed' as const }, pruned: string[][] = [];
  let operations: any[] = [];
  const publish = createConnectionSnapshotPublisher({ now: () => now, snapshot: () => [source], available: async () => ({}),
    collection: async () => ({ bulkWrite: async (ops: any[]) => { operations = ops; } }), pruneClosed: ids => pruned.push(ids) });
  assert.equal(await publish(), true);
  assert.deepEqual(pruned, [[source.id]]);
  assert.deepEqual(operations[0].updateOne.filter, { shareId: source.id, thingtime: CONNECTION_SNAPSHOT_THINGTIME });
  assert.equal(operations[0].updateOne.upsert, true);
  assert.equal(operations[0].updateOne.update.$set.crystal.source.status, 'closed');
  const failing = createConnectionSnapshotPublisher({ now: () => now, snapshot: () => [source], available: async () => ({}),
    collection: async () => { throw new Error('mongodb://secret'); }, pruneClosed: () => assert.fail('failed writes retain their snapshot') });
  assert.equal(await failing(), false);
});

test('optional selected-server totals preserve missing numbers and tier refusals as unknown', async () => {
  let command: any;
  const response = await readServerConnectionTotals({ admin: () => ({ command: async (cmd: any, options: any) => { command = cmd; assert.equal(options.timeoutMS, 1500); return { connections: { current: 20, available: 480 } }; } }) }, new Date(now).toISOString());
  assert.equal(command.serverStatus, 1);
  assert.equal(response.counts.serverCurrent, 20);
  assert.equal(response.counts.serverTotalCreated, null);
  assert.match(response.server.note, /not a cluster-wide total/);
  const refused = await readServerConnectionTotals({ admin: () => ({ command: async () => { throw Object.assign(new Error('mongodb://secret'), { code: 13 }); } }) }, new Date(now).toISOString());
  assert.equal(refused.server.status, 'unsupported');
  assert.equal(refused.counts.serverCurrent, null);
  assert.ok(!JSON.stringify(refused).includes('secret'));
});

test('paged shared sources retain stale observation counts and do not claim liveness after process loss', async () => {
  const source = makeSource();
  const docs = [buildConnectionSnapshotThing(source, now), buildConnectionSnapshotThing({ ...source, id: source.id.replace(/[0-9a-f]$/, 'a') }, now)];
  let query: any;
  const read = createConnectionInventoryReader({ now: () => now + 300_000, runtimeId: 'different-runtime', local: () => [], publish: async () => true,
    existingDb: async () => null, collection: async () => ({ find: (input: any) => { query = input; return { sort: () => ({ limit: () => ({ toArray: async () => docs }) }) }; } }) });
  const result = await read({ limit: 1 });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].freshness, 'stale');
  assert.equal(result.totals.observedOpen, 1);
  assert.equal(result.totals.staleSources, 1);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.totals.serverCurrent, null);
  assert.equal(query.thingtime, CONNECTION_SNAPSHOT_THINGTIME);
  const cursor = decodeConnectionInventoryCursor(result.nextCursor);
  assert.equal(cursor?.id, source.id);
  assert.throws(() => decodeConnectionInventoryCursor(Buffer.from(JSON.stringify({ at: 'invalid', id: source.id })).toString('base64url')));
  assert.throws(() => decodeConnectionInventoryCursor('not-a-cursor'));
});

test('a persisted closed source from this runtime is historical after its live tracker was pruned', async () => {
  const source = { ...makeSource(), status: 'closed' as const };
  const read = createConnectionInventoryReader({ now: () => now + 300_000, runtimeId: source.runtimeId, local: () => [], publish: async () => true,
    existingDb: async () => null, collection: async () => ({ find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [buildConnectionSnapshotThing(source, now)] }) }) }) }) });
  assert.equal((await read()).sources[0].freshness, 'stale');
});

test('publication deadline settles a request and prevents a late acquisition from writing', async () => {
  let release!: () => void, writes = 0, time = now;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const publish = createConnectionSnapshotPublisher({ now: () => time, snapshot: () => [makeSource()], available: async () => ({}),
    collection: async () => { await gate; return { bulkWrite: async () => { writes++; } }; }, pruneClosed: () => {} });
  const result = await publish();
  assert.equal(result, false);
  time += 2000;
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 0);
});

test('legacy snapshots keep absent model and feature evidence unknown; new evidence has a closed projection', () => {
  const input: any = makeSource();
  delete input.monitoring; delete input.featureUsage;
  let source = projectConnectionSource(input, now, input.runtimeId)!;
  assert.equal(source.monitoring, undefined);
  assert.equal(source.featureUsage, undefined);
  input.monitoring = { mode: 'poll', servers: 3, socketsUpperBound: 999, secret: 'never-return' };
  input.featureUsage = [{ feature: 'auth', accesses: 4, lastUsedAt: new Date(now).toISOString(), user: 'never-return' }, { feature: 'secret-user', accesses: 10, lastUsedAt: new Date(now).toISOString() }];
  input.pools[0].minPoolSize = 0; input.pools[0].maxIdleTimeMS = 60000;
  source = projectConnectionSource(input, now, input.runtimeId)!;
  assert.equal(source.monitoring?.socketsUpperBound, 3);
  assert.deepEqual(source.featureUsage, [{ feature: 'auth', accesses: 4, lastUsedAt: new Date(now).toISOString() }]);
  assert.equal(source.pools[0].maxIdleTimeMS, 60000);
  assert.ok(!JSON.stringify(source).includes('never-return'));
  input.status = 'closed';
  assert.equal(projectConnectionSource(input, now, input.runtimeId)!.monitoring?.socketsUpperBound, null);
});
