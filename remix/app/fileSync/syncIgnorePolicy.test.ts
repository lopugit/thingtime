import type { ForegroundSyncInput } from './foregroundSync';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { advanceSyncBaseline } from './checkpoint';
import { createSyncIgnorePolicy } from './syncIgnore';
import { parseFileSyncConfiguration } from './configuration';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import type { SyncEntry } from './reconcile';
import type { InventoryIdentity } from './inventoryJournal';
import type { PagedRunSpec } from './pagedRunJournal';
const file = (path: string): SyncEntry => ({ path, id: path, version: '1', kind: 'file', size: 1, sha256: 'a'.repeat(64) });
const folder = (path: string): SyncEntry => ({ path, id: path, version: '1', kind: 'folder', size: 0, sha256: null });
const id = (source: 'local' | 'remote'): InventoryIdentity => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
const access = { scope, currentScope: () => scope };
const rules = 'parent/secret/\nnode_modules/';

test('newly ignored paths are not tombstones and retain exact prior baseline stamps', () => {
 const old = [folder('parent'), folder('parent/secret'), file('parent/secret/key')], prior = { scope, entries: old.map(entry => ({ path: entry.path, local: entry, remote: entry })) };
 const observed = { scope, complete: true, entries: [] }, policy = createSyncIgnorePolicy(rules);
 const next = advanceSyncBaseline(prior, observed, observed, policy.ignored);
 assert.deepEqual(next.entries.map(pair => pair.path), ['parent', 'parent/secret', 'parent/secret/key']);
 // Production checkpoints preserve baseline ancestors too, so a protected child
 // cannot become a free-standing baseline entry when both sides omit its parent.
});

async function capture(journal: Awaited<ReturnType<typeof openSyncJournal>>, identity: InventoryIdentity, entries: SyncEntry[]) {
 const inventory = journal.inventory(access); await inventory.begin(identity); await inventory.append(identity, { ordinal: 0, entries, totalEntries: entries.length }); await inventory.seal(identity);
}
test('paged ignored descendants protect parent Trash and policy changes cannot rebind a saved run', async () => {
 const journal = await openSyncJournal(new IDBFactory(), 'ignore-policy', IDBKeyRange), local = id('local'), remote = id('remote'), beforeLocal = id('local'), beforeRemote = id('remote');
 const old = [folder('parent'), folder('parent/secret'), file('parent/secret/key')];
 for (const [identity, entries] of [[local, []], [remote, old], [beforeLocal, old], [beforeRemote, old]] as const) await capture(journal, identity, [...entries]);
 const plan = { id: 'plan', local, remote, baseline: { local: beforeLocal, remote: beforeRemote }, policy: { mode: 'two-way' as const, propagateDeletes: true }, excludedPaths: [], ignoreRules: rules };
 await journal.plans(access).build(plan); const decisions = (await journal.plans(access).read(plan)).decisions;
 assert.equal(decisions.length, 1); assert.equal(decisions[0].kind, 'conflict');
 if (decisions[0].kind === 'conflict') assert.equal(decisions[0].reason, 'excluded-descendants');
 const configuration = parseFileSyncConfiguration({ ...saved.configuration, configurationVersion: 2, mode: 'two-way', propagateDeletes: true, ignoreRules: rules });
 const run: PagedRunSpec = { id: 'run', plan, configuration };
 await journal.pagedRuns(access).begin(run);
 await assert.rejects(journal.pagedRuns(access).begin({ ...run, configuration: { ...configuration, ignoreRules: '*.other' } }), /do not match/);
 await assert.rejects(journal.plans(access).build({ ...plan, ignoreRules: 'different/' }), /changed/); journal.close();
});

test('explicit Stop allows a new ignore policy admission without erasing uncertain writes', async () => {
 const f = await foregroundFixture(); f.lose();
 await assert.rejects(runPagedForegroundCloudSync(saved, scope, f.input(), new AbortController().signal), /lost accepted/);
 const original = (await f.journal().pagedRuns(access).active())!;
 const jobs = f.journal().jobs(access), old = await jobs.admit(saved, 'old-job'), stopped = (await jobs.pause(old))!;
 const updated = { ...saved, updatedAt: '2026-10-19T02:00:00.000Z', configuration: parseFileSyncConfiguration({ ...saved.configuration, configurationVersion: 2, ignoreRules: 'node_modules/' }) };
 const next = await jobs.admit(updated, 'new-job'); assert.equal(next.id, 'new-job'); assert.equal(stopped.state, 'paused');
 const input: ForegroundSyncInput = f.input(); input.readConfiguration = async () => ({ id: saved.id, updatedAt: updated.updatedAt, crystal: updated.configuration, author: { id: scope.ownerId }, thingtime: ['file-sync'], acl: ['tt:user'] });
 await assert.rejects(runPagedForegroundCloudSync(updated, scope, input, new AbortController().signal), /different settings/);
 assert.deepEqual(await f.journal().pagedRuns(access).active(), original); assert.equal(f.creates(), 1); f.journal().close();
});

test('paged checkpoint retains ignored baseline entries and the ancestor facts they depend on', async () => {
 const journal = await openSyncJournal(new IDBFactory(), 'ignore-checkpoint', IDBKeyRange);
 const local = id('local'), remote = id('remote'), beforeLocal = id('local'), beforeRemote = id('remote');
 const old = [folder('parent'), folder('parent/secret'), file('parent/secret/key')];
 await capture(journal, local, []); await capture(journal, remote, []); await capture(journal, beforeLocal, old); await capture(journal, beforeRemote, old);
 const run: PagedRunSpec = { id: 'run', plan: { id: 'plan', local, remote, baseline: { local: beforeLocal, remote: beforeRemote }, policy: { mode: 'backup', propagateDeletes: false }, excludedPaths: [], ignoreRules: rules } };
 await journal.plans(access).build(run.plan); await journal.pagedRuns(access).prepare(run); await journal.pagedRuns(access).start(run);
 const checkpoint = journal.pagedCheckpoints(access), spec = { run, localRootId: 'local', remoteFolderId: 'cloud' }, draft = await checkpoint.begin(spec);
 await capture(journal, draft.after.local, []); await capture(journal, draft.after.remote, []);
 const done = await checkpoint.build(spec);
 assert.deepEqual((await journal.inventory(access).read(done.baseline.local)).entries, old);
 assert.deepEqual((await journal.inventory(access).read(done.baseline.remote)).entries, old); journal.close();
});
