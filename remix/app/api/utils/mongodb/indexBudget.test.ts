import assert from 'node:assert/strict';
import test from 'node:test';

import { fromBin } from '../auth/users.ts';
import {
	MONGODB_COLLECTION_INDEX_LIMIT,
	RETIRED_THINGS_INDEXES,
	backfillConsolidatedThingUniqueKeys,
	createCiControlIndexes,
	createWatchPairingIndexes,
	createIndexReplacingForTests,
	createThingsDataIndexes,
	pruneRebuildTwins,
	pruneRetiredHomeThingsIndexes
} from './collections.ts';
const REQUIRED_INDEX_HEADROOM = 4;
const HOME_ONLY_THINGS_INDEXES = 1; // migration_diagnostic_expires_at
// The CI satellite is deliberately small: two readers, one TTL, one unique.
const CI_CONTROL_INDEX_BUDGET = 8;

const defaultIndexName = (keys: Record<string, unknown>): string =>
	Object.entries(keys)
		.map(([field, direction]) => `${field}_${direction}`)
		.join('_');

const fakeThingsDb = () => {
	const created: string[] = [];
	const dropped: string[] = [];
	const actions: string[] = [];
	const options: Array<{ name: string; keys: Record<string, unknown>; options: Record<string, any> }> = [];
	const collection = {
		async createIndex(keys: Record<string, unknown>, indexOptions: Record<string, unknown> = {}) {
			const name = String(indexOptions.name || defaultIndexName(keys));
			created.push(name);
			options.push({ name, keys, options: indexOptions });
			actions.push(`create:${name}`);
			return name;
		},
		async dropIndex(name: string) {
			dropped.push(name);
			actions.push(`drop:${name}`);
		},
		async updateMany() {
			return { modifiedCount: 0 };
		}
	};
	return {
		db: { collection: () => collection },
		created,
		dropped,
		actions,
		options
	};
};

test('Watch PIN reservations are unique only for active requests and inboxes are indexed by recipient', async () => {
	const fixture = fakeThingsDb();
	await Promise.all(createWatchPairingIndexes(fixture.db.collection()));
	const unique = fixture.options.find((index) => index.name === 'watch_active_pin_unique');
	assert.equal(unique?.options.unique, true);
	assert.deepEqual(unique?.keys, { 'meta.userCodeHash': 1 });
	assert.deepEqual(unique?.options.partialFilterExpression, { purpose: 'watch-pairing', 'meta.shortCodeActive': true });
	assert.ok(fixture.options.some((index) => index.keys['meta.recipientUserId'] === 1 && index.keys.createdAt === -1));
});

test('current Things index plan keeps four slots free below MongoDB hard limit', async () => {
	const fixture = fakeThingsDb();
	await Promise.all(createThingsDataIndexes(fixture.db));
	const desired = new Set(fixture.created);
	const total = 1 + HOME_ONLY_THINGS_INDEXES + desired.size; // MongoDB _id plus home-only TTL

	assert.ok(
		total <= MONGODB_COLLECTION_INDEX_LIMIT - REQUIRED_INDEX_HEADROOM,
		`Things index plan uses ${total}/${MONGODB_COLLECTION_INDEX_LIMIT}; reserve ${REQUIRED_INDEX_HEADROOM} slots for safe upgrades`
	);
	for (const retired of RETIRED_THINGS_INDEXES) assert.equal(desired.has(retired), false, `${retired} must stay retired`);
	// CI control-plane rows live on the ciControl satellite: `things` must not
	// carry their dashboard sort or per-parent history indexes any more
	assert.equal(desired.has('things_ci_repository_updated'), false);
	assert.equal(desired.has('thingtime_1_parentId_1_createdAt_-1_shareId_1'), false);
});

test('the five dead pre-Things indexes measured on production are retired by name', () => {
	const retired = new Set<string>(RETIRED_THINGS_INDEXES);
	for (const dead of [
		'kind_1_typeId_1_ownerId_1_updatedAt_-1_shareId_1',
		'kind_1_typeId_1_search.tokens_1_updatedAt_-1_shareId_1',
		'kind_1_typeId_1_acl.searchKeys_1_updatedAt_-1_shareId_1',
		'kind_1_typeId_1_acl.readKeys_1_updatedAt_-1_shareId_1',
		'kind_1_deletedAt_1_updatedAt_-1_shareId_1',
		'thingtime_1_parentId_1_createdAt_-1_shareId_1',
		'things_ci_repository_updated'
	]) {
		assert.ok(retired.has(dead), `${dead} must be retired`);
	}
});

