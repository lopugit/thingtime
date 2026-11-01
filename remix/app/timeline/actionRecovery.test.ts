import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb';
import { TimelineLocalStore } from './localStore';
import { TimelineSync } from './sync';
import { parseActionOutcomeRecovery, retainActionOutcomeRecovery } from './actionRecovery';
import { actionOutcomeFixture, entryFixture, eventFixture } from './testFixtures';
import { splitTimelineEvent } from './records';
import { timelineScopeKey } from './contract';

const scope = { apiOrigin: 'https://thingtime.com', ownerId: 'user-1', dataPlane: 'home' };
const recovery = () => ({ formatVersion: 1 as const, event: actionOutcomeFixture(), dataPlane: 'home', proof: 'header.payload.signature' });

test('server outcome and delivery proof persist atomically across reload, retry and cache pruning in the existing relational outbox', async () => {
	const factory = new IDBFactory(); let backend = new IndexedDbTimelineBackend(factory);
	let store = new TimelineLocalStore(scope, backend); const input = recovery();
	await assert.rejects(store.enqueue(input.event), /client events/);
	await store.enqueueRecovery(input); await store.enqueue(eventFixture('draft'));
	await store.prune(0, 0); await backend.close();
	backend = new IndexedDbTimelineBackend(factory); store = new TimelineLocalStore(scope, backend);
	assert.equal((await store.pending()).length, 2);
	assert.deepEqual((await store.pendingWrites())[0].event, input.event);
	let recoveries = 0; let drafts = 0;
	const transport = {
		push: async (event) => { drafts++; return entryFixture(event, 3); },
		recoverOutcome: async (event, proof) => {
			recoveries++; assert.deepEqual(event, input.event); assert.equal(proof, input.proof);
			if (recoveries === 1) throw new Error('lost acknowledgement');
			return entryFixture(event, 2);
		}, page: async () => ({ entries: [], nextBefore: null, nextAfter: null })
	};
	const sync = new TimelineSync(store, transport);
	await assert.rejects(sync.pushPending(), /lost acknowledgement/);
	assert.equal((await store.pending()).length, 2); assert.equal(drafts, 0);
	assert.equal(await sync.pushPending(), 2); assert.equal(recoveries, 2); assert.equal(drafts, 1);
	assert.equal((await store.pending()).length, 0);
	assert.equal((await store.entries([input.event.id]))[0].recoveryProof, undefined);
	await store.enqueueRecovery(input); assert.equal((await store.pending()).length, 0, 'late duplicate cannot replace an accepted receipt');
	await backend.close();
	// Inspect this synthetic database to verify the canonical normalized payload.
	const open = factory.open('thingtime-timeline-v1'); const db = await new Promise<IDBDatabase>((resolve) => { open.onsuccess = () => resolve(open.result); });
	const request = db.transaction('events').objectStore('events').get([timelineScopeKey(scope), input.event.id]);
	const row: any = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
	assert.deepEqual(row.event, splitTimelineEvent(input.event).event); assert.equal(row.recoveryProof, undefined); db.close();
});

test('recovery refuses scope changes, changed immutable IDs, admissions, oversized proofs and malformed records', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend);
	const input = recovery(); await store.enqueueRecovery(input);
	await assert.rejects(store.enqueueRecovery({ ...input, event: { ...input.event, label: 'different' } }), /identity/);
	await assert.rejects(new TimelineLocalStore({ ...scope, ownerId: 'other' }, backend).enqueueRecovery(input), /another account/);
	await assert.rejects(new TimelineLocalStore({ ...scope, dataPlane: `custom-${'a'.repeat(64)}` }, backend).enqueueRecovery(input), /another database/);
	assert.equal((await new TimelineLocalStore({ ...scope, apiOrigin: 'https://other.invalid' }, backend).pending()).length, 0);
	for (const patch of [{ event: actionOutcomeFixture('started') }, { proof: 'a'.repeat(5000) }, { proof: 'invalid' }, { extra: true }, { dataPlane: 'invalid' }])
		assert.throws(() => parseActionOutcomeRecovery({ ...input, ...patch }));
	await backend.close();
});

test('stopped or older sync connections retain the outcome without treating its proof as a client draft', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend);
	await store.enqueueRecovery(recovery()); let resolve;
	const transport = { push: async () => { throw new Error('must not upload as draft'); }, page: async () => ({ entries: [], nextBefore: null, nextAfter: null }) };
	await assert.rejects(new TimelineSync(store, transport).pushPending(), /does not support/);
	const sync = new TimelineSync(store, { ...transport, recoverOutcome: () => new Promise<any>(done => { resolve = done; }) });
	const pending = sync.pushPending(); while (!resolve) await new Promise(done => setTimeout(done, 0));
	sync.stop(); resolve(entryFixture(recovery().event)); await assert.rejects(pending, /stopped/);
	assert.equal((await store.pending()).length, 1); await backend.close();
});

test('retention preserves actual execution result and original request scope even when IndexedDB is unavailable', async () => {
	const response = { result: 'actual result', history: { status: 'incomplete' as const, startedEventId: 'admission', outcomeEventId: null, recovery: recovery() } };
	let writes = 0;
	const saved = await retainActionOutcomeRecovery(response, scope.ownerId, scope.dataPlane, async input => { writes++; assert.deepEqual(input, recovery()); });
	assert.equal(saved.history.localRecovery, 'saved'); assert.equal(saved.result, response.result);
	const failed = await retainActionOutcomeRecovery(response, scope.ownerId, scope.dataPlane, async () => { throw new Error('disk full'); });
	assert.equal(failed.history.localRecovery, 'unavailable'); assert.equal(failed.result, response.result);
	for (const [owner, plane] of [['other', 'home'], [scope.ownerId, null], [scope.ownerId, `custom-${'b'.repeat(64)}`]]) {
		const stale = await retainActionOutcomeRecovery(response, owner!, plane, async () => { writes++; });
		assert.equal(stale.history.localRecovery, 'unavailable');
	}
	assert.equal(writes, 1);
});

test('an unverifiable outcome preserves dependent work but cannot block unrelated authored edits', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend);
	await store.enqueueRecovery(recovery());
	await store.enqueue(eventFixture('dependent', { parentIds: [recovery().event.id] }));
	await store.enqueue(eventFixture('independent'));
	const sent: string[] = [];
	const sync = new TimelineSync(store, {
		push: async event => { sent.push(event.id); return entryFixture(event); },
		recoverOutcome: async () => { throw Object.assign(new Error('proof no longer trusted'), { status: 409 }); },
		page: async () => ({ entries: [], nextBefore: null, nextAfter: null })
	});
	await assert.rejects(sync.pushPending(), /no longer trusted/);
	assert.deepEqual(sent, ['independent']);
	assert.deepEqual((await store.pending()).map(event => event.id), ['completion', 'dependent']); await backend.close();
});
