import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetIndexCommands, indexExecutionPolicy, indexPlanFingerprint, invalidateDurableIndexPlan, recordIndexPlan, runDurableIndexPlan } from './indexLifecycle.ts';
import { createIndexReplacingForTests } from './collections.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
// Fake command adapter only; no application data is seeded outside the API.
const settingsFixture = () => {
  let row: any = null;
  let renewals = 0;
  const matches = (filter: any) => row && (!filter.owner || row.owner === filter.owner) &&
    (filter.generation === undefined || row.generation === filter.generation) &&
    (!filter.readyFingerprint || row.readyFingerprint !== filter.readyFingerprint.$ne) &&
    (!filter.$or || !row.planVersion || row.planVersion <= filter.$or[1].planVersion.$lte) &&
    (!filter.$expr || (filter.$expr.$gt ? +new Date(row.leaseUntil) > Date.now() : !row.leaseUntil || +new Date(row.leaseUntil) <= Date.now()));
  const apply = (update: any) => {
    if (Array.isArray(update)) {
      const fields = update[0].$set;
      if (fields.owner) Object.assign(row, { owner: fields.owner, planVersion: fields.planVersion, key: fields.key, readyFingerprint: null, generation: row.generation ?? 0 });
      else renewals++;
      row.leaseUntil = new Date(Date.now() + fields.leaseUntil.$add[1]);
    } else {
      Object.assign(row, update.$set);
      for (const [field, amount] of Object.entries(update.$inc || {})) row[field] = (row[field] || 0) + Number(amount);
      for (const field of Object.keys(update.$unset || {})) delete row[field];
    }
  };
  return {
    get row() { return row; }, get renewals() { return renewals; },
    replace(value: any) { row = value; },
    async findOne() { return row ? { ...row } : null; },
    async findOneAndUpdate(filter: any, update: any, options: any) {
      assert.equal(options.upsert, undefined, '$expr predicates must not be used with upsert');
      if (!matches(filter)) return null;
      apply(update);
      return { ...row };
    },
    async updateOne(filter: any, update: any, options: any = {}) {
      if (!row && options.upsert) { row = { _id: filter._id, ...update.$setOnInsert }; return { matchedCount: 0 }; }
      if (!matches(filter)) return { matchedCount: 0 };
      apply(update);
      return { matchedCount: 1 };
    }
  };
};

test('fingerprint covers physical generations, compound key order, options and maintenance context', async () => {
  const specs = await recordIndexPlan(db => [db.collection('things_v2').createIndex({ owner: 1, id: 1 }, { unique: true })]);
  const hash = indexPlanFingerprint(specs, { legacy: true });
  assert.equal(hash, indexPlanFingerprint([...specs], { legacy: true }));
  for (const changed of [[{ ...specs[0], collection: 'things_v3' }], [{ ...specs[0], keys: { id: 1, owner: 1 } }], [{ ...specs[0], options: { unique: false } }]]) {
    assert.notEqual(hash, indexPlanFingerprint(changed, { legacy: true }));
  }
  assert.notEqual(hash, indexPlanFingerprint(specs, { legacy: false }));
});

test('cold processes share one durable plan and changed plans cannot borrow readiness', async () => {
  const settings = settingsFixture();
  const entered = deferred();
  const release = deferred();
  let builds = 0;
  const first = runDurableIndexPlan({ settings, fingerprint: 'v1', run: async () => { builds++; entered.resolve(); await release.promise; } });
  await entered.promise;
  let waited = false;
  const second = runDurableIndexPlan({ settings, fingerprint: 'v1', pause: async () => { waited = true; release.resolve(); await first; }, run: async () => { builds++; } });
  await Promise.all([first, second]);
  assert.equal(waited, true);
  assert.equal(builds, 1);
  await runDurableIndexPlan({ settings, fingerprint: 'v1', run: async () => { builds++; } });
  assert.equal(builds, 1);
  await runDurableIndexPlan({ settings, fingerprint: 'v2', planVersion: 2, run: async () => { builds++; } });
  assert.equal(builds, 2);
  assert.equal(settings.row.readyFingerprint, 'v2');
  await assert.rejects(runDurableIndexPlan({ settings, fingerprint: 'v1', planVersion: 1, run: async () => assert.fail('old plan must not run') }), /newer deployment/);
});

test('failure never marks ready and retries; dead leases recover but live leases time out', async () => {
  const settings = settingsFixture();
  await assert.rejects(runDurableIndexPlan({ settings, fingerprint: 'v1', run: async () => { throw new Error('required unique index failed'); } }), /required unique/);
  assert.equal(settings.row.readyFingerprint, null);
  assert.equal(settings.row.owner, undefined);
  settings.replace({ ...settings.row, owner: 'crashed', leaseUntil: new Date(0) });
  await runDurableIndexPlan({ settings, fingerprint: 'v1', run: async () => {} });
  settings.replace({ ...settings.row, owner: 'active', leaseUntil: new Date(Date.now() + 60_000) });
  await assert.rejects(runDurableIndexPlan({ settings, fingerprint: 'v2', waitMs: 0, run: async () => assert.fail('must not run') }), /still leased/);
  assert.equal(settings.row.owner, 'active');
});

