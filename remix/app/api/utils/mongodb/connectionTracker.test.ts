import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createConnectionTracker, connectionDeployment } from './connectionTracker';

const deployment = { environment: 'preview', branch: 'codex/inventory', commit: 'a'.repeat(40), url: 'https://inventory.example', region: 'mel1' };
const runtimeId = '11111111-1111-4111-8111-111111111111';
const fixture = () => {
  let now = 1000;
  const tracker = createConnectionTracker({ runtimeId, now: () => now, deployment });
  const client = new EventEmitter();
  const observation = tracker.track(client, 'home', 'thingtime-api');
  const emit = (name: string, properties = {}) => client.emit(name, { address: 'home.example:27017', ...properties });
  return { tracker, observation, emit, client, tick: () => { now += 1000; } };
};

test('CMAP lifecycle counts physical sockets once and never equates pool clears with closure', () => {
  const f = fixture();
  f.emit('connectionPoolCreated', { options: { maxPoolSize: 10 } });
  f.emit('connectionPoolReady');
  f.emit('connectionCreated', { connectionId: 1 });
  f.emit('connectionCreated', { connectionId: 1 });
  f.emit('connectionCreated', { connectionId: 2 });
  f.emit('connectionReady', { connectionId: 1 });
  f.emit('connectionReady', { connectionId: 2 });
  f.emit('connectionCheckedOut', { connectionId: 1 });
  f.emit('connectionCheckedOut', { connectionId: 1 });
  let row = f.tracker.snapshot()[0];
  assert.deepEqual(row.totals, { open: 2, checkedOut: 1, created: 2, closed: 0 });
  assert.equal(row.pools[0].maxPoolSize, 10);
  f.emit('connectionPoolCleared');
  row = f.tracker.snapshot()[0];
  assert.equal(row.pools[0].cleared, 1);
  assert.equal(row.totals.open, 2, 'cleared pool generations may still have checked-out sockets');
  f.emit('connectionClosed', { connectionId: 1, reason: 'error', error: new Error('mongodb://secret') });
  f.emit('connectionCheckedIn', { connectionId: 1 });
  f.emit('connectionClosed', { connectionId: 1 });
  assert.deepEqual(f.tracker.snapshot()[0].totals, { open: 1, checkedOut: 0, created: 2, closed: 1 });
  f.emit('connectionPoolClosed');
  assert.deepEqual(f.tracker.snapshot()[0].totals, { open: 0, checkedOut: 0, created: 2, closed: 2 });
  f.client.emit('topologyClosed', {});
  assert.equal(f.tracker.snapshot()[0].status, 'closed');
  assert.ok(!JSON.stringify(f.tracker.snapshot()).includes('secret'));
});

test('restarts receive distinct identities; source and pool counters never cross runtimes or endpoints', () => {
  const first = createConnectionTracker(), second = createConnectionTracker();
  assert.notEqual(first.runtimeId, second.runtimeId);
  const f = fixture();
  const other = new EventEmitter();
  f.tracker.track(other, 'custom', 'thingtime-api-custom').ready();
  other.emit('connectionCreated', { address: 'private.customer.example:27017', connectionId: 1 });
  other.emit('connectionReady', { address: 'private.customer.example:27017', connectionId: 1 });
  f.emit('connectionCreated', { connectionId: 1 });
  f.emit('connectionReady', { connectionId: 1 });
  const rows = f.tracker.snapshot();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].pools[0].address, null);
  assert.ok(!JSON.stringify(rows).includes('private.customer'));
  assert.notEqual(rows[0].id, rows[1].id);
  f.observation.failed();
  f.tracker.pruneClosed([rows[1].id]);
  assert.equal(f.tracker.snapshot().length, 2, 'pruning only removes successfully persisted terminal sources');
  f.tracker.pruneClosed([rows[0].id]);
  assert.equal(f.tracker.snapshot().length, 1);
});

