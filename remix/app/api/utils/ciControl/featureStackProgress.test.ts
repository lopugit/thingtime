import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFeatureStackProgressRequest } from './featureStackProgress';

const body = {
	deliveryId: 'feature-stack-run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:123:2:4',
	repository: 'lopugit/thingtime',
	stackId: 'ci-feature-stack-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	featureStackRunId: 'feature-stack-run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	workflowRunId: 123,
	workflowRunUrl: 'https://github.com/lopugit/thingtime/actions/runs/123',
	runAttempt: 2,
	startedAt: '2026-09-01T00:00:00.000Z',
	reportedAt: '2026-09-01T00:10:00.000Z',
	expectedFinishAt: '2026-09-01T00:30:00.000Z',
	status: 'in_progress',
	message: 'Lopu is resolving 1 of 2 target branches.',
	progressPercent: 48,
	targets: [
		{ target: 'main', status: 'in_progress', phase: 'Resolving conflicts with Lopu', progressPercent: 55, jobUrl: 'https://github.com/lopugit/thingtime/actions/runs/123/job/456' },
		{ target: 'develop', status: 'queued', phase: 'Waiting for an available worker', progressPercent: 0, jobUrl: null }
	]
};

test('parses a fresh, bounded Feature Stack progress report', () => {
	const parsed = parseFeatureStackProgressRequest(body, { repository: body.repository, now: Date.parse(body.reportedAt) });
	assert.equal(parsed?.workflowRunId, 123);
	assert.equal(parsed?.targets[0]?.phase, 'Resolving conflicts with Lopu');
});

test('rejects stale, mismatched, or unsafe Feature Stack progress reports', () => {
	assert.equal(parseFeatureStackProgressRequest(body, { repository: 'another/repo', now: Date.parse(body.reportedAt) }), null);
	assert.equal(parseFeatureStackProgressRequest(body, { repository: body.repository, now: Date.parse(body.reportedAt) + 10 * 60_000 + 1 }), null);
	assert.equal(parseFeatureStackProgressRequest({ ...body, workflowRunUrl: 'https://example.com/123' }, { repository: body.repository, now: Date.parse(body.reportedAt) }), null);
	assert.equal(parseFeatureStackProgressRequest({ ...body, targets: [...body.targets, body.targets[0]] }, { repository: body.repository, now: Date.parse(body.reportedAt) }), null);
});
