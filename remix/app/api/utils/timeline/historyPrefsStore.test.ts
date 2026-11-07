import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import { SecureWriteContendedError, createHistoryPrefsStore, getUserHistoryPrefs, historyPrefsStore, mutateUserThingSecureIn, packSecure, setUserHistoryPrefs, unpackSecure } from '../auth/users.ts';
import { getActiveMongoEndpoint, runWithMongoEndpoint } from '../mongodb/endpoint.ts';
import { DEFAULT_HISTORY_PREFS, HISTORY_PAUSED_THINGS_MAX } from '../../../timeline/historyPrefs.ts';

const ids = (count: number, prefix = 'thing') => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
const LEGACY_ID = '66f1a2b3c4d5e6f7a8b9c0d1';

// Minimal things/users doubles: the CAS loop's findOne projection + guarded
// updateOne, and the legacy collection's findOne + $set. `beforeWrite` lets a
// test simulate a competing writer landing between the read and the write.
function harness(options: { thing?: Record<string, any> | null; legacy?: Record<string, any> | null; beforeWrite?: () => void } = {}) {
	const rows: any[] = options.thing === null ? [] : [options.thing ?? { shareId: 'user-1', thingtime: ['user'], secure: packSecure({ meta: { notificationPrefs: { comment: false } } }), secureVersion: 3 }];
	const legacy: any[] = options.legacy ? [options.legacy] : [];
	const counts = { things: 0, users: 0, reads: 0, writes: 0, legacyWrites: 0 };
	const matches = (row: any, filter: any) => Object.entries(filter).every(([key, value]: any) => {
		if (key === 'secureVersion') return value?.$exists === false ? row.secureVersion === undefined : row.secureVersion === value;
		return Array.isArray(row[key]) ? row[key].includes(value) : row[key] === value;
	});
	const things = {
		findOne: async (filter: any, read: any) => { counts.reads += 1; assert.equal(read.projection.secure, 1); assert.equal(filter.thingtime, 'user'); const row = rows.find(row => matches(row, filter)); return row ? { secure: row.secure, secureVersion: row.secureVersion } : null; },
		updateOne: async (filter: any, update: any) => { counts.writes += 1; options.beforeWrite?.(); const row = rows.find(row => matches(row, filter)); if (!row) return { matchedCount: 0, modifiedCount: 0 }; Object.assign(row, update.$set); return { matchedCount: 1, modifiedCount: 1 }; }
	};
	const users = {
		findOne: async (filter: any, read: any) => { assert.deepEqual(read.projection, { 'meta.historyPrefs': 1 }); return legacy.find(doc => doc._id.equals(filter._id)) ?? null; },
		updateOne: async (filter: any, update: any) => { counts.legacyWrites += 1; const doc = legacy.find(doc => doc._id.equals(filter._id)); if (!doc) return { matchedCount: 0 }; for (const [path, value] of Object.entries(update.$set)) { if (path === 'meta.historyPrefs') doc.meta = { ...doc.meta, historyPrefs: value }; else doc[path] = value; } return { matchedCount: 1 }; }
	};
	const store = createHistoryPrefsStore({ things: async () => { counts.things += 1; return things as any; }, users: async () => { counts.users += 1; return users as any; } });
	const bump = () => { for (const row of rows) row.secureVersion = (row.secureVersion ?? 0) + 1; };
	return { store, rows, legacy, counts, bump, stored: () => unpackSecure(rows[0]?.secure) };
}

test('get reads the secure blob through the injected things getter and falls back to the legacy users record', async () => {
	const h = harness({ thing: { shareId: 'user-1', thingtime: ['user'], secure: packSecure({ meta: { historyPrefs: { syncHold: true, retention: '90d', pausedThingIds: ['page-1', 'bad id', 'page-1'] }, twoFactorEmailEnabled: true } }), secureVersion: 1 } });
	assert.deepEqual(await h.store.get('user-1'), { syncHold: true, retention: '90d', pausedThingIds: ['page-1'] });
	assert.deepEqual(h.counts, { things: 1, users: 0, reads: 1, writes: 0, legacyWrites: 0 });
	assert.deepEqual(await h.store.get('user-2'), DEFAULT_HISTORY_PREFS);
	assert.equal(h.counts.users, 0);
	const legacy = harness({ thing: null, legacy: { _id: new ObjectId(LEGACY_ID), meta: { historyPrefs: { retention: 'named', pausedThingIds: ['legacy-1'] } } } });
	assert.deepEqual(await legacy.store.get(LEGACY_ID), { syncHold: false, retention: 'named', pausedThingIds: ['legacy-1'] });
	assert.deepEqual(await legacy.store.get(new ObjectId().toHexString()), DEFAULT_HISTORY_PREFS);
	assert.equal(legacy.counts.users, 2);
	const blank = harness({ thing: { shareId: 'user-1', thingtime: ['user'], secure: packSecure({}), secureVersion: 0 } });
	assert.deepEqual(await blank.store.get('user-1'), DEFAULT_HISTORY_PREFS);
});