test('deployment attribution has a closed safe projection and rejects credentials/paths/query in links', () => {
  assert.deepEqual(connectionDeployment({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/work', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_URL: 'build.example', VERCEL_REGION: 'mel1', MONGODB_CONNECTION_STRING: 'mongodb://user:secret@db' }), { environment: 'preview', branch: 'codex/work', commit: 'a'.repeat(40), url: 'https://build.example', region: 'mel1', deploymentId: null });
  for (const url of ['https://user:secret@build.example', 'https://build.example?token=secret', 'https://build.example/private', 'http://build.example']) assert.equal(connectionDeployment({ VERCEL_URL: url }).url, null);
  assert.equal(connectionDeployment({ VERCEL_GIT_COMMIT_REF: 'bad\nsecret' }).branch, null);
});


test('handshake attempts stay pending until ready and failure/late closure never masquerades as open', () => {
  const f = fixture();
  f.emit('connectionCreated', { connectionId: 1 });
  let source = f.tracker.snapshot()[0];
  assert.equal(source.totals.open, 0);
  assert.equal(source.pools[0].pending, 1);
  f.emit('connectionClosed', { connectionId: 1 });
  source = f.tracker.snapshot()[0];
  assert.equal(source.pools[0].pending, 0);
  assert.equal(source.totals.closed, 1);
  f.emit('connectionCreated', { connectionId: 2 });
  f.observation.failed();
  f.emit('connectionPoolClosed');
  f.emit('connectionClosed', { connectionId: 2 });
  source = f.tracker.snapshot()[0];
  assert.equal(source.status, 'failed');
  assert.equal(source.totals.open, 0);
  assert.equal(source.totals.created, 2);
  assert.equal(source.totals.closed, 2);
});


test('server pool removal does not retire the client before topology rediscovery', () => {
  const f = fixture();
  f.observation.ready();
  f.emit('connectionPoolCreated');
  f.emit('connectionPoolReady');
  f.emit('connectionPoolClosed');
  const id = f.tracker.snapshot()[0].id;
  assert.equal(f.tracker.snapshot()[0].status, 'ready');
  f.tracker.pruneClosed([id]);
  assert.equal(f.tracker.snapshot().length, 1);
  f.emit('connectionPoolCreated');
  f.emit('connectionPoolReady');
  f.emit('connectionCreated', { connectionId: 2 });
  f.emit('connectionReady', { connectionId: 2 });
  assert.equal(f.tracker.snapshot()[0].totals.open, 1);
  f.client.emit('topologyClosed', {});
  assert.equal(f.tracker.snapshot()[0].status, 'closed');
});

test('topology model is explicitly bounded by current servers, configured mode and client lifecycle', () => {
  for (const [mode, factor] of [['poll', 1], ['stream', 2], ['auto', 2], ['load-balanced', 0]] as const) {
    const tracker = createConnectionTracker();
    const client = Object.assign(new EventEmitter(), { options: { serverMonitoringMode: mode, loadBalanced: mode === 'load-balanced' } });
    const observation = tracker.track(client, 'home', 'thingtime-api');
    client.emit('topologyDescriptionChanged', { newDescription: { servers: new Map([['secret.example:27017', {}], ['second:27017', {}]]) } });
    assert.equal(tracker.snapshot()[0].monitoring?.socketsUpperBound, null, 'connecting is not live evidence');
    observation.ready();
    assert.deepEqual(tracker.snapshot()[0].monitoring, { mode, servers: 2, socketsUpperBound: 2 * factor, basis: 'topology-model' });
    client.emit('topologyDescriptionChanged', { newDescription: { servers: new Map([['second:27017', {}]]) } });
    assert.equal(tracker.snapshot()[0].monitoring?.socketsUpperBound, factor, 'removed servers cannot inflate model');
    assert.ok(!JSON.stringify(tracker.snapshot()).includes('secret.example'));
    observation.failed();
    assert.equal(tracker.snapshot()[0].monitoring?.socketsUpperBound, null);
    client.emit('topologyClosed', {});
    assert.equal(tracker.snapshot()[0].monitoring?.socketsUpperBound, null);
  }
});

test('feature attribution is allowlisted, once per request/client, concurrent-safe and independent of socket counts', async () => {
  const { runWithMongoConnectionFeature } = await import('./connectionTracker');
  const f = fixture();
  await Promise.all(['auth', 'webpages', 'secret-user-and-query'].map(group => runWithMongoConnectionFeature(group, async () => {
    await new Promise(resolve => setImmediate(resolve));
    f.tracker.recordAccess(f.client);
    f.tracker.recordAccess(f.client);
  })));
  f.tracker.recordAccess(f.client); // background work outside the dispatcher is unattributed
  const source = f.tracker.snapshot()[0];
  assert.deepEqual(source.featureUsage?.map(row => [row.feature, row.accesses]).sort(), [['auth', 1], ['builder', 1], ['other', 1]]);
  assert.equal(source.totals.open, 0);
  assert.ok(!JSON.stringify(source).includes('secret-user'));
  source.featureUsage![0].accesses = 100;
  assert.equal(f.tracker.snapshot()[0].featureUsage![0].accesses, 1, 'snapshot mutation cannot modify tracker');
});
