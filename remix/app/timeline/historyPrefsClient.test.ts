import assert from 'node:assert/strict';
import test from 'node:test';
import { historyPrefs, HISTORY_PREFS_CACHE_PREFIX, timelineDraftFailureText, TIMELINE_STORAGE_FULL_HELD, type HistoryPrefsApi } from './historyPrefsClient.ts';
import { DEFAULT_HISTORY_PREFS, type HistoryPrefs, type HistoryPrefsPatch } from './historyPrefs.ts';

// A localStorage stand-in so the sync localCache tier (readLocalCache/writeLocalCache) works under node.
const storage = new Map<string, string>();
(globalThis as any).window = {
	localStorage: {
		getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); },
		key: (index: number) => [...storage.keys()][index] ?? null, get length() { return storage.size; }
	}
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const full = { temporary: false, accountKind: 'user' };
const prefs = (overrides: Partial<HistoryPrefs> = {}): HistoryPrefs => ({ ...DEFAULT_HISTORY_PREFS, pausedThingIds: [], ...overrides });
type Fake = { api: HistoryPrefsApi; gets: number; sets: HistoryPrefsPatch[]; settle: () => void };
const fakeApi = (options: { get?: () => Promise<unknown>; set?: (patch: HistoryPrefsPatch) => Promise<unknown>; gate?: boolean } = {}): Fake => {
	let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
	const fake: Fake = {
		gets: 0, sets: [], settle: () => release(),
		api: { v1: { timeline: { settings: {
			get: async () => { fake.gets++; if (options.gate) await gate; return options.get ? options.get() : { ok: true, prefs: prefs() }; },
			set: async (patch: HistoryPrefsPatch, scope: { ownerId: string }) => { fake.sets.push(patch); assert.equal(scope.ownerId, 'user-1'); return options.set ? options.set(patch) : { ok: true, prefs: prefs() }; }
		} } } }
	};
	return fake;
};
const failure = (status: number, error = 'refused') => Object.assign(new Error(error), { status, error });

test.beforeEach(() => { historyPrefs.reset(); storage.clear(); });

test('one in-flight GET per owner, the cached record paints first and the server record replaces it', async () => {
	storage.set(`${HISTORY_PREFS_CACHE_PREFIX}user-1`, JSON.stringify({ at: 1, prefs: { syncHold: true, retention: '90d', pausedThingIds: ['cached-thing'] }, showMessages: false }));
	const fake = fakeApi({ gate: true, get: async () => ({ ok: true, prefs: { syncHold: false, retention: 'named', pausedThingIds: ['server-thing'] } }) });
	assert.equal(historyPrefs.isHeld('user-1'), true, 'cache paints before any network');
	assert.equal(historyPrefs.isPaused('user-1', 'cached-thing'), true);
	assert.equal(historyPrefs.snapshot('user-1').showMessages, false);
	assert.equal(historyPrefs.snapshot('user-1').status, 'loading');
	let changes = 0; const unsubscribe = historyPrefs.subscribe(() => { changes++; });
	const first = historyPrefs.load('user-1', fake.api, full); const second = historyPrefs.load('user-1', fake.api, full);
	assert.equal(first, second); assert.equal(fake.gets, 1);
	let settled = false; void historyPrefs.ready('user-1').then(() => { settled = true; });
	await tick(); assert.equal(settled, false, 'ready waits for the first load');
	fake.settle(); await first;
	assert.equal(settled, true);
	assert.deepEqual(historyPrefs.snapshot('user-1').prefs, { syncHold: false, retention: 'named', pausedThingIds: ['server-thing'] });
	assert.equal(historyPrefs.snapshot('user-1').status, 'ready');
	assert.equal(historyPrefs.isHeld('user-1'), false); assert.equal(historyPrefs.isPaused('user-1', 'cached-thing'), false);
	assert.deepEqual(JSON.parse(storage.get(`${HISTORY_PREFS_CACHE_PREFIX}user-1`)!).prefs, { syncHold: false, retention: 'named', pausedThingIds: ['server-thing'] });
	assert.equal(JSON.parse(storage.get(`${HISTORY_PREFS_CACHE_PREFIX}user-1`)!).showMessages, false, 'the per-viewer convenience survives a refetch');
	assert.ok(changes >= 1);
	await historyPrefs.load('user-1', fake.api, full); assert.equal(fake.gets, 1, 'a settled load is not refetched without force');
	await historyPrefs.load('user-1', fake.api, full, { force: true }); assert.equal(fake.gets, 2);
	unsubscribe();
});