test('set merges pause/resume deltas inside the CAS write, keeps the rest of the blob and returns the full record', async () => {
	const h = harness();
	const first = await h.store.set('user-1', { pause: ['page-1', 'page-2'], retention: 'named' });
	assert.deepEqual(first, { matched: true, prefs: { syncHold: false, retention: 'named', pausedThingIds: ['page-1', 'page-2'] } });
	assert.equal(h.rows[0].secureVersion, 4);
	assert.deepEqual(h.stored(), { meta: { notificationPrefs: { comment: false }, historyPrefs: { syncHold: false, retention: 'named', pausedThingIds: ['page-1', 'page-2'] } } });
	// "another device" pauses a different Thing and the lists union instead of clobbering
	const second = await h.store.set('user-1', { pause: ['page-3'], syncHold: true });
	assert.deepEqual(second, { matched: true, prefs: { syncHold: true, retention: 'named', pausedThingIds: ['page-1', 'page-2', 'page-3'] } });
	const third = await h.store.set('user-1', { resume: ['page-2', 'missing'], pause: ['page-1'] });
	assert.deepEqual(third, { matched: true, prefs: { syncHold: true, retention: 'named', pausedThingIds: ['page-1', 'page-3'] } });
	assert.deepEqual(await h.store.get('user-1'), third.matched ? third.prefs : null);
	assert.equal(h.rows[0].secureVersion, 6);
	assert.ok(h.rows[0].updatedAt instanceof Date);
	assert.deepEqual([h.counts.users, h.counts.legacyWrites], [0, 0]);
});

test('the 200 cap refuses the merge before any write; a resume in the same patch makes room', async () => {
	const h = harness({ thing: { shareId: 'user-1', thingtime: ['user'], secure: packSecure({ meta: { historyPrefs: { syncHold: false, retention: 'forever', pausedThingIds: ids(HISTORY_PAUSED_THINGS_MAX) } } }), secureVersion: 9 } });
	await assert.rejects(h.store.set('user-1', { pause: ['one-more'] }), (error: any) => error instanceof RangeError && /Too many paused Things \(max 200\)/.test(error.message));
	assert.equal(h.counts.writes, 0); assert.equal(h.rows[0].secureVersion, 9);
	const result = await h.store.set('user-1', { pause: ['one-more'], resume: ['thing-0'] });
	assert.ok(result.matched && result.prefs.pausedThingIds.length === HISTORY_PAUSED_THINGS_MAX && result.prefs.pausedThingIds.includes('one-more') && !result.prefs.pausedThingIds.includes('thing-0'));
	assert.equal(h.rows[0].secureVersion, 10);
});

test('a write that loses every CAS round throws SecureWriteContendedError and never touches the legacy store', async () => {
	let h: ReturnType<typeof harness>;
	h = harness({ beforeWrite: () => h.bump(), legacy: { _id: new ObjectId(LEGACY_ID), meta: {} } });
	await assert.rejects(h.store.set('user-1', { syncHold: true }), (error: any) => error instanceof SecureWriteContendedError && /user-1/.test(error.message));
	assert.ok(h.counts.writes >= 20); assert.equal(h.counts.legacyWrites, 0);
	assert.deepEqual(h.stored().meta?.historyPrefs, undefined);
	// a single lost round is retried and lands on the fresh version
	let lost = 0; let g: ReturnType<typeof harness>;
	g = harness({ beforeWrite: () => { if (lost++ === 0) g.bump(); } });
	assert.deepEqual(await g.store.set('user-1', { syncHold: true }), { matched: true, prefs: { syncHold: true, retention: 'forever', pausedThingIds: [] } });
	assert.equal(g.counts.writes, 2); assert.equal(g.rows[0].secureVersion, 5);
});

test('no matching account reports matched:false; a legacy account is patched with the recomputed union', async () => {
	const none = harness({ thing: null });
	assert.deepEqual(await none.store.set('user-9', { syncHold: true }), { matched: false });
	assert.deepEqual(await none.store.set(new ObjectId().toHexString(), { syncHold: true }), { matched: false });
	assert.deepEqual([none.counts.writes, none.counts.legacyWrites], [0, 0]);
	const legacy = harness({ thing: null, legacy: { _id: new ObjectId(LEGACY_ID), meta: { historyPrefs: { pausedThingIds: ['legacy-1', 'legacy-2'] } } } });
	assert.deepEqual(await legacy.store.set(LEGACY_ID, { pause: ['legacy-3', 'legacy-1'], resume: ['legacy-2'], retention: '90d' }), { matched: true, prefs: { syncHold: false, retention: '90d', pausedThingIds: ['legacy-1', 'legacy-3'] } });
	assert.deepEqual(legacy.legacy[0].meta.historyPrefs, { syncHold: false, retention: '90d', pausedThingIds: ['legacy-1', 'legacy-3'] });
	assert.ok(legacy.legacy[0].updatedAt instanceof Date);
	assert.deepEqual([legacy.counts.writes, legacy.counts.legacyWrites], [0, 1]);
	await assert.rejects(legacy.store.set(LEGACY_ID, { pause: ids(HISTORY_PAUSED_THINGS_MAX) }), RangeError);
	assert.equal(legacy.counts.legacyWrites, 1);
});

test('the store is home-pinned by construction: a selected custom data source never changes which getters are used', async () => {
	const h = harness(); const selection = { url: 'mongodb://custom.test/other', savedId: null };
	await runWithMongoEndpoint(selection, async () => {
		assert.equal(getActiveMongoEndpoint(), selection);
		assert.deepEqual(await h.store.get('user-1'), DEFAULT_HISTORY_PREFS);
		assert.deepEqual(await h.store.set('user-1', { pause: ['page-1'] }), { matched: true, prefs: { syncHold: false, retention: 'forever', pausedThingIds: ['page-1'] } });
	});
	assert.deepEqual([h.counts.things, h.counts.users], [2, 0]);
	assert.equal(getUserHistoryPrefs, historyPrefsStore.get); assert.equal(setUserHistoryPrefs, historyPrefsStore.set);
	assert.equal(typeof mutateUserThingSecureIn, 'function');
});
