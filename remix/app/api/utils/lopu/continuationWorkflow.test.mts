import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { createRequire } from 'node:module';
import { Binary } from 'mongodb';
import { AI_TASK_KIND } from './backgroundTaskCore';

let refuseChildAdmission = false;
let existingTaskRead: ((row:any) => Promise<any>) | null = null;
let missingTaskRead: (() => Promise<null>) | null = null;
let rows: any[] = [],
	executions = 0,
	liveSession = true,
	stopDuringSleep = false,
	stopBeforeClaim = false;
const matches = (row: any, filter: any) =>
	Object.entries(filter).every(([key, expected]: any) => {
		if (key === '$or') return expected.some((part: any) => matches(row, part));
		const actual = key.split('.').reduce((value: any, part: string) => value?.[part], row);
		if (expected && typeof expected === 'object' && '$exists' in expected) return (actual !== undefined) === expected.$exists;
		if (expected && typeof expected === 'object' && '$ne' in expected) return actual !== expected.$ne;
		return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
	});
const collection = {
	findOne: async (filter: any) => {const row=rows.find((row)=>matches(row,filter)); if(row && filter['crystal.requestId'] && existingTaskRead){const hook=existingTaskRead;existingTaskRead=null;return hook(row);} if(!row && filter['crystal.requestId'] && missingTaskRead) {const hook=missingTaskRead;missingTaskRead=null;return hook();}return row||null;},
	updateMany: async (filter: any, update: any) => {
		for (const row of rows.filter((row) => matches(row, filter))) await collection.updateOne({ shareId: row.shareId }, update);
	},
	updateOne: async (filter: any, update: any) => {
		if (stopBeforeClaim && update.$set?.workerStarted) rows[0].cancelRequested = true;
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
	row.workerFinishedAt = new Date();
	row.targetId = 'chat';
 delete rows[0].activeWorkerRequestId;
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
			const input = await request.json();
   if (refuseChildAdmission) return Response.json({ok:false,error:'Rate limited'},{status:429});
   const existing=rows.find(row=>row.crystal.requestId===input.requestId);
   if(existing) return Response.json({task:{id:existing.shareId}},{status:202});
   executions++;
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
	executions = 0; refuseChildAdmission=false; missingTaskRead=null; existingTaskRead=null;
	liveSession = true;
	stopDuringSleep = false;
	stopBeforeClaim = false;
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
 assert.ok(rows[0].uniqueKeys, 'uncertain execution stays fenced');
 assert.equal(rows[0].crystal.status, 'running', 'late receipts remain writable');
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

test('an unacknowledged child keeps its receipt sink and conversation claim after lease expiry', async () => {
	const { continuationRequestId } = await import('./continuationCore');
	done(rows[0], 'checkpoint');
	const receipt = new Binary(Buffer.from('saved partial receipt'));
	const child: any = {
		shareId: 'child',
		ownerId: 'owner',
		taskScope: 'scope',
		rootTaskId: 'root',
		thingtime: [AI_TASK_KIND],
		workerStarted: true,
		deadlineAt: new Date(0),
		secure: receipt,
		crystal: { requestId: await continuationRequestId('chat', 'first'), status: 'running' }
	};
	rows.push(child);
	await runLopuContinuation('root');
	assert.equal(executions, 0);
	assert.equal(child.crystal.status, 'running');
	assert.equal(rows[0].cancelRequested, true);
	assert.equal(child.secure, receipt);
	assert.equal(rows[0].crystal.workflowStatus, 'needs-attention');
	assert.ok(rows[0].uniqueKeys);
 assert.equal(rows[0].crystal.stage, 'Waiting for worker to stop');
});
test('Stop winning the worker claim race prevents provider execution', async () => {
	stopBeforeClaim = true;
	await runLopuContinuation('root');
	assert.equal(executions, 0);
	assert.equal(rows[0].crystal.workflowStatus, 'stopped');
});

test('root cancellation safely retires a reservation before a delayed child is inserted', async () => {
 done(rows[0], 'checkpoint');
 rows[0].activeWorkerRequestId = 'reserved-child';
 const {finishLopuWorkflow} = await import('./continuationSteps.server');
 assert.equal(await finishLopuWorkflow('root', 'stopped'), true);
 assert.equal(rows[0].uniqueKeys,undefined);
 assert.equal(rows[0].cancelRequested, true);
 assert.equal(rows[0].workflowInput, undefined);
 assert.equal((await runLopuPart('root', 'first', 0)).reason, 'stopped');
 assert.equal(executions, 0);
});

test('Stop in the first-part reservation gap releases only an unclaimed cancelled root', async () => {
 rows[0].activeWorkerRequestId = 'first';
 const {finishLopuWorkflow} = await import('./continuationSteps.server');
 assert.equal(await finishLopuWorkflow('root', 'stopped'), true);
 assert.equal(rows[0].uniqueKeys, undefined);
 assert.equal((await runLopuPart('root', null, 0)).reason, 'stopped');
 assert.equal(executions, 0);
});

test('stale child admission clears a reservation reacquired after another executor acknowledged', async () => {
 done(rows[0],'checkpoint');
 let release!: (value:null)=>void;
 let started!: ()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 missingTaskRead=()=>{started();return new Promise<null>(resolve=>{release=resolve;});};
 const pending=runLopuPart('root','first',0); await ready;
 const {continuationRequestId}=await import('./continuationCore');
 const child:any={shareId:'child',ownerId:'owner',taskScope:'scope',rootTaskId:'root',thingtime:[AI_TASK_KIND],workerStarted:true,crystal:{requestId:await continuationRequestId('chat','first')}};
 done(child,'end_turn'); rows.push(child); release(null);
 assert.equal((await pending).reason,'completed');
 assert.equal(rows[0].activeWorkerRequestId,undefined);
 assert.equal(executions,0);
 const {finishLopuWorkflow}=await import('./continuationSteps.server');
 assert.equal(await finishLopuWorkflow('root','completed'),true);
 assert.equal(rows[0].uniqueKeys,undefined);
});

test('stale unclaimed child snapshot observes another acknowledgment after losing the worker claim', async () => {
 done(rows[0],'checkpoint');
 const {continuationRequestId}=await import('./continuationCore');
 const child:any={shareId:'child',ownerId:'owner',taskScope:'scope',rootTaskId:'root',thingtime:[AI_TASK_KIND],crystal:{requestId:await continuationRequestId('chat','first'),status:'running'}};
 rows.push(child);
 let release!:(value:any)=>void; let started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 existingTaskRead=async(row:any)=>{const snapshot={...row,crystal:{...row.crystal}}; started(); await new Promise(resolve=>{release=resolve;});return snapshot;};
 const pending=runLopuPart('root','first',0); await ready;
 child.workerStarted=true; done(child,'checkpoint'); release(null);
 assert.equal((await pending).next,child.crystal.requestId);
 assert.equal(rows[0].activeWorkerRequestId,undefined);
 assert.equal(executions,0);
 const {finishLopuWorkflow}=await import('./continuationSteps.server');
 assert.equal(await finishLopuWorkflow('root','completed'),true);
 assert.equal(rows[0].uniqueKeys,undefined);
});

test('refused child admission retires its unused reservation without replaying work', async () => {
 done(rows[0],'checkpoint'); refuseChildAdmission=true;
 await runLopuContinuation('root');
 assert.equal(executions,0);
 assert.equal(rows[0].crystal.workflowStatus,'needs-attention');
 assert.equal(rows[0].activeWorkerRequestId,undefined);
 assert.equal(rows[0].uniqueKeys,undefined);
 assert.equal(rows[0].cancelRequested,true);
});
