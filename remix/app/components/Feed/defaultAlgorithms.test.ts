import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ALGORITHMS, isDefaultAlgorithm } from './defaultAlgorithms';
import { rankSubspacePosts } from '../../api/utils/subspaces/subspaceCore';
test('feed builtin IDs are reserved and distinguish personal IDs', () => {
	assert.equal(DEFAULT_ALGORITHMS.length, 8);
	for (const item of DEFAULT_ALGORITHMS) assert.equal(isDefaultAlgorithm(item.id), true);
	assert.equal(isDefaultAlgorithm('personal-profile'), false);
	assert.equal(isDefaultAlgorithm('__proto__'), false);
});
test('vote rankings differentiate popularity, recency, growth and divided votes', () => {
	const now = Date.now();
	const rows = [
		{ id: 'old', createdAtMs: now - 30 * 86400000, up: 100, down: 0, pinned: false },
		{ id: 'fresh', createdAtMs: now - 60000, up: 5, down: 0, pinned: false },
		{ id: 'divided', createdAtMs: now - 3600000, up: 30, down: 29, pinned: false }
	];
	assert.equal(rankSubspacePosts(rows, 'top', now)[0], 'old');
	assert.equal(rankSubspacePosts(rows, 'new', now)[0], 'fresh');
	assert.equal(rankSubspacePosts(rows, 'rising', now)[0], 'fresh');
	assert.equal(rankSubspacePosts(rows, 'controversial', now)[0], 'divided');
	assert.equal(rankSubspacePosts(rows, 'hot', now)[0], 'fresh');
});
