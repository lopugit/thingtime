import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { LocalAlgorithms } from './algorithms';
import { LocalThings } from './things';
import { LocalTimeline, recordLocalThingChanges } from './timeline';
import { LocalTimelineVersions } from './timelineVersions';
import { AccountAlgorithmSync, type AccountAlgorithmSnapshot } from './accountAlgorithms';
import { AccountThingSync } from './accountSync';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { AccountTimelineVersions } from './accountTimelineVersions';
import { algorithmVersionWriter } from './algorithmVersions';
import { algorithmContentValue } from '../timeline/algorithmContent';
import { parseTimelineVersionExport } from '../timeline/exportVersion';
import { historyContent } from '../timeline/browserModel';
import { parsePublishedVersionPreview, type VersionRequest } from '../timeline/publishedVersion';
import { parseTimelineEvent, parseTimelineEntry, type TimelineEvent } from '../timeline/contract';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { TimelineSync } from '../timeline/sync';

const anonymous = { kind: 'anonymous' } as const;
const account = { kind: 'account', ownerId: 'algorithm-owner', origin: 'https://algorithm-history.test', dataPlane: 'home' } as const;
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
const query = (thingId: string) => ({ thingId, before: null, after: null, limit: 40 });

function fixture(activeLease = lease) {
	const db = new WorkspaceDatabase(new IDBFactory());
	const algorithms = new LocalAlgorithms(db, activeLease), things = new LocalThings(db, anonymous, activeLease);
	const history = new LocalTimeline(db, activeLease, 'https://algorithm-history.test');
	const versions = new LocalTimelineVersions(db, activeLease, things, undefined, [algorithmVersionWriter(algorithms)]);
	return { db, algorithms, things, history, versions,
		head: async (id: string) => (await history.page(query(id))).entries.find(row => row.event.mode === 'revision')!.event };
}

async function preview(versions: LocalTimelineVersions | AccountTimelineVersions, event: TimelineEvent, mode: VersionRequest['mode'] = 'restore', choices = {}) {
	const request: VersionRequest = { command: 'preview-version', eventId: event.id, mode, componentMode: 'recorded', choices, componentChoices: {} };
	const result = await versions.request(request);
	assert.ok('preview' in result);
	const checked = parsePublishedVersionPreview(result.preview, event.id, event.thingId, request);
	return { preview: checked, apply: { ...request, command: 'apply-version', operationId: randomUUID(), expectedHeadId: checked.expectedHeadId,
		expectedComponents: checked.components!.fingerprint } as VersionRequest };
}

test('algorithm History captures validated profiles, training, library edits and deletions without observation or authority data', async t => {
	const f = fixture(); t.after(() => f.db.close());
	const { algorithm } = await f.algorithms.create({ name: 'Reading', description: 'Private note' });
	await f.algorithms.setActive(algorithm.id);
	await f.algorithms.observePublicPosts([{ id: 'observed', type: 'text', tags: ['books'], author: { id: 'writer' }, createdAt: new Date().toISOString() }]);
	assert.equal((await f.history.page(query(algorithm.id))).entries.length, 1);
	await f.algorithms.track({ algorithmId: algorithm.id, events: [{ thingId: 'observed', signal: 'react' }] });
	const trained = await f.head(algorithm.id);
	assert.equal(algorithmContentValue(trained.after!).crystal.eventCount, 1);
	assert.deepEqual(historyContent(trained.after)?.kinds, ['feed-algorithm']);
	assert.ok(!JSON.stringify(trained).includes('observed'));
	const archive = await f.history.exportVersion(trained.id);
	assert.equal(parseTimelineVersionExport(archive, { ownerId: trained.ownerId, id: trained.id }).content.adapter, 'algorithm-content');
	const tampered = JSON.parse(JSON.stringify(archive)); (tampered.export.content.value as any).crystal.name = 'Changed';
	assert.throws(() => parseTimelineVersionExport(tampered, { ownerId: trained.ownerId, id: trained.id }), /algorithm export/);
	await f.things.renameLibrary({ id: algorithm.id, displayTitle: 'Library alias' });
	const imported = await f.things.import((await f.things.export([algorithm.id])).manifest);
	assert.equal((await f.history.page(query(imported.roots[0]))).entries.length, 1);
	await f.algorithms.remove(algorithm.id);
	assert.deepEqual((await f.history.page(query(algorithm.id))).entries.map(row => row.event.operation), ['delete', 'update', 'update', 'create']);
});

