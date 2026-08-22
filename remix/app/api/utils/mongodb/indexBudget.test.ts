import assert from 'node:assert/strict';
import test from 'node:test';

import { RETIRED_THINGS_INDEXES, createThingsDataIndexes, pruneRetiredHomeThingsIndexes } from './collections.ts';

const MONGODB_COLLECTION_INDEX_LIMIT = 64;
const REQUIRED_INDEX_HEADROOM = 4;
const HOME_ONLY_THINGS_INDEXES = 1; // migration_diagnostic_expires_at

const defaultIndexName = (keys: Record<string, unknown>): string =>
	Object.entries(keys)
		.map(([field, direction]) => `${field}_${direction}`)
		.join('_');

const fakeThingsDb = () => {
	const created: string[] = [];
	const dropped: string[] = [];
	const actions: string[] = [];
	const collection = {
		async createIndex(keys: Record<string, unknown>, options: Record<string, unknown> = {}) {
			const name = String(options.name || defaultIndexName(keys));
			created.push(name);
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
		actions
	};
};

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
});

test('home layout pruning frees every retired slot before replacement indexes run', async () => {
	const fixture = fakeThingsDb();
	await pruneRetiredHomeThingsIndexes(fixture.db);

	assert.deepEqual(fixture.dropped, [...RETIRED_THINGS_INDEXES]);
	assert.equal(fixture.created.length, 0);
	assert.ok(fixture.actions.every((action) => action.startsWith('drop:')));
});
