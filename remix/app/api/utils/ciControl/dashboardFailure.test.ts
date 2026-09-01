import assert from 'node:assert/strict';
import test from 'node:test';

import { CI_DASHBOARD_QUERY_CAPACITY_CODE, CI_DASHBOARD_ROUTE, ciDashboardCapacityFailure, isCiDashboardSortMemoryError } from './dashboardFailure';

test('CI dashboard classifies MongoDB blocking-sort memory failures only', () => {
	assert.equal(isCiDashboardSortMemoryError({ code: 292, codeName: 'QueryExceededMemoryLimitNoDiskUseAllowed' }), true);
	assert.equal(isCiDashboardSortMemoryError({ codeName: 'QueryExceededMemoryLimitNoDiskUseAllowed' }), true);
	assert.equal(isCiDashboardSortMemoryError({ code: 11000, codeName: 'DuplicateKey' }), false);
	assert.equal(isCiDashboardSortMemoryError(new Error('private database detail')), false);
});

test('CI dashboard capacity failure is retryable, observable, and does not expose Mongo details', () => {
	const failure = ciDashboardCapacityFailure({
		name: 'MongoServerError',
		code: 292,
		codeName: 'QueryExceededMemoryLimitNoDiskUseAllowed',
		message: 'PlanExecutor error with private namespace and query text'
	});
	assert.ok(failure);
	assert.equal(failure.status, 503);
	assert.equal(failure.retryAfterSeconds, 30);
	assert.deepEqual(failure.body, {
		ok: false,
		error: 'CI dashboard data is temporarily unavailable. Last-known cached data remains safe to use.',
		code: CI_DASHBOARD_QUERY_CAPACITY_CODE,
		retryable: true
	});
	assert.equal(failure.log.route, CI_DASHBOARD_ROUTE);
	assert.equal(failure.log.mongoCode, 292);
	assert.doesNotMatch(JSON.stringify(failure), /private namespace|query text/);
});

test('CI dashboard leaves unrelated failures to the shared server error boundary', () => {
	assert.equal(ciDashboardCapacityFailure({ code: 'ECONNRESET' }), null);
});
