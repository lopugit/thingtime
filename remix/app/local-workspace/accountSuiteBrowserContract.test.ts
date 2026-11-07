import assert from 'node:assert/strict';
import test from 'node:test';
import type { RootLoaderData } from '../root-data.server';
import { accountSuiteBrowserWorkspace, accountSuiteScrollCheckpoints } from './accountSuiteBrowserContract';

test('browser suite fixture reads the canonical root-data actor and selected plane exactly', () => {
	const user: Pick<NonNullable<RootLoaderData['user']>, 'id' | 'temporary'> = { id: 'fixture-actor', temporary: false };
	const custom = `custom-${'a'.repeat(64)}`;
	assert.deepEqual(accountSuiteBrowserWorkspace({ user, dataPlane: custom }, user.id), { ownerId: user.id, dataPlane: custom });
	assert.deepEqual(accountSuiteBrowserWorkspace({ user, dataPlane: 'home' }, user.id), { ownerId: user.id, dataPlane: 'home' });
	for (const value of [{ user: null, dataPlane: 'home' }, { data: { user, dataPlane: 'home' } },
		{ user: { _id: user.id }, dataPlane: 'home' }, { user: { ...user, temporary: true }, dataPlane: 'home' }])
		assert.throws(() => accountSuiteBrowserWorkspace(value, user.id), /authenticated persistent account/);
	assert.throws(() => accountSuiteBrowserWorkspace({ user, dataPlane: custom }, 'different-actor'), /different effective account/);
	assert.throws(() => accountSuiteBrowserWorkspace({ user, dataPlane: 'selected-database' }, user.id), /recognized selected data plane/);
});

test('suite capture covers page endpoints and large nested panes with a finite observation budget', () => {
	assert.deepEqual(accountSuiteScrollCheckpoints(0, 844, 'page'), [0]);
	assert.deepEqual(accountSuiteScrollCheckpoints(10000000, 240, 'pane'), [0, 5000000, 10000000]);
	for (const maxScroll of [1, 844, 10000000]) {
		const points = accountSuiteScrollCheckpoints(maxScroll, 844, 'page');
		assert.equal(points[0], 0);
		assert.equal(points.at(-1), maxScroll);
		assert.ok(points.length <= 33);
		assert.ok(points.every((point, index) => !index || point > points[index - 1]));
		if (maxScroll < 10000000) assert.ok(points.slice(1).every((point, index) => point - points[index] <= 844 * 0.8));
	}
	for (const [maxScroll, height] of [[Infinity, 100], [100, 0], [-1, 240], [100, NaN]])
		assert.throws(() => accountSuiteScrollCheckpoints(maxScroll, height, 'page'), /Invalid suite capture/);
});
