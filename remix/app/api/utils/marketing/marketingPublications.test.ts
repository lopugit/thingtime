import assert from 'node:assert/strict';
import test from 'node:test';

import { HUB_KEY, pageKey, sectionKey } from '~/marketing/publishing';
import { createMarketingPublicationsStore } from './marketingPublications';
import { applyWritePlan, normalizeStoredItems, planPublicationWrite, projectPublications, type StoredPublicationItem } from './marketingPublicationsCore';

const at = new Date('2026-09-05T10:00:00.000Z');

test('stored rows are normalized against the catalog: junk, stale keys and wrong states drop out', () => {
	const items = normalizeStoredItems([
		{ key: HUB_KEY, state: 'published', at: at.toISOString(), by: 'nik' },
		{ key: HUB_KEY, state: 'published', at, by: 'lopu' }, // duplicate key: last wins
		{ key: 'page:not-in-the-catalog', state: 'published', at, by: 'nik' },
		{ key: pageKey('landing/feed'), state: 'hidden', at, by: 'nik' }, // pages cannot be hidden
		{ key: sectionKey('landing/feed', 'social'), state: 'hidden', at: 'not a date', by: 42 },
		'junk',
		null
	]);
	assert.deepEqual(
		items.map(({ key, state, by }) => ({ key, state, by })),
		[
			{ key: HUB_KEY, state: 'published', by: 'lopu' },
			{ key: sectionKey('landing/feed', 'social'), state: 'hidden', by: null }
		]
	);
	assert.equal(items[1].at.getTime(), 0, 'an unreadable timestamp falls back to the epoch instead of dropping the row');
});

test('projection splits published from hidden and only admins get the audit trail', () => {
	const items: StoredPublicationItem[] = [
		{ key: HUB_KEY, state: 'published', at, by: 'nik' },
		{ key: sectionKey('landing/feed', 'social'), state: 'hidden', at, by: null }
	];
	assert.deepEqual(projectPublications(items, at, { audit: false }), {
		published: [HUB_KEY],
		hidden: [sectionKey('landing/feed', 'social')],
		updatedAt: at.toISOString()
	});
	assert.deepEqual(projectPublications(items, 'garbage', { audit: true }), {
		published: [HUB_KEY],
		hidden: [sectionKey('landing/feed', 'social')],
		updatedAt: null,
		audit: {
			[HUB_KEY]: { at: at.toISOString(), by: 'nik' },
			[sectionKey('landing/feed', 'social')]: { at: at.toISOString(), by: null }
		}
	});
});

test('a write plan removes every touched key and re-adds only the non-null states', () => {
	const plan = planPublicationWrite(
		[
			{ key: HUB_KEY, state: 'published' },
			{ key: pageKey('landing/feed'), state: null },
			{ key: sectionKey('landing/feed', 'social'), state: 'hidden' }
		],
		{ at, by: 'nik' }
	);
	assert.deepEqual(plan.removeKeys, [HUB_KEY, pageKey('landing/feed'), sectionKey('landing/feed', 'social')]);
	assert.deepEqual(plan.addItems, [
		{ key: HUB_KEY, state: 'published', at, by: 'nik' },
		{ key: sectionKey('landing/feed', 'social'), state: 'hidden', at, by: 'nik' }
	]);
	const before: StoredPublicationItem[] = [
		{ key: pageKey('landing/feed'), state: 'published', at: new Date(0), by: 'old' },
		{ key: pageKey('landing/messages'), state: 'published', at: new Date(0), by: 'old' }
	];
	assert.deepEqual(applyWritePlan(before, plan).map((item) => item.key), [pageKey('landing/messages'), HUB_KEY, sectionKey('landing/feed', 'social')]);
});

test('the store validates changes, writes a plan, and serves last-known-good then nothing when reads fail', async () => {
	let stored: { items: StoredPublicationItem[]; updatedAt: Date } | null = null;
	let failReads = false;
	const writes: unknown[] = [];
	const store = createMarketingPublicationsStore({
		readStored: async () => {
			if (failReads) throw new Error('mongo down');
			return stored;
		},
		writeItems: async (plan, meta) => {
			writes.push(plan);
			stored = { items: applyWritePlan(stored?.items ?? [], plan), updatedAt: meta.at };
		}
	});

	assert.deepEqual(await store.getPublications({ audit: false }), { published: [], hidden: [], updatedAt: null });

	const rejected = await store.applyChanges([{ key: 'page:nope', state: 'published' }], 'nik');
	assert.deepEqual(rejected, { ok: false, status: 400, error: 'Unknown page: nope' });
	assert.equal(writes.length, 0, 'nothing is written when validation fails');

	const applied = await store.applyChanges(
		[
			{ key: HUB_KEY, state: 'published' },
			{ key: pageKey('landing/feed'), state: 'published' },
			{ key: sectionKey('landing/feed', 'social'), state: 'hidden' }
		],
		'nik'
	);
	assert.equal(applied.ok, true);
	if (applied.ok) {
		assert.equal(applied.applied, 3);
		assert.deepEqual(applied.publications.published, [HUB_KEY, pageKey('landing/feed')]);
		assert.deepEqual(applied.publications.hidden, [sectionKey('landing/feed', 'social')]);
		assert.equal(applied.publications.audit?.[HUB_KEY]?.by, 'nik');
		assert.ok(applied.publications.updatedAt);
	}

	const cleared = await store.applyChanges([{ key: pageKey('landing/feed'), state: null }], 'nik');
	assert.equal(cleared.ok, true);
	if (cleared.ok) assert.deepEqual(cleared.publications.published, [HUB_KEY]);

	failReads = true;
	const fallback = await store.getPublications({ audit: false });
	assert.deepEqual(fallback.published, [HUB_KEY], 'a read outage serves the last-known-good state');
	assert.equal(fallback.audit, undefined);

	const coldStore = createMarketingPublicationsStore({
		readStored: async () => {
			throw new Error('mongo down');
		},
		writeItems: async () => {}
	});
	assert.deepEqual(await coldStore.getPublications({ audit: true }), { published: [], hidden: [], updatedAt: null, audit: {} }, 'with nothing known, an outage publishes nothing');
});
