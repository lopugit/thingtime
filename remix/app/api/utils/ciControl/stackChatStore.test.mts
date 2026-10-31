import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

// In-memory collection boundary. Exercise the actual store's atomic predicates,
// retries, exact dispatch scoping and public projection without touching live CI.
let rows: any[] = [];
const get = (row: any, path: string) => path.split('.').reduce((value, key) => value?.[key], row);
const matches = (row: any, query: any): boolean =>
	Object.entries(query).every(([key, value]: any) => {
		if (key === '$or') return value.some((q: any) => matches(row, q));
		const actual = get(row, key);
		if (value && typeof value === 'object' && !(value instanceof Date))
			return Object.entries(value).every(([op, v]: any) => {
				if (op === '$exists') return (actual !== undefined) === v;
				if (op === '$lte') return actual <= v;
				if (op === '$lt') return actual < v;
				if (op === '$gt') return actual > v;
				if (op === '$gte') return actual >= v;
				if (op === '$nin') return !v.includes(actual);
				throw new Error(`Unsupported test predicate ${op}`);
			});
		return Array.isArray(actual) ? actual.includes(value) : actual === value;
	});
const assign = (row: any, path: string, value: any, remove = false) => {
	const keys = path.split('.');
	const last = keys.pop()!;
	const target = keys.reduce((o, key) => (o[key] ??= {}), row);
	if (remove) delete target[last];
	else target[last] = value;
};
const update = (row: any, patch: any) => {
	for (const [key, value] of Object.entries(patch.$set ?? {})) assign(row, key, value);
	for (const [key, value] of Object.entries(patch.$inc ?? {})) assign(row, key, (get(row, key) ?? 0) + Number(value));
	for (const key of Object.keys(patch.$unset ?? {})) assign(row, key, null, true);
};
const db = {
	findOne: async (q: any) => structuredClone(rows.find((row) => matches(row, q)) ?? null),
	find: (q: any) => {
		let found = rows.filter((row) => matches(row, q));
		const cursor = {
			sort: (sort: any) => {
				found.sort((a, b) => {
					for (const [key, direction] of Object.entries(sort)) {
						if (get(a, key) < get(b, key)) return -Number(direction);
						if (get(a, key) > get(b, key)) return Number(direction);
					}
					return 0;
				});
				return cursor;
			},
			limit: (n: number) => {
				found = found.slice(0, n);
				return cursor;
			},
			toArray: async () => structuredClone(found)
		};
		return cursor;
	},
	updateOne: async (q: any, patch: any, options: any = {}) => {
		let row = rows.find((row) => matches(row, q));
		if (!row && options.upsert) {
			row = structuredClone(patch.$setOnInsert);
			rows.push(row);
		}
		if (!row) return { matchedCount: 0 };
		update(row, patch);
		return { matchedCount: 1 };
	},
	updateMany: async (q: any, patch: any) => {
		rows.filter((row) => matches(row, q)).forEach((row) => update(row, patch));
	},
	findOneAndUpdate: async (q: any, patch: any) => {
		const row = rows.find((row) => matches(row, q));
		if (!row) return null;
		update(row, patch);
		return structuredClone(row);
	}
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getCiControlCollection: async () => db } });
mock.module(new URL('./githubClient.ts', import.meta.url).href, { namedExports: { repositoryName: () => 'owner/repo' } });
const { enqueueStackQuestion, pollStackChat, readStackChat } = await import('./stackChat');
const runId = 'feature-stack-run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = { runId, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'What is waiting?' };
const worker = { runId, workflowRunId: 123, runAttempt: 1, available: true, reply: null };
beforeEach(() => {
	rows = [
		{ shareId: 'stack', thingtime: ['ci-feature-stack'], crystal: { lastDispatchId: 'dispatch', status: 'running' } },
		{
			shareId: 'dispatch',
			parentId: 'stack',
			thingtime: ['ci-dispatch'],
			crystal: { repository: 'owner/repo', featureStackRunId: runId, workflowRunId: 123, runStatus: 'in_progress' }
		}
	];
});
test('a question travels queued -> answering -> answered and retries never duplicate or overwrite it', async () => {
	await pollStackChat(worker);
	const question = await enqueueStackQuestion(input, 'admin');
	assert.equal(question.status, 'queued');
	assert.deepEqual(await enqueueStackQuestion(input, 'admin'), question);
	await assert.rejects(enqueueStackQuestion({ ...input, question: 'different' }, 'admin'));
	const { message } = await pollStackChat(worker);
	assert.equal(message?.id, question.id);
	assert.equal((await pollStackChat(worker)).message, null);
	assert.equal((await readStackChat(runId)).messages[0].status, 'answering');
	const reply = { id: question.id, lease: message!.lease, status: 'answered', answer: 'main is waiting for required checks.' };
	assert.equal((await pollStackChat({ ...worker, reply })).replyAccepted, true);
	assert.equal((await pollStackChat({ ...worker, reply })).replyAccepted, true);
	const history = await readStackChat(runId);
	assert.equal(history.messages.length, 1);
	assert.equal(history.messages[0].answer, reply.answer);
	assert.equal(JSON.stringify(history).includes(message!.lease), false);
	assert.equal(JSON.stringify(history).includes('actorId'), false);
	assert.equal(rows[2].ownerId, 'system');
	assert.deepEqual(rows[2].acl, []);
	assert.equal(Math.round((rows[2].expiresAt - rows[2].createdAt) / 86400000), 90);
});
test('wrong runs, old attempts, held/replaced stacks and offline responders cannot claim new work', async () => {
	await assert.rejects(pollStackChat({ ...worker, workflowRunId: 124 }));
	await pollStackChat({ ...worker, runAttempt: 2 });
	await assert.rejects(pollStackChat(worker));
	rows[0].crystal.status = 'stopped';
	await assert.rejects(enqueueStackQuestion(input, 'admin'));
	rows[0].crystal.status = 'running';
	rows[0].crystal.lastDispatchId = 'new-dispatch';
	await assert.rejects(enqueueStackQuestion(input, 'admin'));
	rows[0].crystal.lastDispatchId = 'dispatch';
	await pollStackChat({ ...worker, runAttempt: 2, available: false });
	assert.equal((await readStackChat(runId)).online, false);
	await assert.rejects(enqueueStackQuestion(input, 'admin'));
});
test('expired deliveries retry once; obsolete lease cannot publish; another disconnect becomes visible failure', async () => {
	await pollStackChat(worker);
	const question = await enqueueStackQuestion(input, 'admin');
	const first = (await pollStackChat(worker)).message!;
	rows[2].crystal.leaseUntil = new Date(0);
	const second = (await pollStackChat({ ...worker, runAttempt: 2 })).message!;
	assert.notEqual(first.lease, second.lease);
	const badReply = { id: question.id, lease: first.lease, status: 'answered', answer: 'obsolete' };
	assert.equal((await pollStackChat({ ...worker, runAttempt: 2, reply: badReply })).replyAccepted, false);
	assert.equal((await readStackChat(runId)).messages[0].answer, null);
	rows[2].crystal.leaseUntil = new Date(0);
	assert.equal((await pollStackChat({ ...worker, runAttempt: 2 })).message, null);
	assert.equal((await readStackChat(runId)).messages[0].status, 'failed');
});
