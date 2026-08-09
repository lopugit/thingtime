import assert from 'node:assert/strict';
import test from 'node:test';

import { builtinSchemaSeedNeedsRefresh, exactDocumentSnapshotMatch, storageMigrationOwnership } from './migrationCore.ts';

test('legacy conversion delete pins the full source even without updatedAt', () => {
	const source = { _id: 'legacy-1', email: 'person@example.test', nested: { value: 1 } };
	const match = exactDocumentSnapshotMatch(source) as any;
	assert.equal(match._id, source._id);
	assert.equal(Object.prototype.hasOwnProperty.call(match, 'updatedAt'), false);
	assert.deepEqual(match.$expr, { $eq: ['$$ROOT', { $literal: source }] });
	assert.notDeepEqual(match.$expr.$eq[1].$literal, { ...source, nested: { value: 2 } });
});

test('billable content with no current user remains unresolved', () => {
	const known = new Set(['user-1']);
	assert.equal(storageMigrationOwnership({ ownerId: 'user-1', thingtime: ['data'] }, known), 'known-user');
	assert.equal(storageMigrationOwnership({ ownerId: 'missing-user', thingtime: ['data'] }, known), 'unknown-user');
	assert.equal(storageMigrationOwnership({ ownerId: 'missing-user', thingtime: ['subscription'], storageClass: 'control' }, known), 'excluded');
	assert.equal(storageMigrationOwnership({ ownerId: 'system', thingtime: ['schema'], storageClass: 'control' }, known), 'excluded');
	assert.equal(storageMigrationOwnership({ ownerId: 'user-1', thingtime: ['schema'] }, known), 'known-user');
});

test('builtin schema seed treats a missing control-plane stamp as repairable drift', () => {
	const crystal = { id: 'service-quota', name: 'Service quota' };
	assert.equal(builtinSchemaSeedNeedsRefresh({ crystal }, crystal), true);
	assert.equal(builtinSchemaSeedNeedsRefresh({ crystal, storageClass: 'content' }, crystal), true);
	assert.equal(builtinSchemaSeedNeedsRefresh({ crystal, storageClass: 'control' }, crystal), false);
	assert.equal(
		builtinSchemaSeedNeedsRefresh({ crystal: { ...crystal, name: 'Stale' }, storageClass: 'control' }, crystal),
		true
	);
});
