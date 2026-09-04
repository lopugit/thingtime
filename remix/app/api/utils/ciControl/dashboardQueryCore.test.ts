import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CI_DASHBOARD_ACTIVITY_LIMIT,
	CI_DASHBOARD_SELECTION_LIMIT,
	CI_DASHBOARD_UPDATED_INDEX,
	CI_DASHBOARD_UPDATED_SORT,
	ciDashboardFieldFilter,
	ciDashboardKindFilter,
	ciDashboardReadLimit
} from './dashboardQueryCore';

test('CI dashboard reads one repository through an index-compatible stable sort', () => {
	assert.deepEqual(ciDashboardKindFilter('ci-event', ' lopugit/thingtime '), {
		thingtime: 'ci-event',
		'crystal.repository': 'lopugit/thingtime'
	});
	assert.deepEqual(CI_DASHBOARD_UPDATED_SORT, { updatedAt: -1, shareId: 1 });
	assert.deepEqual(CI_DASHBOARD_UPDATED_INDEX, {
		thingtime: 1,
		'crystal.repository': 1,
		updatedAt: -1,
		shareId: 1
	});
});

test('unlimited dashboard reads stay unlimited only for selectable repository entities', () => {
	assert.equal(ciDashboardReadLimit('ci-feature', 0), 0);
	assert.equal(ciDashboardReadLimit('ci-branch', 0), 0);
	assert.equal(ciDashboardReadLimit('ci-pull-request', 0), 0);
	assert.equal(ciDashboardReadLimit('ci-workflow-run', 0), CI_DASHBOARD_ACTIVITY_LIMIT);
	assert.equal(ciDashboardReadLimit('ci-deployment', 10_000), CI_DASHBOARD_ACTIVITY_LIMIT);
	assert.equal(ciDashboardReadLimit('ci-preview', Number.NaN), 100);
	assert.equal(ciDashboardReadLimit('ci-pull-request', -1), 1);
	assert.equal(ciDashboardReadLimit('ci-feature', 10_000), CI_DASHBOARD_SELECTION_LIMIT);
	assert.deepEqual(ciDashboardFieldFilter('ci-pull-request', ' lopugit/thingtime ', 'state', ['OPEN', 'open']), {
		thingtime: 'ci-pull-request',
		'crystal.repository': 'lopugit/thingtime',
		'crystal.state': { $in: ['OPEN', 'open'] }
	});
});
