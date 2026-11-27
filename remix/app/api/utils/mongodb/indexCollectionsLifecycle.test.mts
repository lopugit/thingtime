import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import { createGatewayWorkLifecycle } from '../deployment/environmentGateway';
import { withMongoRequestBudget } from './requestBudget';

let custom = false;
let selectedUri = 'mongodb://test-custom';
let selectedDb = 'one';
let marker: any = null;
let builds = 0;
let drain: (() => void) | undefined;
let connections = 0;
let markerReads = 0;
let gatewayLifecycle: ReturnType<typeof createGatewayWorkLifecycle> | undefined;
let pausedConnect: { started: () => void; wait: Promise<void> } | undefined;
let pausedIndex: { started: () => void; wait: Promise<void> } | undefined;
const databases = new Map<string, any>();
const getDb = (uri: string, databaseName: string) => {
  const key = `${uri}/${databaseName}`;
  if (!databases.has(key)) {
    const state = { fail: false, creates: 0, writes: 0, collections: [] as string[] };
    const db: any = {
      databaseName, state,
      listCollections: () => ({ toArray: async () => [] }),
      collection: (name: string) => {
        state.collections.push(name);
        return {
          async createIndex() {
            state.creates++;
            if (state.fail) throw new Error('required unique build failed');
            if (pausedIndex) { pausedIndex.started(); await pausedIndex.wait; }
            return 'index';
          },
          async dropIndex() {}, async indexes() { return []; },
          async updateMany() { return { modifiedCount: 0 }; },
          async insertOne() { state.writes++; return { insertedId: 'synthetic' }; },
          async findOne(filter: any) { if (filter._id) markerReads++; return filter.key ? { ready: true } : marker ? { ...marker } : null; },
          async findOneAndUpdate(filter: any, update: any) {
            if (!marker || (marker.owner && +marker.leaseUntil > Date.now())) return null;
            if (marker.readyFingerprint === filter.readyFingerprint.$ne) return null;
            builds++;
            const fields = update[0].$set;
            Object.assign(marker, { key: fields.key, owner: fields.owner, planVersion: fields.planVersion,
              readyFingerprint: null, generation: marker.generation || 0, leaseUntil: new Date(Date.now() + fields.leaseUntil.$add[1]) });
            return { ...marker };
          },
          async updateOne(filter: any, update: any, options: any = {}) {
            if (!marker && options.upsert) { marker = { ...update.$setOnInsert }; return { matchedCount: 0 }; }
            if (!marker || (filter.owner && marker.owner !== filter.owner) || (filter.generation !== undefined && marker.generation !== filter.generation)) return { matchedCount: 0 };
            if (Array.isArray(update)) marker.leaseUntil = new Date(Date.now() + update[0].$set.leaseUntil.$add[1]);
            else {
              Object.assign(marker, update.$set);
              for (const [key, amount] of Object.entries(update.$inc || {})) marker[key] = (marker[key] || 0) + Number(amount);
              for (const key of Object.keys(update.$unset || {})) delete marker[key];
            }
            return { matchedCount: 1 };
          },
          find: () => ({ batchSize: () => ({ async *[Symbol.asyncIterator]() {} }) }),
          async bulkWrite() { return {}; }
        };
      }
    };
    databases.set(key, db);
  }
  return databases.get(key);
};
class Client extends EventEmitter {
  readonly uri: string;
  constructor(uri: string) { super(); this.uri = uri; }
  async connect() {
    connections++;
    if (pausedConnect) { pausedConnect.started(); await pausedConnect.wait; }
  }
  async close() {}
  db(name: string) { return getDb(this.uri, name); }
}
mock.module('./mongodb', { namedExports: { getMongoDb: async () => ({ MongoClient: Client }) } });
mock.module('./config', { namedExports: { getMongoUri: () => 'mongodb://test-home' } });
mock.module('./endpoint', { namedExports: {
  isCustomMongoEndpointActive: () => custom, getActiveMongoUri: () => selectedUri, getActiveMongoDbName: () => selectedDb
} });
mock.module('../deployment/environmentGateway', { namedExports: {
  requireGatewayDatabaseAccess: async () => {
    if (gatewayLifecycle && !gatewayLifecycle.isAdmitted()) await gatewayLifecycle.withWork(async () => {});
  },
  withGatewayWork: <T>(work: () => Promise<T>) => gatewayLifecycle ? gatewayLifecycle.withWork(work) : work(),
  registerGatewayDrain: (callback: () => void) => { drain = callback; }
} });
const collections = await import('./collections');

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('auth reads remain available after unique-build failure; ordinary writes require ready indexes', async () => {
  const db = getDb('mongodb://test-home', 'thingtime');
  db.state.fail = true;
  const users = await collections.getUsersCollection();
  await users.findOne({ username: 'synthetic' });
  assert.equal(db.state.creates, 0, 'reading auth data must not require successful DDL');
  await assert.rejects(users.insertOne({ username: 'synthetic' }), /required unique/);
  assert.equal(db.state.writes, 0);
  await collections.withHomeIndexRecovery(async () => {
    const repair = await collections.getHomeThingtimeDb();
    await repair.collection('synthetic_recovery_handle').insertOne({ synthetic: true });
  });
  assert.equal(db.state.writes, 1, 'explicit internal recovery remains reachable');
  db.state.fail = false;
  await users.insertOne({ username: 'synthetic' });
  assert.equal(db.state.writes, 2);
  const successfulBuilds = builds;
  await users.insertOne({ username: 'synthetic-2' });
  assert.equal(builds, successfulBuilds, 'warm ready writes do no DDL');
  marker = null; // another process invalidates readiness before maintenance
  await users.insertOne({ username: 'synthetic-3' });
  assert.equal(builds, successfulBuilds + 1, 'warm writer observes durable invalidation');
});

