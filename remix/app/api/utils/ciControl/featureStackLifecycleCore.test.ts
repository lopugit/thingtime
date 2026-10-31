import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FEATURE_STACK_USER_HELD_STATUSES,
	featureStackCanPause,
	featureStackCanRestart,
	featureStackCanStop,
	featureStackLifecycleStatus,
	featureStackRunCanCancel
} from './featureStackLifecycleCore';

test('Feature Stack lifecycle controls expose only honest actions', () => {
	assert.deepEqual(FEATURE_STACK_USER_HELD_STATUSES, ['paused', 'stopped']);
	assert.equal(featureStackCanPause('running'), true);
	assert.equal(featureStackCanPause('failure'), false);
	assert.equal(featureStackCanStop('paused'), true);
	assert.equal(featureStackCanStop('stopped'), false);
	assert.equal(featureStackCanRestart('stopped'), true);
	assert.equal(featureStackCanRestart('archived'), false);
	assert.equal(featureStackLifecycleStatus('pause'), 'paused');
	assert.equal(featureStackLifecycleStatus('stop'), 'stopped');
});

test('only cancellable GitHub workflow states are treated as active', () => {
	for (const status of ['requested', 'queued', 'in_progress', 'running', 'waiting']) {
		assert.equal(featureStackRunCanCancel(status), true, status);
	}
	for (const status of ['success', 'failure', 'cancelled', 'completed']) {
		assert.equal(featureStackRunCanCancel(status), false, status);
	}
});