test('algorithm restore preserves current library metadata and selection, with exact retry after later edits', async t => {
	const f = fixture(); t.after(() => f.db.close());
	const { algorithm } = await f.algorithms.create({ name: 'Original' }), first = await f.head(algorithm.id);
	await f.algorithms.update({ id: algorithm.id, name: 'New' });
	const folder = await f.things.create({ thingtime: ['folder'], crystal: { name: 'Profiles' } });
	await f.things.move([algorithm.id], folder.id);
	await f.things.renameLibrary({ id: algorithm.id, displayTitle: 'Current alias' });
	await f.algorithms.setActive('new');
	const p = await preview(f.versions, first), result = await f.versions.request(p.apply);
	assert.ok('entry' in result);
	const row = await f.things.get(algorithm.id);
	assert.equal(row.crystal.name, 'Original'); assert.equal(row.crystal.title, 'Current alias'); assert.equal(row.folderId, folder.id);
	assert.equal((await f.algorithms.list()).activeAlgorithmId, 'new');
	await f.algorithms.update({ id: algorithm.id, name: 'Later' });
	assert.deepEqual(await f.versions.request(p.apply), result);
	assert.equal((await f.things.get(algorithm.id)).crystal.name, 'Later');
	await assert.rejects(f.versions.request({ ...p.apply, operationId: randomUUID() }), /changed/);
	await assert.rejects(f.versions.request({ ...p.apply, mode: 'merge' }), /already used/);
});

test('algorithm undo and three-way merge preserve independent edits and require fresh conflict choices', async t => {
	const f = fixture(); t.after(() => f.db.close());
	const { algorithm } = await f.algorithms.create({ name: 'Original', emoji: '🧠' }), base = await f.head(algorithm.id);
	await f.algorithms.update({ id: algorithm.id, name: 'First edit' }); const edited = await f.head(algorithm.id);
	await f.algorithms.update({ id: algorithm.id, emoji: '📚' });
	await f.versions.request((await preview(f.versions, edited, 'undo')).apply);
	assert.equal((await f.things.get(algorithm.id)).crystal.name, 'Original');
	assert.equal((await f.things.get(algorithm.id)).crystal.emoji, '📚');
	await assert.rejects(preview(f.versions, edited, 'undo'), /Nothing to undo/);
	await f.algorithms.update({ id: algorithm.id, name: 'Competing edit' });
	const conflict = await preview(f.versions, edited, 'undo');
	assert.equal(conflict.preview.conflicts.length, 1);
	await assert.rejects(f.versions.request(conflict.apply), /overlapping/);
	await f.versions.request((await preview(f.versions, edited, 'undo', { '["crystal","name"]': 'incoming' })).apply);
	const draft = parseTimelineEvent({ ...base, id: randomUUID(), operationId: randomUUID(), mode: 'draft', operation: 'update', parentIds: [base.id],
		before: base.after, after: { ...base.after!, value: { ...(base.after!.value as any), crystal: { ...(base.after!.value as any).crystal, description: 'Branch detail' } } } });
	await f.history.push(draft);
	await f.versions.request((await preview(f.versions, draft, 'merge')).apply);
	assert.equal((await f.things.get(algorithm.id)).crystal.description, 'Branch detail');
	assert.equal((await f.things.get(algorithm.id)).crystal.emoji, '📚');
});

test('algorithm History refuses deleted recovery, forged protected kinds and retired identity', async t => {
	let active = true;
	const f = fixture({ assertCurrent() { if (!active) throw Error('Retired identity'); }, onInvalidate: () => () => {} }); t.after(() => f.db.close());
	const { algorithm } = await f.algorithms.create({ name: 'Original' }), base = await f.head(algorithm.id);
	await assert.rejects(f.things.update({ id: algorithm.id, crystal: { name: 'Generic bypass' } }), /dedicated/);
	await f.algorithms.remove(algorithm.id);
	await assert.rejects(f.versions.request({ command: 'preview-version', mode: 'restore', eventId: base.id, recover: true }), /own editor/);
	const row = { id: 'forged', thingtime: ['feed-algorithm', 'user'], crystal: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1 };
	await f.db.transaction(anonymous, 'readwrite', lease, tx => recordLocalThingChanges(tx, new Map([[row.id, { before: null, after: row }]]), () => row.updatedAt, randomUUID));
	assert.deepEqual((await f.history.page(query(row.id))).entries, []);
	active = false;
	await assert.rejects(preview(f.versions, base), /Retired identity/);
});

