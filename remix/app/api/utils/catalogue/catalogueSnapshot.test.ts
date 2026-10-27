import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { createCatalogueSnapshotService, CATALOGUE_PAGE_ENTRIES } from './catalogueSnapshot';
import { readCatalogueStream, type CatalogueIdentity } from '../../../catalogue/catalogueStream';

const identity = (domain: CatalogueIdentity['domain'] = 'themes'): CatalogueIdentity => ({ domain, ownerId: 'owner',
	origin: 'https://catalogue.example', dataPlane: 'home', storagePlane: 'home' });
const id = (n: number) => `item-${String(n).padStart(5, '0')}`;
const doc = (n: number, old = false, domain: CatalogueIdentity['domain'] = 'themes'): any => {
	const content = domain === 'themes' ? { name: `Theme ${n}`, theme: { colors: { accent: '#112233' } } } : {
		name: `Algorithm ${n}`, emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null };
	return { _id: `${old ? 'old' : 'new'}-${n}`, shareId: id(n), ownerId: 'owner', createdAt: '2026-10-25T00:00:00.000Z',
		updatedAt: '2026-10-25T00:00:00.000Z', ...(old ? { ...content, visibility: 'private' } : {
			thingtime: [domain === 'themes' ? 'theme' : 'feed-algorithm'], acl: ['tt:user'], folderId: 'modern-folder', crystal: content }) };
};
const deferred = <T = void>() => {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
};
function fixture(modern: any[] = [doc(1)], legacy: any[] = []) {
	let active = false, sessions = 0, queries = 0, closes = 0, admissions = 0;
	let session: any, endpoint: any = null;
	let beforePage: (options: any) => Promise<void> = async () => {};
	let admit: () => Promise<void> = async () => {};
	let finish: () => Promise<void> = async () => {};
	const settled = deferred();
	const collection = (old: boolean) => ({ find: (filter: any, options: any) => {
		assert.equal(active, true); assert.equal(options.session, session); assert.equal(options.maxTimeMS, 5000);
		assert.equal(options.readPreference, 'primary'); assert.deepEqual(options.collation, { locale: 'simple' });
		assert.equal(filter.ownerId, 'owner'); queries++;
		let cap = 0;
		return { sort(sort: any) { assert.deepEqual(sort, { shareId: 1 }); return this; },
			limit(n: number) { cap = n; assert.equal(n, CATALOGUE_PAGE_ENTRIES + 1); return this; },
			batchSize(n: number) { assert.equal(n, cap); return this; },
			async toArray() {
				await beforePage(options); options.signal.throwIfAborted();
				const result = (old ? session.legacy : session.modern).filter((d: any) =>
					d.ownerId === filter.ownerId && (!filter.shareId || d.shareId > filter.shareId.$gt));
				return result.sort((a: any, b: any) => a.shareId < b.shareId ? -1 : a.shareId > b.shareId ? 1 : 0).slice(0, cap);
			}, async close() { assert.equal(active, true); closes++; } };
	} });
	const service = createCatalogueSnapshotService({
		things: async () => collection(false), themes: async () => collection(true), algorithms: async () => collection(true),
		endpoint: () => endpoint, generation: () => 'generation-1',
		snapshot: async work => {
			sessions++; active = true;
			session = { modern: structuredClone(modern), legacy: structuredClone(legacy), snapshotEnabled: true, inTransaction: () => false };
			try { const result = await work(session); await finish(); return result; }
			finally { active = false; settled.resolve(); }
		}
	});
	return { modern, legacy, settled: settled.promise,
		body: (scope = identity(), options: { signal?: AbortSignal; stallTimeoutMs?: number } = {}) => service({ identity: scope,
			admit: async () => { admissions++; await admit(); }, ...options }),
		counts: () => ({ active, sessions, queries, closes, admissions }),
		page: (fn: typeof beforePage) => { beforePage = fn; }, auth: (fn: typeof admit) => { admit = fn; },
		endpoint: (value: any) => { endpoint = value; }, finish: (fn: typeof finish) => { finish = fn; } };
}
async function consume(body: ReadableStream<Uint8Array>, scope = identity()) {
	const rows: { id: string; value: any }[] = []; let completed = false;
	const receipt = await readCatalogueStream(body, scope, { entry: async (id, value) => { rows.push({ id, value }); },
		complete: async () => { completed = true; } });
	return { rows, receipt, completed };
}

test('both domains stream past old caps, merge sorted legacy IDs and prefer modern duplicates in one pinned snapshot', async () => {
	for (const domain of ['themes', 'algorithms'] as const) {
		const scope = identity(domain), f = fixture(Array.from({ length: 210 }, (_, n) => doc(n * 2, false, domain)),
			Array.from({ length: 270 }, (_, n) => doc(n, true, domain)));
		let first = true;
		f.page(async () => { if (first) { first = false; f.modern.splice(0); f.legacy.splice(0); } });
		const result = await consume(f.body(scope), scope);
		assert.equal(result.completed, true); assert.equal(result.rows.length, 345); assert.equal(result.receipt.entries, 345);
		assert.deepEqual(result.rows.map(r => r.id), [...new Set(result.rows.map(r => r.id))].sort());
		for (const row of result.rows) {
			const n = Number(row.id.slice(5));
			assert.equal(row.value.folderId, n % 2 === 0 ? 'modern-folder' : null);
			if (domain === 'algorithms') assert.equal(row.value.legacy, n % 2 !== 0);
			assert.match(row.value.version, domain === 'themes' ? /^theme-state-v1:/ : /^algorithm-state-v1:/);
		}
		assert.equal(f.counts().sessions, 1); assert.equal(f.counts().active, false);
		assert.ok(f.counts().queries > 4); assert.equal(f.counts().queries, f.counts().closes);
	}
});