test('v1-era kind indexes and the sandbox TTL are partial, and their unfiltered originals retire', async () => {
	const fixture = fakeThingsDb();
	await Promise.all(createThingsDataIndexes(fixture.db));
	const retired = new Set<string>(RETIRED_THINGS_INDEXES);
	const partialByName = new Map(fixture.options.map((entry) => [entry.name, entry.options.partialFilterExpression]));
	for (const [name, legacy] of [
		['things_v1_kind_visibility_created', 'kind_1_visibility_1_createdAt_-1_shareId_1'],
		['things_v1_kind_owner_created', 'kind_1_ownerId_1_createdAt_-1_shareId_1'],
		['things_v1_kind_owner_updated', 'kind_1_ownerId_1_updatedAt_-1_shareId_1'],
		['things_v1_kind_created', 'kind_1_createdAt_-1_shareId_1'],
		['things_v1_kind_parent_created', 'kind_1_parentId_1_createdAt_1']
	] as const) {
		assert.deepEqual(partialByName.get(name), { kind: { $exists: true } }, name);
		// swapped in place (create the replacement, THEN drop the old name) —
		// never pruned up front, which would open an index-less window
		assert.equal(retired.has(legacy), false, `${legacy} must be swapped, not pruned`);
		assert.ok(fixture.actions.indexOf(`create:${name}`) < fixture.actions.indexOf(`drop:${legacy}`), name);
	}
	assert.deepEqual(partialByName.get('things_sandbox_expires_at'), { sandboxExpiresAt: { $exists: true } });
	assert.ok(fixture.actions.indexOf('create:things_sandbox_expires_at') < fixture.actions.indexOf('drop:sandboxExpiresAt_1'));
	assert.equal(retired.has('sandboxExpiresAt_1'), false);
});

test('the ciControl satellite plan is small, unique on shareId, and TTL-reaped on expiresAt', async () => {
	const fixture = fakeThingsDb();
	await Promise.all(createCiControlIndexes(fixture.db));
	const byName = new Map(fixture.options.map((entry) => [entry.name, entry]));
	assert.ok(fixture.created.length + 1 <= CI_CONTROL_INDEX_BUDGET, `ciControl uses ${fixture.created.length + 1} indexes`);
	assert.equal(byName.get('ci_control_share_id_unique')?.options.unique, true);
	assert.deepEqual(byName.get('ci_control_share_id_unique')?.keys, { shareId: 1 });
	assert.equal(byName.get('ci_control_expires_at')?.options.expireAfterSeconds, 0);
	assert.deepEqual(byName.get('ci_control_repository_updated')?.keys, {
		thingtime: 1,
		'crystal.repository': 1,
		updatedAt: -1,
		shareId: 1
	});
	assert.deepEqual(byName.get('ci_control_parent_created')?.keys, { thingtime: 1, parentId: 1, createdAt: -1, shareId: 1 });
	assert.deepEqual(byName.get('ci_control_repository_status')?.keys, { thingtime: 1, 'crystal.repository': 1, 'crystal.status': 1 });
	// no text index: CI rows are never searched
	assert.ok(fixture.options.every((entry) => !Object.values(entry.keys).includes('text')));
	assert.ok(fixture.actions.every((action) => action.startsWith('create:')));
});

test('a swap parked at the 64-index cap degrades to drop-then-create instead of failing the ensure', async () => {
	const swapActions: string[] = [];
	let swapCalls = 0;
	const swapCollection = {
		async createIndex(_keys: Record<string, unknown>, options: Record<string, unknown> = {}) {
			swapCalls += 1;
			if (swapCalls === 1) {
				const error: any = new Error('add index fails, too many indexes');
				error.code = 67;
				throw error;
			}
			swapActions.push(`create:${options.name}`);
		},
		async dropIndex(name: string) {
			swapActions.push(`drop:${name}`);
		}
	};
	await createIndexReplacingForTests(swapCollection, { sandboxExpiresAt: 1 }, { name: 'things_sandbox_expires_at' }, ['sandboxExpiresAt_1']);
	assert.deepEqual(swapActions, ['drop:sandboxExpiresAt_1', 'create:things_sandbox_expires_at']);
	// without a legacy name there is nothing to make room with: the cap error surfaces
	let surfaced: any = null;
	try {
		await createIndexReplacingForTests(
			{
				async createIndex() {
					const error: any = new Error('too many indexes');
					error.code = 67;
					throw error;
				},
				async dropIndex() {}
			},
			{ a: 1 },
			{ name: 'a_only' }
		);
	} catch (error) {
		surfaced = error;
	}
	assert.equal(surfaced?.code, 67);
});

