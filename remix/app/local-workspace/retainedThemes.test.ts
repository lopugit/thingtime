import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { AccountThemeSync, ACCOUNT_THEME_SYNC } from './accountThemes';
import { RetainedAccountThemes } from './retainedThemes';
import { WorkspaceDatabase } from './storage';
import { LocalAccountHomeThemes } from './homeThemes';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { parseTransfer, serializeTransfer } from '../utils/thingTransfer/format';
const scope = { kind: 'account', origin: 'https://retained.example', ownerId: 'owner', dataPlane: 'custom-' + 'a'.repeat(64) } as const;
const home = { ...scope, dataPlane: 'home' };
function fixture() {
	let active = true;
	const lease = {
		assertCurrent() {
			if (!active) throw Error('Retired account');
		},
		onInvalidate: () => () => {}
	};
	const db = new WorkspaceDatabase(new IDBFactory(), 'retained', 1000, IDBKeyRange);
	const source = new AccountThemeSync(db, scope, lease, () => 1000, randomUUID),
		target = new AccountThemeSync(db, home, lease, () => 2000, randomUUID);
	return {
		db,
		lease,
		source,
		target,
		review: new RetainedAccountThemes(db, home, lease, target),
		retire: () => {
			active = false;
		}
	};
}
const snapshot = (f: ReturnType<typeof fixture>, s = scope) =>
	f.db.transaction(s, 'readonly', f.lease, async (tx) => ({
		things: await tx.list('things'),
		states: await tx.list(ACCOUNT_THEME_SYNC),
		settings: await tx.list('settings'),
		usage: await tx.usage()
	}));

test('offline recovery preserves uncertain requests and placement while repeated/concurrent copies share one private home identity', async () => {
	const f = fixture(),
		oldFetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests++;
		throw Error('Unexpected network');
	};
	try {
		const source = (await f.source.save({ name: 'Retained peach', theme: { colors: { accent: '#bf8068' } }, visibility: 'public' })).theme;
		await f.source.setActive(source.id);
		await f.source.sync({
			snapshot: async () => [],
			write: async () => {
				throw Error('Lost response');
			}
		});
		await f.db.transaction(scope, 'readwrite', f.lease, async (tx) => {
			const row = await tx.get<any>('things', source.id);
			await tx.put('things', source.id, { ...row, folderId: 'old-folder', crystal: { ...row.crystal, title: 'Kept title' } });
			const state = await tx.get<any>(ACCOUNT_THEME_SYNC, source.id);
			await tx.put(ACCOUNT_THEME_SYNC, source.id, { ...state, claim: { owner: 'another-tab', expiresAt: 999999 } });
		});
		const before = await snapshot(f),
			entries = await f.review.list();
		assert.equal(entries.length, 2);
		assert.ok(entries.some((row) => row.kind === 'selection'));
		const review = await f.review.inspect(entries.find((row) => row.kind === 'theme')!);
		const [a, b] = await Promise.all([f.review.copy(review), f.review.copy(review)]);
		assert.equal(a.id, b.id);
		assert.notEqual(a.id, source.id);
		assert.equal(a.folderId, undefined);
		assert.equal(a.crystal.title, 'Kept title');
		assert.equal((a.crystal.theme as any).colors.accent, '#bf8068');
		assert.deepEqual(await snapshot(f), before, 'original content, live claim, frozen command and selection remain byte-for-byte unchanged');
		assert.equal((await f.target.list()).themes.length, 1);
		assert.equal((await f.target.list()).themes[0].visibility, 'private');
		assert.equal((await f.target.list()).activeThemeId, null);
		const exported = await new LocalAccountHomeThemes(f.db, scope, f.lease).export({ ids: [a.id] });
		const manifest = parseTransfer(serializeTransfer((await bundleFromPlan(exported.plan)).manifest));
		assert.equal(manifest.things[0].crystal.title, 'Kept title');
		assert.equal(manifest.things[0].folderId, undefined);
		await f.target.remove(a.id);
		await assert.rejects(f.review.copy(review), /already copied/);
		assert.equal(requests, 0);
	} finally {
		globalThis.fetch = oldFetch;
		await f.db.close();
	}
});

test('changed content or sync intent retires a review; selection and deletion intent never resurrect content', async () => {
	const f = fixture();
	try {
		const row = (await f.source.save({ name: 'Original', theme: {} })).theme;
		await f.source.setActive(row.id);
		const entries = await f.review.list(),
			review = await f.review.inspect(entries.find((entry) => entry.kind === 'theme')!);
		await f.source.save({ id: row.id, name: 'Newer edit', theme: {} });
		await assert.rejects(f.review.copy(review), /changed/);
		assert.equal((await f.target.list()).themes.length, 0);
		const selection = await f.review.inspect(entries.find((entry) => entry.kind === 'selection')!);
		await assert.rejects(f.review.copy(selection), /Choose theme content/);
		await f.source.sync({
			snapshot: async () => [],
			write: async () => {
				throw Error('Unknown completion');
			}
		});
		await f.source.remove(row.id);
		const deleted = (await f.review.list()).find((entry) => entry.kind === 'theme')!;
		assert.ok(deleted);
		await assert.rejects(f.review.copy(await f.review.inspect(deleted)), /no theme content/);
	} finally {
		await f.db.close();
	}
});

test('retained lookup is account/origin scoped and invalidated with its current selected lease', async () => {
	const f = fixture();
	try {
		const row = (await f.source.save({ name: 'Owner only', theme: {} })).theme;
		for (const selected of [
			{ ...scope, ownerId: 'other' },
			{ ...scope, origin: 'https://other.example' }
		]) {
			const target = new AccountThemeSync(f.db, { ...selected, dataPlane: 'home' }, f.lease);
			assert.deepEqual(await new RetainedAccountThemes(f.db, selected, f.lease, target).list(), []);
		}
		assert.throws(() => new RetainedAccountThemes(f.db, { kind: 'anonymous' } as any, f.lease, f.target), /Confirm the account/);
		const entry = (await f.review.list()).find((entry) => entry.id === row.id)!;
		await assert.rejects(f.review.inspect({ ...entry, dataPlane: 'home' }), /Choose a retained theme/);
		const review = await f.review.inspect(entry);
		f.retire();
		await assert.rejects(f.review.copy(review), /Retired account/);
		await assert.rejects(f.review.list(), /Retired account/);
	} finally {
		await f.db.close();
	}
});