test('empty catalogue completes, authorized custom selection stays home-pinned, duplicate source IDs fail closed', async () => {
	const f = fixture([], []); f.endpoint({ url: 'mongodb://selected.invalid', savedId: 'chosen' });
	const scope = { ...identity(), dataPlane: 'custom-selected' };
	assert.equal((await consume(f.body(scope), scope)).receipt.entries, 0);
	const duplicate = fixture(Array.from({ length: CATALOGUE_PAGE_ENTRIES }, (_, n) => doc(n)));
	duplicate.modern.push(doc(CATALOGUE_PAGE_ENTRIES - 1));
	await assert.rejects(consume(duplicate.body()));
	await duplicate.settled; assert.equal(duplicate.counts().active, false);
});

test('snapshot expiry, session disposal failure, revoked auth and endpoint changes withhold successful completion', async () => {
	for (const reason of ['expiry', 'dispose', 'auth', 'auth-at-dispose', 'endpoint', 'malformed'] as const) {
		const f = fixture(Array.from({ length: 150 }, (_, n) => doc(n)));
		if (reason === 'malformed') f.modern[100].crystal.theme = { value: undefined };
		if (reason === 'dispose') f.finish(async () => { throw Error('session close failed'); });
		if (reason === 'auth-at-dispose') f.finish(async () => { f.auth(async () => { throw Error('session revoked during cleanup'); }); });
		if (reason === 'expiry') f.page(async () => { if (f.counts().queries > 2) throw Error('SnapshotTooOld'); });
		if (reason === 'auth') f.auth(async () => { if (f.counts().admissions > 10) throw Error('session revoked'); });
		if (reason === 'endpoint') f.auth(async () => { if (f.counts().admissions > 10) f.endpoint({ url: 'mongodb://changed.invalid', savedId: null }); });
		let complete = false;
		await assert.rejects(readCatalogueStream(f.body(), identity(), { entry: async () => {}, complete: async () => { complete = true; } }));
		await f.settled; assert.equal(complete, false); assert.equal(f.counts().active, false);
		assert.equal(f.counts().queries, f.counts().closes);
	}
});

test('reader backpressure bounds page reads and keeps session alive until the full stream is consumed', async () => {
	const f = fixture(Array.from({ length: 300 }, (_, n) => doc(n))), body = f.body(), reader = body.getReader();
	await turn(); assert.equal(f.counts().queries, 0); assert.equal(f.counts().active, true);
	const start = await reader.read(); assert.match(new TextDecoder().decode(start.value), /"type":"start"/);
	await turn(); assert.equal(f.counts().queries, 2); assert.equal(f.counts().active, true);
	await turn(); assert.equal(f.counts().queries, 2);
	let terminal = false;
	for (;;) { const next = await reader.read(); if (next.done) break;
		if (new TextDecoder().decode(next.value).includes('"type":"end"')) { terminal = true; assert.equal(f.counts().active, true); }
	}
	assert.equal(terminal, true); await f.settled; assert.equal(f.counts().active, false); reader.releaseLock();
});

test('slow or cancelled readers release snapshots; an in-flight query is drained before session disposal', async () => {
	const stalled = fixture(); const body = stalled.body(identity(), { stallTimeoutMs: 25 });
	await stalled.settled; assert.equal(stalled.counts().active, false);
	await assert.rejects(consume(body));
	for (const requestCancel of [false, true]) {
		const f = fixture(), started = deferred(), release = deferred(), aborted = deferred(), request = new AbortController();
		f.page(async options => {
			started.resolve();
			options.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
			await release.promise;
		});
		const reader = f.body(identity(), { signal: request.signal }).getReader();
		await reader.read(); await started.promise;
		const cancelled = requestCancel ? (request.abort(), Promise.resolve()) : reader.cancel();
		await aborted.promise; assert.equal(f.counts().active, true); assert.equal(f.counts().closes, 0);
		release.resolve(); await cancelled; await f.settled;
		assert.equal(f.counts().active, false); assert.equal(f.counts().closes, 1); reader.releaseLock();
	}
});

test('a stalled independent auth recheck cannot retain a snapshot session after cancellation or timeout', async () => {
	for (const cancel of [false, true]) {
		const f = fixture(), request = new AbortController(), reached = deferred();
		f.auth(async () => { if (f.counts().admissions >= 3) { reached.resolve(); await new Promise<void>(() => {}); } });
		const reader = f.body(identity(), { signal: request.signal, stallTimeoutMs: 30 }).getReader();
		await reader.read(); await reached.promise;
		const next = reader.read();
		if (cancel) request.abort();
		await assert.rejects(next); await f.settled;
		assert.equal(f.counts().active, false); reader.releaseLock();
	}
});

test('canonical profile validation remains intact and a valid large algorithm is chunked losslessly', async () => {
	const scope = identity('algorithms'), row = doc(1, false, 'algorithms');
	row.crystal.weights.tags = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`tag-${i}`, 1]));
	const valid = fixture([row]);
	const result = await consume(valid.body(scope), scope);
	assert.deepEqual(result.rows[0].value.content.weights.tags, row.crystal.weights.tags);
	assert.ok(result.receipt.bytes > 24 * 1024);
	for (const bad of [
		{ scope: identity(), row: { ...doc(1), ignoredField: 'x'.repeat(1024 * 1024) } },
		{ scope, row: { ...row, crystal: { ...row.crystal, weights: { ...row.crystal.weights, tags: { bad: Infinity } } } } }
	]) {
		const f = fixture([bad.row]); await assert.rejects(consume(f.body(bad.scope), bad.scope));
		await f.settled; assert.equal(f.counts().active, false);
	}
});
