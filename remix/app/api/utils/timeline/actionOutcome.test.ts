import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createActionTimelineRecorder } from './actionOutcome';
import { newThingMutationCapture } from './recordMutation';
import { withTimelineMutationContext } from './mutationContext';
import { readActionOutcome } from '../../../timeline/actionOutcome';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract';
import { historyCard, historyComparison } from '../../../timeline/browserModel';
import { splitTimelineEvent, joinTimelineEvent } from '../../../timeline/records';

const result = { status: 'ok' as const, durationMs: 10, opsUsed: 3, depthUsed: 0, childActionsUsed: 0 };
const runId = () => `action-run-${randomUUID()}`;
test('accepted and completed Action events reuse AI provenance and canonical relational records', async () => {
	const events: TimelineEvent[] = [];
	const recorder = createActionTimelineRecorder(async (event) => {
		events.push(event);
	});
	await withTimelineMutationContext('owner', 'ai', () =>
		withTimelineMutationContext('owner', 'action', async () => {
			const start = await recorder.begin('owner', 'action', runId());
			const capture = newThingMutationCapture('owner');
			const receipt = await recorder.finish(start, { ...result, inputs: 'secret-input', result: 'secret-result', error: 'secret-error' } as any);
			assert.deepEqual(receipt, { status: 'recorded', startedEventId: start.id, outcomeEventId: events[1].id });
			assert.equal(start.operationId, capture.operationId);
			assert.equal(start.source, 'ai');
		})
	);
	assert.equal(events.length, 2);
	assert.deepEqual(events[1].parentIds, [events[0].id]);
	assert.equal(events[1].operationId, events[0].operationId);
	assert.equal(events[1].before, null);
	assert.equal(JSON.stringify(events).includes('secret-'), false);
	for (const event of events) {
		assert.deepEqual(parseTimelineEvent(event), event);
		const normalized = splitTimelineEvent(event);
		assert.deepEqual(joinTimelineEvent(normalized.event, normalized.links), event);
		assert.ok(readActionOutcome(event));
	}
	const card = historyCard({ scope: 'owner', event: events[1], status: 'accepted', receipt: null, accessedAt: 0, bytes: 1 });
	assert.equal(card.title, 'Action');
	assert.deepEqual(card.kinds, ['action']);
	assert.deepEqual(card.chips, []);
	assert.equal(card.removed, false);
	assert.ok(historyComparison(events[0], events[1]).error);
});

test('admission requires trusted matching actor and propagates storage failure before execution', async () => {
	let writes = 0;
	const recorder = createActionTimelineRecorder(async () => {
		writes++;
		throw new Error('quota');
	});
	await assert.rejects(recorder.begin('owner', 'action', runId()), /trusted/);
	await withTimelineMutationContext('other', 'action', () => assert.rejects(recorder.begin('owner', 'action', runId()), /trusted/));
	assert.equal(writes, 0);
	await withTimelineMutationContext('owner', 'action', () => assert.rejects(recorder.begin('owner', 'action', runId()), /quota/));
	assert.equal(writes, 1);
});

test('lost completion acknowledgement retries one immutable receipt, not the execution', async () => {
	const attempts: TimelineEvent[] = [];
	const recorder = createActionTimelineRecorder(async (event) => {
		attempts.push(event);
		if (attempts.length === 2) throw new Error('lost acknowledgement');
	});
	await withTimelineMutationContext('owner', 'action', async () => {
		const start = await recorder.begin('owner', 'action', runId());
		assert.equal((await recorder.finish(start, result)).status, 'recorded');
	});
	assert.equal(attempts.length, 3);
	assert.deepEqual(attempts[1], attempts[2]);
});

test('unavailable completion remains explicitly incomplete after bounded receipt retries', async () => {
	const attempts: TimelineEvent[] = [];
	const recorder = createActionTimelineRecorder(async (event) => {
		attempts.push(event);
		if (attempts.length > 1) throw new Error('quota');
	});
	await withTimelineMutationContext('owner', 'action', async () => {
		const start = await recorder.begin('owner', 'action', runId());
		assert.deepEqual(await recorder.finish(start, { ...result, status: 'error' }), {
			status: 'incomplete',
			startedEventId: start.id,
			outcomeEventId: null
		});
	});
	assert.equal(attempts.length, 4);
	assert.deepEqual(attempts.slice(1), [attempts[1], attempts[1], attempts[1]]);
	assert.equal(readActionOutcome(attempts[1])?.status, 'error');
});

test('client-supplied or malformed outcome snapshots cannot impersonate server evidence in History', async () => {
	const recorder = createActionTimelineRecorder(async () => {});
	const start = await withTimelineMutationContext('owner', 'action', () => recorder.begin('owner', 'action', runId()));
	for (const patch of [
		{ source: 'client', clientId: 'device' },
		{ mode: 'draft' },
		{ actorId: 'other' },
		{ branchId: 'other' },
		{ parentIds: ['unexpected'] }
	])
		assert.equal(readActionOutcome({ ...start, ...patch } as TimelineEvent), null);
	for (const patch of [
		{ inputs: 'secret' },
		{ actionName: null },
		{ actionName: 'a'.repeat(161) },
		{ status: 'complete' },
		{ durationMs: 1 },
		{ startedAt: '2026-02-30T00:00:00.000Z' }
	])
		assert.equal(readActionOutcome({ ...start, after: { ...start.after!, value: { ...(start.after!.value as any), ...patch } } }), null);
	await assert.rejects(recorder.finish(start, { ...result, durationMs: -1 }), /Invalid Action outcome/);
});