test('algorithm content, selection and History roll back together when History cannot persist', async t => {
	const f = fixture(); t.after(() => f.db.close());
	const { algorithm } = await f.algorithms.create({ name: 'Retained' }); await f.algorithms.setActive(algorithm.id);
	const first = await f.head(algorithm.id);
	await f.algorithms.update({ id: algorithm.id, name: 'Changed' });
	const plan = await preview(f.versions, first);
	const content = await f.algorithms.list(), history = await f.history.page(query(algorithm.id));
	const transaction = f.db.transaction.bind(f.db);
	f.db.transaction = ((scope, mode, lease, run) => transaction(scope, mode, lease, tx => run({ ...tx,
		put: async (collection, id, value) => { if (collection === 'timeline-events') throw Error('History quota'); return tx.put(collection, id, value); }
	}))) as typeof f.db.transaction;
	await assert.rejects(f.algorithms.remove(algorithm.id), /History quota/);
	await assert.rejects(f.versions.request(plan.apply), /History quota/);
	assert.deepEqual(await f.algorithms.list(), content); assert.deepEqual(await f.history.page(query(algorithm.id)), history);
});

test('account algorithm restore stays device-authored and independent of content synchronization and account selection', async t => {
	const factory = new IDBFactory(), db = new WorkspaceDatabase(factory), backend = new IndexedDbTimelineBackend(factory);
	t.after(async () => { await backend.close(); await db.close(); });
	const algorithms = new AccountAlgorithmSync(db, account, lease), sync = new AccountThingSync(db, account, lease, undefined, undefined, undefined, undefined, algorithms);
	const history = new AccountTimeline(db, account, lease), store = new AccountTimelineStore(accountTimelineScope(account), backend, history);
	const versions = new AccountTimelineVersions(db, account, lease, sync.things, store, [algorithmVersionWriter(algorithms.algorithms, true)]);
	const stamp = new Date().toISOString();
	const remote: AccountAlgorithmSnapshot = { id: 'remote-profile', version: 'algorithm-state-v1:' + '1'.repeat(64),
		content: { name: 'Remote', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null },
		description: '', parentId: 'lineage', shared: true, listed: true, folderId: null, legacy: false, createdAt: stamp, updatedAt: stamp };
	await algorithms.remember([remote], await algorithms.beginRead()); assert.deepEqual(await history.rows(), []);
	await algorithms.algorithms.update({ id: remote.id, name: 'Device first' }); const first = (await store.pending())[0];
	await algorithms.algorithms.update({ id: remote.id, name: 'Device second' });
	await algorithms.algorithms.setActive('new');
	const p = await preview(versions, first), result = await versions.request(p.apply); assert.ok('entry' in result);
	assert.equal(result.entry.receipt, null); assert.equal(result.entry.event.mode, 'draft'); assert.equal(result.entry.event.source, 'client');
	assert.equal((await algorithms.list()).algorithms[0].name, 'Device first');
	assert.equal((await algorithms.list()).activeAlgorithmId, 'new');
	const state = (await algorithms.status())[0]; assert.equal(state.base?.shared, true); assert.equal(state.base?.listed, true); assert.equal(state.base?.parentId, 'lineage');
	const before = await history.rows();
	await algorithms.sync({ snapshot: async () => [remote], write: async () => { throw Error('Offline'); } });
	assert.deepEqual(await history.rows(), before, 'content failure does not add or acknowledge History');
	await db.close(); assert.equal((await algorithms.list()).algorithms[0].name, 'Device first');
	assert.deepEqual(await versions.request(p.apply), result);
	let position = 0;
	const sender = new TimelineSync(store, {
		push: async event => parseTimelineEntry({ event, receipt: { formatVersion: 1, eventId: event.id, ownerId: account.ownerId, position: ++position, acceptedAt: stamp } }),
		page: async () => ({ entries: [], nextBefore: null, nextAfter: null })
	});
	assert.equal(await sender.pushPending(), 3);
	assert.equal((await store.pending()).length, 0);
	assert.notEqual((await algorithms.status())[0].state, 'synced', 'History receipts cannot acknowledge algorithm content');
});
