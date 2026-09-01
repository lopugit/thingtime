import assert from 'node:assert/strict';
import test from 'node:test';

import { CI_DASHBOARD_MAX_RETRY_DELAY_MS, CiDashboardSingleFlight, ciDashboardRetryDelayMs, shouldPollCiDashboard } from './dashboardPollingCore';

test('CI dashboard refresh failures back off exponentially and cap at five minutes', () => {
	assert.equal(ciDashboardRetryDelayMs(1), 30_000);
	assert.equal(ciDashboardRetryDelayMs(2), 60_000);
	assert.equal(ciDashboardRetryDelayMs(3), 120_000);
	assert.equal(ciDashboardRetryDelayMs(9), CI_DASHBOARD_MAX_RETRY_DELAY_MS);
});

test('CI dashboard respects a longer server retry hint without exceeding the cap', () => {
	assert.equal(ciDashboardRetryDelayMs(1, { retryAfterSeconds: 90 }), 90_000);
	assert.equal(ciDashboardRetryDelayMs(1, { retryAfterSeconds: 900 }), CI_DASHBOARD_MAX_RETRY_DELAY_MS);
});

test('background polls wait for the retry window while a manual refresh can bypass it', () => {
	assert.equal(shouldPollCiDashboard(1_000, 2_000), false);
	assert.equal(shouldPollCiDashboard(2_000, 2_000), true);
	assert.equal(shouldPollCiDashboard(1_000, 2_000, true), true);
});

test('overlapping CI dashboard refreshes share one request', async () => {
	const singleFlight = new CiDashboardSingleFlight();
	let starts = 0;
	let release!: () => void;
	const pending = () => {
		starts += 1;
		return new Promise<void>((resolve) => {
			release = resolve;
		});
	};
	const first = singleFlight.run(pending);
	const second = singleFlight.run(pending);
	assert.equal(first, second);
	assert.equal(starts, 1);
	release();
	await first;
	await Promise.resolve();
	const third = singleFlight.run(async () => {
		starts += 1;
	});
	assert.notEqual(third, first);
	await third;
	assert.equal(starts, 2);
});
