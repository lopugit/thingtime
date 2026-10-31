import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION, USER_STORAGE_ACCOUNTING_VERSION } from '../../../schemas/registry';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { createUserStorageRecoveryWorker, userStorageRecoveryJobIsTrusted } from './userStorageRecovery';

const valueAt = (doc: any, path: string) => path.split('.').reduce((value, key) => value?.[key], doc);
const matches = (doc: any, filter: any) => !!doc && Object.entries(filter).every(([key, expected]: [string, any]) => {
  const value = valueAt(doc, key);
  return expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date) && '$gt' in expected
    ? value > expected.$gt : isDeepStrictEqual(value, expected);
});
const change = (doc: any, update: any) => {
  for (const [operator, fields] of Object.entries(update)) for (const [path, value] of Object.entries(fields as any)) {
    const parts = path.split('.');
    const leaf = parts.pop()!;
    const target = parts.reduce((obj, key) => obj[key] ??= {}, doc);
    if (operator === '$unset') delete target[leaf];
    else if (operator === '$inc') target[leaf] = (target[leaf] ?? 0) + Number(value);
    else target[leaf] = structuredClone(value);
  }
};
const setup = () => {
  let doc: any = null;
  let ledger: any = null;
  let timestamp = Date.parse('2026-10-29T00:00:00Z');
  let counter = 0;
  let calls = 0;
  const writes: { filter: any; options: any }[] = [];
  let recover: (owner: string, options: any) => Promise<any> = async (_owner, options) => { await options.assertLease({ transaction: true }); return { state: 'ready', stamped: 0 }; };
  const collection = {
    findOne: async (filter: any) => filter.thingtime === 'subscription' ? structuredClone(ledger) : matches(doc, filter) ? structuredClone(doc) : null,
    insertOne: async (row: any, options: any) => { assert.ok(options.session); assert.equal(doc, null); doc = structuredClone(row); return { insertedId: 'job' }; },
    updateOne: async (filter: any, update: any, options?: any) => {
      writes.push({ filter: structuredClone(filter), options });
      if (!matches(doc, filter)) return { matchedCount: 0 };
      change(doc, update); return { matchedCount: 1 };
    },
    findOneAndUpdate: async (filter: any, update: any) => {
      if (!matches(doc, filter)) return null;
      change(doc, update); return structuredClone(doc);
    }
  };
  const worker = createUserStorageRecoveryWorker({ collection: async () => collection, now: () => new Date(timestamp), leaseId: () => `lease-${++counter}`,
    recover: async (owner, options) => { calls++; return recover(owner, options); } });
  return { worker, writes, setLedger: (value: any) => { ledger = value; }, get doc() { return doc; }, get calls() { return calls; }, advance: (ms: number) => { timestamp += ms; },
    recover: (fn: typeof recover) => { recover = fn; }, session: { transaction: true } };
};

test('enqueue is durable and idempotent per account; lease writes share recovery transaction', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  await fixture.worker.ensure('owner', fixture.session);
  assert.equal(fixture.doc.crystal.generation, 2);
  assert.equal(userStorageRecoveryJobIsTrusted(fixture.doc), true);
  assert.equal(await fixture.worker.run('owner'), 'ready');
  assert.equal(fixture.doc.crystal.status, 'ready');
  const touch = fixture.writes.find(write => write.options?.session && write.filter['crystal.leaseId']);
  assert.ok(touch, 'each census/source transaction writes exact live lease');
  assert.ok(touch.filter['crystal.leaseUntil'].$gt instanceof Date);
  assert.equal(await fixture.worker.run('owner'), 'skipped');
  assert.equal(fixture.calls, 1);
});

test('a concurrent second claimant skips while the first owns its lease', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  fixture.recover(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { state: 'ready', stamped: 0 }; });
  const running = fixture.worker.run('owner');
  await started;
  assert.equal(await fixture.worker.run('owner'), 'skipped');
  release();
  assert.equal(await running, 'ready');
  assert.equal(fixture.calls, 1);
});

test('expired/crashed lease can be reclaimed and its old worker cannot touch or finish', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  fixture.recover(async (_owner, options) => { entered(); await new Promise<void>(resolve => { release = resolve; }); await options.assertLease(fixture.session); return { state: 'ready', stamped: 0 }; });
  const stale = fixture.worker.run('owner');
  await started;
  fixture.advance(60_001);
  fixture.recover(async (_owner, options) => { await options.assertLease(fixture.session); return { state: 'ready', stamped: 1 }; });
  assert.equal(await fixture.worker.run('owner'), 'ready');
  release();
  assert.equal(await stale, 'skipped');
  assert.equal(fixture.doc.crystal.status, 'ready');
  assert.equal(fixture.doc.crystal.revision, 1);
});

test('work queued after the source census cannot be overwritten by completion', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  fixture.recover(async (_owner, options) => {
    await options.assertLease(fixture.session);
    await fixture.worker.ensure('owner', fixture.session);
    return { state: 'ready', stamped: 0 };
  });
  assert.equal(await fixture.worker.run('owner'), 'pending');
  assert.equal(fixture.doc.crystal.status, 'queued');
  assert.equal(fixture.doc.crystal.generation, 2);
});

