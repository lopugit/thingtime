import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ALL_PULL_REQUEST_STATUS_FILTER_IDS,
	matchesPullRequestStatusFilter,
	normalizePullRequestStatus,
	PULL_REQUEST_STATUS_FILTERS
} from './statusFilterCore';

test('the CI filter exposes every pull-request status emitted by reconciliation', () => {
	assert.deepEqual(ALL_PULL_REQUEST_STATUS_FILTER_IDS, ['clean', 'conflicting', 'draft', 'merged', 'closed', 'unknown']);
	assert.deepEqual(
		PULL_REQUEST_STATUS_FILTERS.map(({ label }) => label),
		['Clean', 'Conflicting', 'Draft', 'Merged', 'Closed', 'Unknown']
	);
});

test('pull-request statuses are normalized before exact filtering', () => {
	assert.equal(normalizePullRequestStatus('  MERGED '), 'merged');
	assert.equal(normalizePullRequestStatus(null), 'unknown');
	assert.equal(matchesPullRequestStatusFilter('CONFLICTING', ['clean', 'conflicting']), true);
	assert.equal(matchesPullRequestStatusFilter('merged', ['clean']), false);
	assert.equal(matchesPullRequestStatusFilter(undefined, ['unknown']), true);
});
