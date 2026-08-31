import assert from 'node:assert/strict';
import test from 'node:test';

import { CI_DASHBOARD_UPDATED_INDEX, CI_DASHBOARD_UPDATED_SORT, ciDashboardKindFilter } from './dashboardQueryCore';

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