test('bounded passes persist source cursor; successful final pass clears it', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  fixture.recover(async (_owner, options) => {
    assert.equal(options.maxDocuments, 100);
    assert.equal(options.afterShareId, undefined);
    return { state: 'pending', stamped: 100, afterShareId: 'last-processed-source' };
  });
  assert.equal(await fixture.worker.run('owner'), 'pending');
  assert.equal(fixture.doc.crystal.afterShareId, 'last-processed-source');
  assert.equal(await fixture.worker.run('owner'), 'skipped');
  fixture.advance(1_001);
  fixture.recover(async (_owner, options) => {
    assert.equal(options.afterShareId, 'last-processed-source');
    return { state: 'ready', stamped: 1 };
  });
  assert.equal(await fixture.worker.run('owner'), 'ready');
  assert.equal(fixture.doc.crystal.afterShareId, undefined);
});

test('transient failures back off and stop after five attempts without retaining raw errors', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  fixture.recover(async () => { throw new Error('sensitive-driver-url-that-must-never-be-persisted'); });
  for (let index = 0; index < 5; index++) {
    assert.equal(await fixture.worker.run('owner'), index === 4 ? 'blocked' : 'pending');
    assert.equal(await fixture.worker.run('owner'), 'skipped');
    fixture.advance(61 * 60_000);
  }
  assert.equal(fixture.calls, 5);
  assert.equal(fixture.doc.crystal.lastReason, 'retry-exhausted');
  assert.equal(JSON.stringify(fixture.doc).includes('sensitive-driver'), false);
  await fixture.worker.ensure('owner', fixture.session);
  assert.equal(fixture.doc.crystal.status, 'blocked', 'new mutations cannot reset failed retry budget');
});

test('invalid job envelopes are neither claimed nor silently overwritten', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  fixture.doc.acl.push('public');
  assert.equal(await fixture.worker.run('owner'), 'skipped');
  await assert.rejects(fixture.worker.ensure('owner', fixture.session), /job is invalid/);
  assert.equal(fixture.calls, 0);
});

test('schema/invalid-source recovery refuses remain explicit blocked jobs', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  fixture.recover(async () => ({ state: 'blocked', stamped: 0, reason: 'schema-migration-required' }));
  assert.equal(await fixture.worker.run('owner'), 'blocked');
  assert.equal(fixture.doc.crystal.lastReason, 'schema-migration-required');
  assert.equal(userStorageRecoveryJobIsTrusted(fixture.doc), true);
});


test('blocked retries rearm only after a newer trusted exact reconciliation baseline', async () => {
  const fixture = setup();
  const baseline = new Date('2026-10-28T00:00:00Z');
  const ledger = {
    shareId: subscriptionShareId('user', 'owner'), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: ['subscription'], ownerId: 'owner', acl: [ACL_OWNER], targetId: null, tags: [],
    storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION, createdAt: baseline, updatedAt: baseline,
    crystal: {
      quotaKind: 'subscription', subjectType: 'user', subjectId: 'owner', tier: 'free', tierVersionId: 'free-v1',
      tierVersion: 1, tierName: 'Free', tierMetered: false, tierQuotas: { appStorageBytes: 1, userStorageBytes: null, maxApps: 1, maxPats: 1 },
      overrides: null, note: null, updatedBy: null, isDefaultAssignment: true,
      storageUsedBytes: 1, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
      storageLedgerStatus: 'needs-reconcile', storageReconciledAt: baseline
    }
  };
  fixture.setLedger(ledger);
  await fixture.worker.ensure('owner', fixture.session);
  fixture.recover(async () => ({ state: 'blocked', stamped: 0, reason: 'schema-migration-required' }));
  assert.equal(await fixture.worker.run('owner'), 'blocked');
  await fixture.worker.ensure('owner', fixture.session);
  assert.equal(fixture.doc.crystal.status, 'blocked');
  ledger.crystal.storageReconciledAt = new Date('2026-10-29T00:00:01Z');
  ledger.acl.push('public');
  await fixture.worker.ensure('owner', fixture.session);
  assert.equal(fixture.doc.crystal.status, 'blocked', 'an invalid envelope cannot rearm operational authority');
  ledger.acl.pop();
  await fixture.worker.ensure('owner', fixture.session);
  assert.equal(fixture.doc.crystal.status, 'queued');
  assert.equal(fixture.doc.crystal.attempts, 0);
  assert.equal(fixture.doc.crystal.lastReason, undefined);
  assert.equal(fixture.doc.crystal.baselineReconciledAt.getTime(), ledger.crystal.storageReconciledAt.getTime());
});

test('scheduler deadline bounds a pass and stops admissions after its run budget', async () => {
  const fixture = setup();
  await fixture.worker.ensure('owner', fixture.session);
  const expired = Date.parse('2026-10-28T00:00:00Z');
  assert.equal(await fixture.worker.run('owner', expired), 'skipped');
  assert.equal(fixture.calls, 0);
  const remainingDeadline = Date.parse('2026-10-29T00:00:02Z');
  fixture.recover(async (_owner, options) => {
    assert.equal(options.deadlineAt, remainingDeadline, 'core receives the smaller overall scheduler deadline');
    return { state: 'ready', stamped: 0 };
  });
  assert.equal(await fixture.worker.run('owner', remainingDeadline), 'ready');
});