test('home layout pruning frees every retired slot before replacement indexes run', async () => {
	const fixture = fakeThingsDb();
	await pruneRetiredHomeThingsIndexes(fixture.db);

	assert.deepEqual(fixture.dropped, [...RETIRED_THINGS_INDEXES]);
	assert.equal(fixture.created.length, 0);
	assert.ok(fixture.actions.every((action) => action.startsWith('drop:')));
});

test('AI and device hashes backfill into domain-separated Binary root keys', async () => {
	const batches: any[][] = [];
	const docs = [
		{ _id: 'ai', crystal: { aiConnectionKey: 'same', externalConversationKey: 'same' } },
		{ _id: 'device', crystal: { deviceUniqueKeys: ['event', 'event', '', 42] } }
	];
	const raw = {
		find() {
			return { batchSize: () => ({ async *[Symbol.asyncIterator]() { yield* docs; } }) };
		},
		async bulkWrite(operations: any[]) {
			batches.push(operations);
		}
	};
	await backfillConsolidatedThingUniqueKeys(raw);
	const operations = batches.flat();
	assert.equal(operations.length, 2);
	assert.deepEqual(operations[0].updateOne.update.$addToSet.uniqueKeys.$each.map(fromBin), [
		'aiConnectionKey:same',
		'externalConversationKey:same'
	]);
	assert.deepEqual(operations[1].updateOne.update.$addToSet.uniqueKeys.$each.map(fromBin), ['deviceUniqueKey:event']);
});

const twinPruneFixture = (names: string[]) => {
	const dropped: string[] = [];
	return {
		dropped,
		db: {
			collection: () => ({
				async indexes() {
					return names.map((name) => ({ name }));
				},
				async dropIndex(name: string) {
					dropped.push(name);
				},
				async createIndex() {
					throw new Error('prune must not create');
				}
			})
		}
	};
};

test('the boot ensure clears redundant rebuild twins so a plan near the cap can converge', async () => {
	const fixture = twinPruneFixture(['_id_', 'shareId_1', 'shareId_1__rebuild', 'tags_1_createdAt_-1_shareId_1']);
	// the original is present, so the twin constrains nothing the original does
	// not — this is the shape that parks the collection at the cap
	assert.deepEqual(await pruneRebuildTwins(fixture.db), ['shareId_1__rebuild']);
	assert.deepEqual(fixture.dropped, ['shareId_1__rebuild']);
	// a fresh database (no things collection yet) is not an error
	const missing = { collection: () => ({ async indexes() { const error: any = new Error('ns not found'); error.code = 26; throw error; }, async dropIndex() {} }) };
	assert.deepEqual(await pruneRebuildTwins(missing), []);
});

test('an ORPHAN twin is left alone: it is the only thing holding a unique key mid-rebuild', async () => {
	// rebuild-things-indexes is between dropIndex('uniqueKeys_1') and its
	// recreate; mongo-warmup fires ensureIndexes on any cold start in that
	// window. Dropping the twin here would silently unprotect the key while
	// the migration still reports it as twinned.
	const fixture = twinPruneFixture(['_id_', 'shareId_1', 'shareId_1__rebuild', 'uniqueKeys_1__rebuild']);
	assert.deepEqual(await pruneRebuildTwins(fixture.db), ['shareId_1__rebuild']);
	assert.equal(fixture.dropped.includes('uniqueKeys_1__rebuild'), false);
});

test('an orphan twin IS dropped when the collection has no free slot left', async () => {
	// a stuck boot ensure (every createIndex failing with CannotCreateIndex) is
	// the worse failure, and the plan recreates the original moments later
	const filler = Array.from({ length: MONGODB_COLLECTION_INDEX_LIMIT - 2 }, (_value, index) => `filler_${index}`);
	const fixture = twinPruneFixture(['_id_', ...filler, 'uniqueKeys_1__rebuild']);
	assert.deepEqual(await pruneRebuildTwins(fixture.db), ['uniqueKeys_1__rebuild']);
});
