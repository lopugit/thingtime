import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalAlgorithms } from './algorithms';
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { applyEventsToWeights, emptyWeights } from '../api/utils/things/feedRanking';
import { validateTransfer } from '../utils/thingTransfer/format';
import { algorithmTransferContent, validateTransferAlgorithm } from '../utils/thingTransfer/algorithm';
import { MAX_SAVED_ALGORITHMS } from '../api/utils/algorithms/algorithmContent';

const fixture = () => {
	const db = new WorkspaceDatabase(new IDBFactory()); const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
	return { db, algorithms: new LocalAlgorithms(db, lease), things: new LocalThings(db, { kind: 'anonymous' }, lease) };
};
const posts = [{ id: 'first', type: 'text', tags: ['art'], author: { id: 'author' }, createdAt: '2026-10-16T00:00:00.000Z' },
	{ id: 'second', type: 'image', tags: ['photo'], author: { id: 'other' }, createdAt: '2026-10-16T00:00:00.000Z' }];
test('local algorithms train and rank with canonical maths and round-trip without authority or lineage', async () => {
	const { db, algorithms, things } = fixture();
	try {
		await algorithms.observePublicPosts(posts);
		const created = (await algorithms.create({ name: ' Art ', description: 'Local notes' })).algorithm;
		await algorithms.setActive(created.id);
		const events = [{ thingId: 'first', signal: 'react' as const }, { thingId: 'unknown', signal: 'view' as const }];
		const trained = await algorithms.track({ algorithmId: created.id, events });
		assert.equal(trained.applied, 1); assert.equal(trained.eventCount, 1);
		const expected = applyEventsToWeights(emptyWeights(), events, new Map([['first', { type: 'text', tags: ['art'], ownerId: 'author', createdAt: new Date(posts[0].createdAt) }]]));
		const exported = (await things.export([created.id])).manifest;
		validateTransfer(exported); validateTransferAlgorithm(exported.things[0]);
		assert.deepEqual(exported.things[0].crystal.weights, expected.weights);
		assert.equal(exported.things[0].crystal.description, undefined);
		assert.equal(exported.things[0].crystal.parentId, undefined);
		assert.equal(JSON.stringify(exported).includes('shared'), false);
		assert.deepEqual((await algorithms.rankPage(created.id, [...posts].reverse())).map(post => post.id), ['first','second']);
		const branch = (await algorithms.create({ name: 'Branch', branchFrom: created.id })).algorithm;
		assert.equal(branch.parentId, created.id); assert.equal(branch.eventCount, 0); assert.equal(branch.shared, false);
		await algorithms.track({ algorithmId: branch.id, events: [{ thingId: 'second', signal: 'share' }] });
		assert.deepEqual((await things.export([created.id])).manifest.things[0].crystal.weights, expected.weights);
		const imported = await things.import(exported);
		assert.notEqual(imported.roots[0], created.id); assert.equal((await algorithms.list()).activeAlgorithmId, created.id);
		assert.deepEqual((await things.export(imported.roots)).manifest.things[0].crystal, exported.things[0].crystal);
		await assert.rejects(things.update({ id: created.id, crystal: { name: 'Generic bypass' } }), /dedicated/);
		const current = (await algorithms.list()).algorithms.find(row => row.id === created.id)!;
		await algorithms.update({ id: created.id, name: 'Renamed', expectedUpdatedAt: current.updatedAt });
		await assert.rejects(algorithms.update({ id: created.id, name: 'Stale', expectedUpdatedAt: current.updatedAt }), /changed in another editor/);
		await algorithms.remove(created.id); assert.equal((await algorithms.list()).activeAlgorithmId, null);
	} finally { await db.close(); }
});

test('local algorithms reject publication, foreign branching and malicious transfer content atomically', async () => {
	const { db, algorithms, things } = fixture();
	try {
		await assert.rejects(algorithms.create({ name: 'Private source', branchFrom: 'account-algorithm' }), /not in this workspace/);
		const created = (await algorithms.create({ name: 'Local' })).algorithm;
		await assert.rejects(algorithms.update({ id: created.id, listed: true }), /stay on this device/);
		await algorithms.observePublicPosts([{ ...posts[0], tags: ['constructor', '__proto__', 'art'] }]);
		await algorithms.track({ algorithmId: created.id, events: [{ thingId: 'first', signal: 'view' }] });
		const manifest = (await things.export([created.id])).manifest;
		assert.deepEqual(Object.keys(algorithmTransferContent(manifest.things[0].crystal).weights.tags), ['art']);
		const invalid = structuredClone(manifest); invalid.things[0].crystal.ownerId = 'other';
		await assert.rejects(things.import(invalid), /only name/);
		assert.equal((await algorithms.list()).algorithms.length, 1);
	} finally { await db.close(); }
});

test('algorithm imports enforce the shared quota atomically and preserve built-in selection', async () => {
	const { db, algorithms, things } = fixture();
	try {
		const created = (await algorithms.create({ name: 'Original' })).algorithm;
		const bundle = (await things.export([created.id])).manifest;
		const rows = Array.from({ length: MAX_SAVED_ALGORITHMS }, (_, i) => ({ ...bundle.things[0], id: `copy-${i}` }));
		await assert.rejects(things.import({ ...bundle, roots: rows.map(row => row.id), things: rows }), /algorithm limit/);
		assert.equal((await algorithms.list()).algorithms.length, 1);
		await algorithms.setActive('new'); assert.equal((await algorithms.list()).activeAlgorithmId, 'new');
		await things.import({ ...bundle, roots: rows.slice(1).map(row => row.id), things: rows.slice(1) });
		await assert.rejects(algorithms.create({ name: 'Full' }), /algorithm limit/);
		await algorithms.remove(created.id); await algorithms.create({ name: 'Room again' });
		assert.equal((await algorithms.list()).algorithms.length, MAX_SAVED_ALGORITHMS);
	} finally { await db.close(); }
});
