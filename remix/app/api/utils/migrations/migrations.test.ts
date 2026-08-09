import assert from 'node:assert/strict';
import test from 'node:test';

import { userStoragePrerequisites } from './migrations.ts';

test('whole-account storage accounting repairs builtin schema seeds first', () => {
	const ids = userStoragePrerequisites().map((migration) => migration.id);
	assert.equal(ids.filter((id) => id === 'seed-builtin-schemas').length, 1);
	assert.ok(ids.indexOf('seed-builtin-schemas') > ids.indexOf('things-v1-to-v2'));
	assert.ok(ids.indexOf('seed-builtin-schemas') < ids.indexOf('backfill-app-namespace-fields'));
});