test('a lost lease cannot publish readiness or release another owner', async () => {
  const settings = settingsFixture();
  await assert.rejects(runDurableIndexPlan({ settings, fingerprint: 'v1', run: async () => {
    settings.replace({ ...settings.row, owner: 'successor', readyFingerprint: 'successor-plan' });
  } }), /lease lost/);
  assert.equal(settings.row.owner, 'successor');
  assert.equal(settings.row.readyFingerprint, 'successor-plan');
});

test('explicit invalidation fences a running completion and forces an unchanged plan to rerun', async () => {
  const settings = settingsFixture();
  await assert.rejects(runDurableIndexPlan({ settings, fingerprint: 'v1', run: async () => { await invalidateDurableIndexPlan(settings); } }), /lease lost/);
  assert.notEqual(settings.row.readyFingerprint, 'v1');
  let builds = 0;
  await runDurableIndexPlan({ settings, fingerprint: 'v1', run: async () => { builds++; } });
  await invalidateDurableIndexPlan(settings);
  await runDurableIndexPlan({ settings, fingerprint: 'v1', run: async () => { builds++; } });
  assert.equal(builds, 2);
});

test('long work renews its lease', async t => {
  // Advance the lease clock and renewal timer together; wall-clock sleeps can
  // expire a tiny synthetic lease when unrelated test workers stall the loop.
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000 });
  const settings = settingsFixture();
  await runDurableIndexPlan({ settings, fingerprint: 'v1', leaseMs: 90, commandSafetyMs: 0, run: async assertLease => {
    for (let renewal = 0; renewal < 4; renewal++) {
      t.mock.timers.tick(30);
      await tick();
    }
    await assertLease();
  } });
  assert.ok(settings.renewals >= 2);
});

test('55 index commands use two global slots and one serial lane per collection', async () => {
  let active = 0;
  let peak = 0;
  const perCollection = new Map<string, number>();
  const events: string[] = [];
  const budget = budgetIndexCommands({ collection: (name: string) => ({ async createIndex() {
    active++; peak = Math.max(peak, active);
    assert.equal(perCollection.get(name) || 0, 0);
    perCollection.set(name, 1);
    events.push(name);
    await tick();
    active--; perCollection.set(name, 0);
  } }) });
  await Promise.all(Array.from({ length: 55 }, (_, i) => budget.db.collection(i % 3 ? 'things_v2' : 'sessions_v1').createIndex({ i })));
  await budget.drain();
  assert.equal(peak, 2);
  assert.equal(events.length, 55);
});

test('absent drops can recover and stopped work drains before release', async () => {
  const release = deferred();
  const started = deferred();
  const events: string[] = [];
  const budget = budgetIndexCommands({ collection: (name: string) => ({
    async dropIndex() { throw Object.assign(new Error('absent'), { code: 27 }); },
    async createIndex() { events.push(name); if (name === 'slow') { started.resolve(); await release.promise; } }
  }) });
  await assert.rejects(budget.db.collection('things').dropIndex('absent'));
  await budget.db.collection('things').createIndex({ id: 1 });
  const slow = budget.db.collection('slow').createIndex({ id: 1 });
  await started.promise;
  budget.stop(new Error('plan failed'));
  const stopped = budget.db.collection('queued').createIndex({ id: 1 });
  await assert.rejects(stopped, /plan failed/);
  let drained = false;
  const draining = budget.drain().then(() => { drained = true; });
  await tick();
  assert.equal(drained, false);
  release.resolve();
  await Promise.all([slow, draining]);
  assert.deepEqual(events, ['things', 'slow']);
});

test('index cap and conflicting options never drop a required unique constraint', async () => {
  for (const code of [67, 85, 86]) {
    const dropped: string[] = [];
    await assert.rejects(createIndexReplacingForTests({
      async createIndex() { throw Object.assign(new Error('index conflict'), { code }); },
      async dropIndex(name: string) { dropped.push(name); }
    }, { identity: 1 }, { name: 'identity_unique', unique: true }, ['legacy_unique']));
    assert.deepEqual(dropped, []);
  }
});


test('a contender cannot claim after the observed owner completed the same plan', async () => {
  const settings = settingsFixture();
  settings.replace({ key: 'fixture', generation: 0, readyFingerprint: null, leaseUntil: new Date(0) });
  const claim = settings.findOneAndUpdate;
  let once = false;
  settings.findOneAndUpdate = async (...args) => {
    if (!once) { once = true; settings.replace({ ...settings.row, readyFingerprint: 'v1' }); }
    return claim(...args);
  };
  await runDurableIndexPlan({ settings, fingerprint: 'v1', pause: async () => {}, run: async () => assert.fail('completed plan must not run twice') });
});


test('supervised long-build budgets remain bounded relative to their renewable lease', async () => {
  const policy = indexExecutionPolicy({ commandMaxTimeMS: 180_000, leaseMs: 600_000 });
  assert.equal(policy.commandMaxTimeMS, 180_000);
  assert.throws(() => indexExecutionPolicy({ commandMaxTimeMS: 200_000, leaseMs: 600_000 }), /one third/);
  assert.throws(() => indexExecutionPolicy({ leaseMs: 30_000 }), /at least 60s/);
  const seen: any[] = [];
  const budget = budgetIndexCommands({ collection: () => ({ async createIndex(_keys: unknown, options: unknown) { seen.push(options); } }) }, async () => {}, 2, policy.commandMaxTimeMS);
  await budget.db.collection('things').createIndex({ id: 1 }, { unique: true });
  assert.deepEqual(seen, [{ unique: true, maxTimeMS: 180_000, timeoutMS: 185_000 }]);
});