test('custom constraints are awaited, scoped by URI plus DB, and failed initialization retries', async () => {
  custom = true;
  const first = getDb(selectedUri, 'one');
  first.state.fail = true;
  await assert.rejects(collections.getThingtimeDb(), /required unique/);
  first.state.fail = false;
  await collections.getThingtimeDb();
  const created = first.state.creates;
  await collections.getThingtimeDb();
  assert.equal(first.state.creates, created);
  selectedDb = 'two';
  await collections.getThingtimeDb();
  assert.ok(getDb(selectedUri, 'two').state.creates > 0);
  selectedUri = 'mongodb://another-test-custom';
  await collections.getThingtimeDb();
  assert.ok(getDb(selectedUri, 'two').state.creates > 0);
  for (const [key, db] of databases) if (!key.includes('test-home')) {
    assert.ok(db.state.collections.every((name: string) => name === 'things_v2'), 'foreign DB never receives home settings');
  }
  custom = false;
});

test('gateway demotion clears cached clients and readiness for later ownership', async () => {
  await collections.getHomeThingtimeDb();
  const before = connections;
  assert.ok(drain);
  drain();
  await collections.getHomeThingtimeDb();
  assert.equal(connections, before + 1);
});


test('one HTTP request shares one mutation admission and reads perform none', async () => {
  const users = await collections.getUsersCollection();
  // Finish first bootstrap after the preceding gateway-drain regression.
  await users.insertOne({ username: 'before-request' });
  const before = markerReads;
  await collections.withIndexReadinessRequest(async () => {
    await users.findOne({ username: 'synthetic' });
    assert.equal(markerReads, before);
    await users.insertOne({ username: 'request-a' });
    await users.insertOne({ username: 'request-b' });
    await (await collections.getUsersCollection()).insertOne({ username: 'request-c' });
  });
  assert.equal(markerReads, before + 1);
  await collections.withIndexReadinessRequest(async () => { await users.insertOne({ username: 'next-request' }); });
  assert.equal(markerReads, before + 2);
});


test('warm home handles still attribute each API feature without creating another client', async () => {
  const { mongoConnectionTracker, runWithMongoConnectionFeature } = await import('./connectionTracker');
  await collections.getUsersCollection(); // ensure the database is already warm outside a request
  const beforeConnections = connections;
  for (const feature of ['auth', 'admin', 'things']) {
    await runWithMongoConnectionFeature(feature, async () => {
      await collections.getUsersCollection();
      await collections.getHomeThingsCollection();
    });
  }
  const source = mongoConnectionTracker.snapshot().reverse().find(source => source.purpose === 'home')!;
  for (const feature of ['auth', 'admin', 'things']) {
    const usage = source.featureUsage!.find(row => row.feature === feature)!;
    assert.ok(usage, feature);
    assert.equal(usage.accesses, 1, 'repeated collection handles within one request are deduplicated');
    assert.ok(Number.isFinite(Date.parse(usage.lastUsedAt)));
  }
  assert.equal(connections, beforeConnections, 'attribution reuses the existing client');
});

for (const phase of ['connect', 'indexes'] as const) {
  test(`cancelled shared ${phase} keeps its gateway lease until initialization and cache eviction finish`, { timeout: 5000 }, async () => {
    await drain?.();
    custom = false;
    marker = null;
    getDb('mongodb://test-home', 'thingtime').state.fail = false;
    let owner = true, drains = 0, rollbackAdmitted = false;
    const lifecycle = createGatewayWorkLifecycle(async () => {
      if (!owner) throw new Error('retired owner');
    });
    gatewayLifecycle = lifecycle;
    lifecycle.registerDrain(async () => { drains++; await drain?.(); });
    const started = deferred(), finish = deferred();
    const pause = { started: started.resolve, wait: finish.promise };
    if (phase === 'connect') pausedConnect = pause;
    else pausedIndex = pause;
    const controller = new AbortController();
    const parent = await lifecycle.admit();
    const waiter = parent.run(() => withMongoRequestBudget(controller.signal, 10_000, () =>
      phase === 'connect' ? collections.getHomeThingtimeDb() : collections.ensureIndexes()));
    const rejected = assert.rejects(waiter, { name: 'AbortError' });
    let rollback: ReturnType<typeof lifecycle.admit> | undefined;
    try {
      await started.promise;
      controller.abort();
      await rejected;
      parent.end();
      owner = false;
      lifecycle.demote();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(drains, 0, 'the sole HTTP waiter ended, but initialization is still admitted');
      owner = true;
      rollback = lifecycle.admit().then(lease => { rollbackAdmitted = true; return lease; });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(rollbackAdmitted, false, 'rollback waits for the shared initializer and cache eviction');
      finish.resolve();
      const lease = await rollback;
      assert.equal(drains, 1);
      const before = connections;
      await lease.run(() => collections.getHomeThingtimeDb());
      assert.equal(connections, before + 1, 'late initialization cannot restore the retired cached client after drain');
      lease.end();
    } finally {
      finish.resolve(); controller.abort(); parent.end();
      await waiter.catch(() => {});
      (await rollback)?.end();
      pausedConnect = undefined; pausedIndex = undefined; gatewayLifecycle = undefined;
    }
  });
}