test('unknown owners never hold or pause, and ready() does not wait for a load nobody asked for', async () => {
	assert.equal(historyPrefs.isHeld('nobody'), false);
	assert.equal(historyPrefs.isPaused('nobody', 'thing'), false);
	let settled = false; void historyPrefs.ready('nobody').then(() => { settled = true; }); await tick();
	assert.equal(settled, true);
	assert.equal(historyPrefs.snapshot(null).status, 'unavailable'); assert.equal(historyPrefs.snapshot(undefined).reason, 'account');
	assert.equal(historyPrefs.snapshot(null), historyPrefs.snapshot(''), 'signed out is one constant snapshot');
});

test('temporary, service and signed-out viewers never reach the network; an older origin is unavailable, not an error', async () => {
	for (const viewer of [{ temporary: true, accountKind: 'user' }, { temporary: false, accountKind: 'service' }, null]) {
		historyPrefs.reset();
		const fake = fakeApi();
		await historyPrefs.load('user-1', fake.api, viewer);
		assert.equal(fake.gets, 0);
		assert.equal(historyPrefs.snapshot('user-1').status, 'unavailable'); assert.equal(historyPrefs.snapshot('user-1').reason, 'account');
		await historyPrefs.ready('user-1');
	}
	historyPrefs.reset();
	const older = fakeApi({ get: async () => { throw new Error('Thingtime capability api.timeline-settings is incompatible'); } });
	await historyPrefs.load('user-1', older.api, full);
	assert.equal(historyPrefs.snapshot('user-1').status, 'unavailable'); assert.equal(historyPrefs.snapshot('user-1').reason, 'origin');
	assert.equal(historyPrefs.snapshot('user-1').error, undefined);
	await historyPrefs.load('user-1', older.api, full); assert.equal(older.gets, 1, 'unavailable is not polled; Retry forces');
	await historyPrefs.load('user-1', older.api, full, { force: true }); assert.equal(older.gets, 2);
	historyPrefs.reset();
	const denied = fakeApi({ get: async () => { throw failure(401, 'Sign in with a full account to manage history settings.'); } });
	await historyPrefs.load('user-1', denied.api, undefined);
	assert.equal(historyPrefs.snapshot('user-1').status, 'unavailable'); assert.equal(historyPrefs.snapshot('user-1').reason, 'account');
});

test('ready() settles on failure, a failed read is retried by the next load and the hold stays off', async () => {
	storage.set(`${HISTORY_PREFS_CACHE_PREFIX}user-1`, JSON.stringify({ at: 1, prefs: { syncHold: true, retention: 'forever', pausedThingIds: [] }, showMessages: true }));
	let fail = true;
	const fake = fakeApi({ get: async () => { if (fail) throw failure(503, 'History settings are busy. Try again.'); return { ok: true, prefs: prefs() }; } });
	await historyPrefs.load('user-1', fake.api, full);
	await historyPrefs.ready('user-1');
	assert.equal(historyPrefs.snapshot('user-1').status, 'error'); assert.equal(historyPrefs.snapshot('user-1').error, 'History settings are busy. Try again.');
	assert.equal(historyPrefs.isHeld('user-1'), true, 'a cached hold stands while the read fails; nothing was learned');
	historyPrefs.reset(); storage.clear();
	const cold = fakeApi({ get: async () => { throw new Error('offline'); } });
	await historyPrefs.load('user-1', cold.api, full);
	assert.equal(historyPrefs.snapshot('user-1').status, 'error'); assert.equal(historyPrefs.snapshot('user-1').error, 'offline');
	assert.equal(historyPrefs.isHeld('user-1'), false, 'unknown = not held');
	historyPrefs.reset();
	await historyPrefs.load('user-1', fake.api, full); assert.equal(historyPrefs.snapshot('user-1').status, 'error');
	fail = false;
	await historyPrefs.load('user-1', fake.api, full); assert.equal(fake.gets, 3); assert.equal(historyPrefs.snapshot('user-1').status, 'ready');
	assert.equal(historyPrefs.isHeld('user-1'), false);
});

