import assert from 'node:assert/strict';
import test from 'node:test';

import { featureStackRunOutcome, latestFeatureStackHeartbeat, legacyFeatureStackWorkflowRunId, sortFeatureStackTimeline } from './featureStackRunCore';

test('Feature Stack timeline is stable and chronological', () => {
	assert.deepEqual(
		sortFeatureStackTimeline([
			{ key: 'later', at: '2026-09-01T00:10:00Z', message: 'later' },
			{ key: 'first', at: '2026-08-31T08:21:00Z', message: 'first' },
			{ key: 'same-a', at: '2026-09-01T00:00:00Z', message: 'same-a' },
			{ key: 'same-b', at: '2026-09-01T00:00:00Z', message: 'same-b' }
		]).map((line) => line.key),
		['first', 'same-a', 'same-b', 'later']
	);
});

test('a successful controller without a published target needs attention instead of staying live', () => {
	assert.deepEqual(
		featureStackRunOutcome({ runStatus: 'success', allTargetsFinished: false, hasPublishedTarget: false, dispatchAccepted: true }),
		{ live: false, needsAttention: true, state: 'needs-attention' }
	);
	assert.equal(
		featureStackRunOutcome({ runStatus: 'in_progress', allTargetsFinished: false, hasPublishedTarget: false, dispatchAccepted: true }).live,
		true
	);
});

test('legacy Feature Stack correlation requires the exact validation job within the dispatch window', () => {
	const startedAt = '2026-08-31T08:21:00Z';
	assert.equal(
		legacyFeatureStackWorkflowRunId({
			startedAt,
			runs: [
				{ runId: 10, event: 'workflow_dispatch', startedAt: '2026-08-31T08:21:20Z' },
				{ runId: 11, event: 'workflow_dispatch', startedAt: '2026-08-31T08:21:30Z' }
			],
			jobs: [
				{ runId: 10, title: 'Some unrelated job' },
				{ runId: 11, title: 'control-plane / Validate the immutable Feature Stack' }
			]
		}),
		11
	);
});

test('the latest durable heartbeat drives progress and links to the exact run', () => {
	assert.deepEqual(
		latestFeatureStackHeartbeat([
			{ eventType: 'feature_stack_progress', occurredAt: '2026-09-01T00:00:00Z', data: { message: 'Queued.', progressPercent: 5 } },
			{ eventType: 'workflow_run', occurredAt: '2026-09-01T00:30:00Z', data: { message: 'Ignore me.', progressPercent: 99 } },
			{ eventType: 'feature_stack_progress', occurredAt: '2026-09-01T00:10:00Z', data: { message: 'Resolving main.', progressPercent: 48, expectedFinishAt: '2026-09-01T00:40:00Z', workflowRunUrl: 'https://github.com/lopugit/thingtime/actions/runs/123' } }
		]),
		{ at: '2026-09-01T00:10:00Z', message: 'Resolving main.', progressPercent: 48, expectedFinishAt: '2026-09-01T00:40:00Z', workflowRunUrl: 'https://github.com/lopugit/thingtime/actions/runs/123' }
	);
});
