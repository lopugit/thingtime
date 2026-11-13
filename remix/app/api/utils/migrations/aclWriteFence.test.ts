import assert from 'node:assert/strict';
import test from 'node:test';
import { createAclWriteFenceMigration } from './aclWriteFence';
import { AclWriteFenceError } from '../mongodb/aclWriteFence';
import { migrationFailureResult } from './migrationFailure';

const fixture = (initial = false) => {
  let ready = initial, custom = false, reads = 0, writes = 0;
  const migration = createAclWriteFenceMigration({ customPlane: () => custom,
    inspect: async () => { reads++; return ready; }, provision: async () => { writes++; ready = true; } });
  return { migration, counts: () => ({ reads, writes }), custom: () => { custom = true; } };
};
test('dry-run reports missing collection protection without provisioning and explains counts', async () => {
  const f = fixture();
  assert.equal(await f.migration.pending(), 1);
  const report = await f.migration.run({ dryRun: true });
  assert.equal(report.matched, 1); assert.equal(report.migrated, 0);
  assert.equal(f.counts().writes, 0);
  assert.match(report.notes.join(' '), /does not prove permission/);
});
test('provisioning uses canonical installer and lease checks; subsequent run remains idempotent', async () => {
  const f = fixture(); let checks = 0;
  const first = await f.migration.run({ dryRun: false, assertLease: async () => { checks++; } });
  assert.equal(first.migrated, 1); assert.equal(checks, 2); assert.equal(await f.migration.pending(), 0);
  const second = await f.migration.run({ dryRun: false });
  assert.equal(second.matched, 0); assert.equal(second.migrated, 0);
  assert.equal(f.counts().writes, 2, 'already-ready run still invokes canonical independent readback');
});
test('custom data plane refuses every mode before connection or DDL', async () => {
  const f = fixture(); f.custom();
  assert.equal(await f.migration.pending(), 1, 'unverified home requirement stays pending in census');
  for (const run of [() => f.migration.run({ dryRun: true }), () => f.migration.run({ dryRun: false })])
    await assert.rejects(run, (error: any) => error instanceof AclWriteFenceError && error.stage === 'selection' && error.category === 'wrong-plane');
  assert.deepEqual(f.counts(), { reads: 0, writes: 0 });
});
test('lost lease prevents provisioning and closed diagnostic remains a 503', async () => {
  const f = fixture();
  await assert.rejects(() => f.migration.run({ dryRun: false, assertLease: async () => { throw Error('lease lost'); } }), /lease lost/);
  assert.equal(f.counts().writes, 0);
  const failure = migrationFailureResult(f.migration.id, new AclWriteFenceError('modify', 'unauthorized'), 'rejected');
  assert.equal(failure.status, 503); assert.match(failure.error, /modify\/unauthorized/);
  assert.equal(failure.outcome, 'rejected');
});

test('denied metadata inspection preserves recovery census but explicit dry-run exposes closed failure', async () => {
  const migration = createAclWriteFenceMigration({ customPlane: () => false,
    inspect: async () => { throw new AclWriteFenceError('inspect', 'unauthorized'); },
    provision: async () => assert.fail('inspection denial must not attempt DDL') });
  assert.equal(await migration.pending(), 1);
  await assert.rejects(() => migration.run({ dryRun: true }), /inspect\/unauthorized/);
});