test('updates apply optimistically, take the server record, revert on refusal and run in order', async () => {
	const fake = fakeApi({ get: async () => ({ ok: true, prefs: prefs({ pausedThingIds: ['a'] }) }), set: async patch => {
		if (patch.resume?.includes('explode')) throw failure(503, 'History settings are busy. Try again.');
		return { ok: true, prefs: prefs({ syncHold: patch.syncHold ?? false, pausedThingIds: ['server-truth', ...(patch.pause ?? [])] }) };
	} });
	await historyPrefs.load('user-1', fake.api, full);
	const pending = historyPrefs.update('user-1', { syncHold: true, pause: ['b'] }, fake.api);
	assert.equal(historyPrefs.isHeld('user-1'), true, 'optimistic before the server answers');
	assert.deepEqual(historyPrefs.snapshot('user-1').prefs.pausedThingIds, ['a', 'b']);
	const result = await pending;
	assert.deepEqual(result, { syncHold: true, retention: 'forever', pausedThingIds: ['server-truth', 'b'] });
	assert.deepEqual(historyPrefs.snapshot('user-1').prefs, result, 'the server record replaces the optimistic one');
	assert.deepEqual(JSON.parse(storage.get(`${HISTORY_PREFS_CACHE_PREFIX}user-1`)!).prefs, result);
	const refused = historyPrefs.update('user-1', { resume: ['explode'], syncHold: false }, fake.api);
	assert.equal(historyPrefs.isHeld('user-1'), false, 'optimistic again');
	await assert.rejects(refused, /busy/);
	assert.deepEqual(historyPrefs.snapshot('user-1').prefs, result, 'reverted to the state the write started from');
	assert.equal(historyPrefs.isHeld('user-1'), true);
	await assert.rejects(historyPrefs.update('user-1', { pause: Array.from({ length: 200 }, (_, index) => `thing-${index}`) }, fake.api), RangeError);
	assert.equal(fake.sets.length, 2, 'a patch that overflows the cap never reaches the network');
	const [first, second] = [historyPrefs.update('user-1', { pause: ['c'] }, fake.api), historyPrefs.update('user-1', { resume: ['explode'] }, fake.api)];
	await first; await assert.rejects(second);
	assert.deepEqual(fake.sets.slice(2), [{ pause: ['c'] }, { resume: ['explode'] }], 'writes for one owner are serialized');
	assert.deepEqual(historyPrefs.snapshot('user-1').prefs.pausedThingIds, ['server-truth', 'c'], 'the revert restores the first write’s result, not an older read');
	await assert.rejects(historyPrefs.update('user-1', { syncHold: true }, fakeApi({ set: async () => ({ ok: true }) }).api), /Invalid history settings response/);
});

test('a read that lands after an optimistic write cannot undo it', async () => {
	const fake = fakeApi({ gate: true, get: async () => ({ ok: true, prefs: prefs() }), set: async () => ({ ok: true, prefs: prefs({ syncHold: true }) }) });
	const load = historyPrefs.load('user-1', fake.api, full);
	await historyPrefs.update('user-1', { syncHold: true }, fake.api);
	fake.settle(); await load;
	assert.equal(historyPrefs.snapshot('user-1').status, 'ready');
	assert.equal(historyPrefs.isHeld('user-1'), true, 'the stale read did not clear the confirmed hold');
});

test('snapshots are keyed by owner so one account never paints for another, and showMessages is per viewer', async () => {
	const fake = fakeApi({ get: async () => ({ ok: true, prefs: prefs({ syncHold: true, pausedThingIds: ['mine'] }) }) });
	await historyPrefs.load('user-1', fake.api, full);
	assert.equal(historyPrefs.isHeld('user-2'), false); assert.equal(historyPrefs.isPaused('user-2', 'mine'), false);
	assert.equal(historyPrefs.snapshot('user-2').status, 'loading'); assert.notEqual(historyPrefs.snapshot('user-2'), historyPrefs.snapshot('user-1'));
	historyPrefs.setShowMessages('user-1', false);
	assert.equal(historyPrefs.snapshot('user-1').showMessages, false); assert.equal(historyPrefs.snapshot('user-2').showMessages, true);
	const cached = JSON.parse(storage.get(`${HISTORY_PREFS_CACHE_PREFIX}user-1`)!);
	assert.equal(cached.showMessages, false); assert.deepEqual(cached.prefs, { syncHold: true, retention: 'forever', pausedThingIds: ['mine'] });
	assert.equal(storage.has(`${HISTORY_PREFS_CACHE_PREFIX}user-2`), false);
	const before = historyPrefs.snapshot('user-1'); historyPrefs.setShowMessages('user-1', false);
	assert.equal(historyPrefs.snapshot('user-1'), before, 'a no-op write keeps the snapshot identity for useSyncExternalStore');
});

test('the held storage-full message tells the user to resume, not reconnect', () => {
	const full = new Error('Timeline local storage is full. Reconnect to sync pending changes.');
	assert.equal(timelineDraftFailureText(full, true, 'x'), TIMELINE_STORAGE_FULL_HELD);
	assert.equal(timelineDraftFailureText(full, false, 'x'), full.message);
	assert.equal(timelineDraftFailureText(new Error('other'), true, 'x'), 'other');
	assert.equal(timelineDraftFailureText('not an error', true, 'fallback'), 'fallback');
});
