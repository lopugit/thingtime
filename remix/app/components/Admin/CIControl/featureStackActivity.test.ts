import assert from 'node:assert/strict';
import test from 'node:test';
import { stackActivities, stackActivitySummary } from './featureStackActivity';
const now = Date.parse('2026-09-12T01:50:00Z');
const heartbeat = {
	at: '2026-09-12T01:45:00Z',
	message: '99%',
	progressPercent: 99,
	expectedFinishAt: null,
	workflowRunUrl: null,
	targets: [
		{ target: 'main', status: 'in_progress', phase: 'Waiting for branch protection to merge the verified stack PR', jobUrl: null },
		{ target: 'develop', status: 'failure', phase: 'Worker failed: Publish an auto-merge PR to the target', jobUrl: null }
	]
};
test('the reported incident shows conflicts, failed publisher and merged target, never 99 percent complete', () => {
	const rows = stackActivities(
		[
			{ target: 'main', status: 'conflicting' },
			{ target: 'develop', status: 'conflicting' },
			{ target: 'github-actions', status: 'merged' }
		],
		heartbeat,
		'in_progress',
		now
	);
	assert.deepEqual(
		rows.map((row) => row.state),
		['blocked', 'failed', 'merged']
	);
	assert.equal(stackActivitySummary(rows).percent, 33);
	assert.match(stackActivitySummary(rows).summary, /1\/3 targets merged/);
});
test('a running merge gate is waiting, closed/failure are not delivery, and stale work is unconfirmed', () => {
	assert.equal(stackActivities([{ target: 'main', status: 'clean' }], heartbeat, 'in_progress', now)[0].state, 'waiting');
	const closed = stackActivities([{ target: 'main', status: 'closed' }], heartbeat, 'success', now);
	assert.equal(stackActivitySummary(closed).finished, false);
	const stale = {
		...heartbeat,
		at: '2026-09-12T00:00:00Z',
		targets: [{ target: 'main', status: 'in_progress', phase: 'Combining sources', jobUrl: null }]
	};
	assert.equal(stackActivities([{ target: 'main', status: 'waiting' }], stale, 'in_progress', now)[0].state, 'unknown');
	assert.equal(stackActivities([{ target: 'main', status: 'waiting' }], heartbeat, 'paused', now)[0].state, 'stopped');
});

test('a fresh worker on an already-conflicting target is shown as working, while a merge gate remains blocked', () => {
	const at = new Date().toISOString();
	const heartbeat = {
		at,
		message: 'working',
		status: 'in_progress',
		progressPercent: 45,
		expectedFinishAt: null,
		workflowRunUrl: null,
		targets: [{ target: 'main', status: 'in_progress', phase: 'Resolving conflicts with the selected AI endpoint waterfall', jobUrl: null }]
	};
	const [row] = stackActivities([{ target: 'main', status: 'conflicting' }], heartbeat, 'in_progress');
	assert.equal(row.state, 'working');
	assert.match(row.next, /still conflicts/);
});
