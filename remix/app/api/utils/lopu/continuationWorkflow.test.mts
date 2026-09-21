import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { createRequire } from 'node:module';
import { Binary } from 'mongodb';
import { AI_TASK_KIND } from './backgroundTaskCore';

let rows: any[] = [],
	executions = 0,
	liveSession = true,
	stopDuringSleep = false;
const matches = (row: any, filter: any) =>
	Object.entries(filter).every(([key, expected]: any) => {
		const actual = key.split('.').reduce((value: any, part: string) => value?.[part], row);
		if (expected && typeof expected === 'object' && '$ne' in expected) return actual !== expected.$ne;
		return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
	});
const collection = {
	findOne: async (filter: any) => rows.find((row) => matches(row, filter)) || null,
	updateOne: async (filter: any, update: any) => {
		const row = rows.find((row) => matches(row, filter));
		if (!row) return { matchedCount: 0 };
		for (const [key, value] of Object.entries(update.$set || {})) {
			const parts = key.split('.');
			if (parts.length === 1) row[key] = value;
			else row[parts[0]][parts[1]] = value;
		}
		for (const key of Object.keys(update.$unset || {})) delete row[key];
		return { matchedCount: 1 };
	}
};
const done = (row: any, stopReason: string, safe = true) => {
	row.targetId = 'chat';
	row.crystal.status = stopReason === 'end_turn' ? 'completed' : 'needs-attention';
	row.secure = new Binary(Buffer.from(JSON.stringify({ type: 'done', assistantMessageId: 'saved', stopReason, continuationSafe: safe }) + '\n'));
};
mock.module('../mongodb/collections', { namedExports: { getHomeThingsCollection: async () => collection } });
mock.module('../auth/getCurrentUser', {
	namedExports: {
		resolveSessionUser: async (session: string, owner: string) =>
			liveSession && session === 'session' && owner === 'owner' ? { id: owner, accountKind: 'user' } : null
	}
});
mock.module('~/routes/api/v1/lopu/chats/reply/_reply', { namedExports: { replyAsUser: async () => new Response() } });
mock.module('./liveActivity', { namedExports: { refreshLopuLiveActivitiesForOwner: async () => {} } });
const workflowExports = {
	RetryableError: class extends Error {},
	sleep: async () => {
		if (stopDuringSleep) rows[0].cancelRequested = true;
	}
};
mock.module('workflow', { namedExports: workflowExports });
mock.module(createRequire(import.meta.url).resolve('workflow'), { namedExports: workflowExports });
mock.module('./backgroundTasks', {
	namedExports: {
		executeBackgroundTask: async (_request: Request, _execute: any, row: any) => {
			executions++;
			done(row, 'checkpoint');
		},
		startBackgroundTask: async (request: Request, _execute: any, internal: any) => {
			executions++;
			const input = await request.json();
			assert.equal(input.continueFromRequestId, rows[0].crystal.requestId);
			assert.equal(input.automaticContinuation, true);
			assert.equal(input.context.page.blocks, undefined);
			assert.equal(input.attachmentIds, undefined);
			assert.equal(input.confirmations, undefined);
			assert.equal(internal.rootTaskId, 'root');
			const row = {
				shareId: 'child',
				ownerId: 'owner',
				taskScope: 'scope',
				rootTaskId: 'root',
				thingtime: [AI_TASK_KIND],
				crystal: { requestId: input.requestId }
			};
			done(row, 'end_turn');
			rows.push(row);
			return Response.json({ task: { id: row.shareId } }, { status: 202 });
		}
	}
});
const { runLopuContinuation } = await import('./continuationWorkflow.server');
const { runLopuPart } = await import('./continuationSteps.server');
beforeEach(() => {
	executions = 0;
	liveSession = true;
	stopDuringSleep = false;
	rows = [
		{
			shareId: 'root',
			ownerId: 'owner',
			taskScope: 'scope',
			thingtime: [AI_TASK_KIND],
			targetId: 'chat',
			uniqueKeys: ['claim'],
			deadlineAt: new Date(Date.now() + 30_000),
			crystal: { requestId: 'first', status: 'running', workflowStatus: 'running' },
			workflowInput: new Binary(
				Buffer.from(
					JSON.stringify({
						sessionId: 'session',
						url: 'https://example.test/api/v1/lopu/chats/reply',
						input: {
							requestId: 'first',
							chatId: 'chat',
							management: 'server',
							text: 'Build it',
							model: 'chosen',
							attachmentIds: ['file'],
							confirmations: [{ key: 'spent' }],
							context: { page: { id: 'page', blocks: ['old draft'] } }
						}
					})
				)
			)
		}
	];
});

test('durable workflow continues without any browser and clears its private grant on completion', async () => {
	await runLopuContinuation('root');
	assert.equal(executions, 2);
	assert.equal(rows[0].crystal.workflowStatus, 'completed');
	assert.equal(rows[0].workflowInput, undefined);
	assert.equal(rows[0].uniqueKeys, undefined);
});
test('Stop between checkpoints prevents the next turn', async () => {
	stopDuringSleep = true;
	await runLopuContinuation('root');
	assert.equal(executions, 1);
	assert.equal(rows[0].crystal.workflowStatus, 'stopped');
});
test('revoked sessions cannot run or resume provider work', async () => {
	liveSession = false;
	await runLopuContinuation('root');
	assert.equal(executions, 0);
	assert.equal(rows[0].crystal.workflowStatus, 'stopped');
});
test('redelivery reads a completed checkpoint without repeating inference', async () => {
	done(rows[0], 'checkpoint');
	const result = await runLopuPart('root', null, 0);
	assert.equal(result.next, 'first');
	assert.equal(executions, 0);
});
test('lost worker with an uncertain side effect never replays the operation', async () => {
	rows[0].workerStarted = true;
	rows[0].deadlineAt = new Date(0);
	await runLopuContinuation('root');
	assert.equal(executions, 0);
	assert.equal(rows[0].crystal.workflowStatus, 'needs-attention');
});
test('confirmation boundary stops automatic recovery', async () => {
	done(rows[0], 'checkpoint', false);
	await runLopuContinuation('root');
	assert.equal(executions, 0);
	assert.equal(rows[0].crystal.workflowStatus, 'needs-attention');
});

test('redelivery waits durably while another worker lease is live', async () => {
	rows[0].workerStarted = true;
	const result = await runLopuPart('root', null, 0);
	assert.equal(result.pending, true);
	assert.equal(result.delay, 30_000);
	assert.equal(executions, 0);
});
