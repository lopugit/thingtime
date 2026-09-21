import assert from 'node:assert/strict';
import { mock, test, beforeEach } from 'node:test';
const rows: any[] = [],
	pending: Promise<unknown>[] = [];
let chatAccessible = true;
let user: any = { id: 'owner', accountKind: 'user', temporary: false };
const match = (row: any, filter: any) =>
	Object.entries(filter).every(([key, value]: any) => {
		if (key === '$or') return value.some((part: any) => match(row, part));
		const actual = key.split('.').reduce((r: any, part: string) => r?.[part], row);
		if (value && typeof value === 'object' && '$ne' in value) return actual !== value.$ne;
		if (value && typeof value === 'object' && '$lt' in value) return actual < value.$lt;
		return Array.isArray(actual) ? actual.includes(value) : actual === value;
	});
const patch = (row: any, update: any) => {
	for (const [key, value] of Object.entries(update.$set || {})) {
		const parts = key.split('.');
		if (parts.length === 1) row[key] = value;
		else row[parts[0]][parts[1]] = value;
	}
	for (const key of Object.keys(update.$unset || {})) delete row[key];
};
const collection: any = {
	findOne: async (filter: any) => rows.find((row) => match(row, filter)) || null,
	find: (filter: any) => ({ sort: () => ({ limit: () => ({ toArray: async () => rows.filter((row) => match(row, filter)) }) }) }),
	insertOne: async (row: any) => {
		if (
			rows.some(
				(old) =>
					old.shareId === row.shareId ||
					(row.uniqueKeys && old.uniqueKeys && Buffer.from(old.uniqueKeys[0].value()).equals(Buffer.from(row.uniqueKeys[0].value())))
			)
		)
			throw Object.assign(new Error('duplicate'), { code: 11000 });
		rows.push(row);
	},
	updateOne: async (filter: any, update: any) => {
		const row = rows.find((row) => match(row, filter));
		if (row) patch(row, update);
		return { matchedCount: row ? 1 : 0 };
	},
	updateMany: async (filter: any, update: any) => {
		rows.filter((row) => match(row, filter)).forEach((row) => patch(row, update));
	}
};
mock.module('@vercel/functions', { namedExports: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } });
mock.module('../mongodb/collections', { namedExports: { getHomeThingsCollection: async () => collection } });
mock.module('../mongodb/endpoint', {
	namedExports: { getRequestMongoEndpoint: async (request: Request) => request.headers.get('x-test-endpoint') || null }
});
mock.module('../auth/getCurrentUser', { namedExports: { getCurrentUser: async () => user } });
mock.module('../messenger/lopuChats', {
	namedExports: { persistLopuUserTurn: async (_owner: string, input: any) => chatAccessible ? { ok: true, messages: [input] } : { ok: false, status: 404, error: 'Not found' }, getLopuChat: async () => (chatAccessible ? { ok: true } : { ok: false, status: 404, error: 'Not found' }) }
});
mock.module('../rateLimit/enforce', {
	namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 }) }
});
const { startBackgroundTask, readBackgroundTasks, stopBackgroundTask } = await import('./backgroundTasks');
beforeEach(() => {
	chatAccessible = true;
	rows.length = 0;
	pending.length = 0;
	user = { id: 'owner', accountKind: 'user', temporary: false };
});
const request = (id = 'once', body: any = { text: 'hello', requestId: id }, signal?: AbortSignal) =>
	new Request('https://example.test/api/v1/lopu/chats/reply', {
		method: 'POST',
		signal,
		headers: { 'Content-Type': 'application/json', 'X-Thingtime-Background-Id': id, 'X-Thingtime-Task-Owner': 'owner' },
		body: JSON.stringify(body)
	});
const read = (id: string, offset = 0, origin = 'https://example.test') =>
	readBackgroundTasks(new Request(`${origin}/api/v1/lopu/tasks?id=${id}&offset=${offset}`));
test('accepted inference survives caller cancellation and identical concurrent admission executes once', async () => {
	let calls = 0;
	let release: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const execute = async (req: Request) => {
		calls++;
		await gate;
		assert.equal(req.signal.aborted, false);
		return new Response('{"type":"meta","chatId":"chat"}\n{"type":"delta","text":"Saved"}\n{"type":"done"}\n', {
			headers: { 'Content-Type': 'application/x-ndjson' }
		});
	};
	const abort = new AbortController();
	const [a, b] = await Promise.all([startBackgroundTask(request('once', undefined, abort.signal), execute), startBackgroundTask(request(), execute)]);
	assert.equal(a.status, 202);
	assert.equal(b.status, 202);
	abort.abort();
	release!();
	await Promise.all(pending);
	assert.equal(calls, 1);
	assert.equal(rows.length, 1);
	const detail = await (await read(rows[0].shareId)).json();
	assert.equal(detail.task.status, 'completed');
	assert.equal(detail.task.chatId, 'chat');
	assert.match(detail.output, /Saved/);
	const overview = await (await readBackgroundTasks(new Request('https://example.test/api/v1/lopu/tasks'))).json();
	assert.equal('secure' in overview.tasks[0], false);
	assert.equal('output' in overview.tasks[0], false);
});
test('owner, origin, data source and immutable payload fence replay and output', async () => {
	const execute = async () => new Response('ok');
	await startBackgroundTask(request(), execute);
	await Promise.all(pending);
	assert.equal((await startBackgroundTask(request('once', { text: 'different' }), execute)).status, 409);
	const id = rows[0].shareId;
	user = { id: 'other', accountKind: 'user' };
	assert.equal((await read(id)).status, 404);
	assert.equal((await startBackgroundTask(request(), execute)).status, 401);
	user = { id: 'owner', accountKind: 'user' };
	assert.equal((await read(id, 0, 'https://other.test')).status, 404);
	assert.equal(
		(await readBackgroundTasks(new Request(`https://example.test/api/v1/lopu/tasks?id=${id}`, { headers: { 'x-test-endpoint': 'other-db' } })))
			.status,
		404
	);
});
test('a done frame does not turn an interrupted or token-limited reply into success', async () => {
	await startBackgroundTask(
		request(),
		async () =>
			new Response('{"type":"delta","text":"partial"}\n{"type":"done","stopReason":"max_tokens"}\n', {
				headers: { 'Content-Type': 'application/x-ndjson' }
			})
	);
	await Promise.all(pending);
	const result = await (await read(rows[0].shareId)).json();
	assert.equal(result.task.status, 'needs-attention');
	assert.match(result.output, /partial/);
});
test('server stop reaches only its accepted task, and stale execution never restarts', async () => {
	let calls = 0;
	const accepted = await startBackgroundTask(request(), async (req) => {
		calls++;
		await new Promise<void>((resolve) => req.signal.addEventListener('abort', () => resolve(), { once: true }));
		return new Response('{"type":"done","stopReason":"aborted"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
	});
	const { task } = await accepted.json();
	const stop = await stopBackgroundTask(
		new Request('https://example.test/api/v1/lopu/tasks', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: task.id, action: 'stop' })
		})
	);
	assert.equal(stop.status, 200);
	await Promise.all(pending);
	assert.equal(rows[0].crystal.status, 'stopped');
	rows[0].crystal.status = 'running';
	rows[0].deadlineAt = new Date(0);
	const detail = await (await read(task.id)).json();
	assert.equal(detail.task.status, 'needs-attention');
	assert.equal(calls, 1);
});

test('browser-facing origin survives the local reverse proxy and rejects a foreign origin', async () => {
	const headers = {
		'Content-Type': 'application/json',
		'X-Thingtime-Background-Id': 'proxy',
		Origin: 'https://public.test',
		'x-forwarded-host': 'public.test',
		'x-forwarded-proto': 'https'
	};
	const req = new Request('http://127.0.0.1:10000/api/v1/lopu/chats/reply', { method: 'POST', headers, body: JSON.stringify({ text: 'proxy' }) });
	assert.equal((await startBackgroundTask(req, async () => new Response('ok'))).status, 202);
	await Promise.all(pending);
	const bad = new Request(req.url, { method: 'POST', headers: { ...headers, Origin: 'https://foreign.test' }, body: '{}' });
	assert.equal((await startBackgroundTask(bad, async () => new Response('wrong'))).status, 401);
});
test('EOF without done stays interrupted and output expires without releasing its operation id', async () => {
	let calls = 0;
	const execute = async () => {
		calls++;
		return new Response('{"type":"delta","text":"kept"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
	};
	await startBackgroundTask(request(), execute);
	await Promise.all(pending);
	assert.equal((await (await read(rows[0].shareId)).json()).task.status, 'needs-attention');
	rows[0].outputExpiresAt = new Date(0);
	assert.equal((await read(rows[0].shareId)).status, 410);
	assert.equal(rows[0].secure.value().length, 0);
	assert.equal((await startBackgroundTask(request(), execute)).status, 202);
	assert.equal(calls, 1);
});

test('Stop before admission leaves a tombstone that prevents late execution', async () => {
	const stopped = await stopBackgroundTask(
		new Request('https://example.test/api/v1/lopu/tasks', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ requestId: 'late', action: 'stop' })
		})
	);
	assert.equal(stopped.status, 200);
	let calls = 0;
	assert.equal(
		(
			await startBackgroundTask(request('late'), async () => {
				calls++;
				return new Response('wrong');
			})
		).status,
		409
	);
	assert.equal(calls, 0);
});

test('bounded output preserves a Unicode pair and rechecks conversation access', async () => {
	const output = 'a'.repeat(65535) + '🦄' + 'tail';
	await startBackgroundTask(request('unicode', { chatId: 'owned-chat', text: 'hello' }), async () => new Response(output));
	await Promise.all(pending);
	const id = rows[0].shareId;
	const first = await (await read(id)).json();
	const next = await (await read(id, first.offset)).json();
	assert.equal(first.output + next.output, output);
	assert.equal(first.offset, 65535);
	chatAccessible = false;
	assert.equal((await read(id)).status, 404);
});
test('two operation ids cannot concurrently execute against one existing chat', async () => {
	let release: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const execute = async () => {
		calls++;
		await gate;
		return new Response('done');
	};
	const results = await Promise.all(
		['first', 'second'].map((id) => startBackgroundTask(request(id, { chatId: 'owned-chat', text: 'hello', requestId: id }), execute))
	);
	assert.deepEqual(results.map((r) => r.status).sort(), [202, 409]);
	assert.equal(calls, 1);
	release!();
	await Promise.all(pending);
});


test('a healthy worker renews its lease beyond the old task deadline without aborting', async () => {
 mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date('2026-09-17T00:00:00Z') });
 let release!: () => void;
 let workerSignal!: AbortSignal;
 const gate = new Promise<void>(resolve => { release = resolve; });
 try {
  await startBackgroundTask(request('long-work'), async req => {
   workerSignal = req.signal;
   await gate;
   return new Response('{"type":"done","stopReason":"end_turn"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  });
  for (let i = 0; i < 20; i++) {
   mock.timers.tick(20_000);
   await new Promise(resolve => setImmediate(resolve));
   assert.ok(rows[0].deadlineAt.getTime() > Date.now());
   assert.equal(workerSignal.aborted, false);
  }
  release(); await Promise.all(pending);
  assert.equal(rows[0].crystal.status, 'completed');
 } finally { release?.(); await Promise.all(pending); mock.timers.reset(); }
});

test('notes are persisted without cancelling an active task and recheck scope/membership', async () => {
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const accepted = await startBackgroundTask(request('note-target', { chatId: 'chat', text: 'work', requestId: 'note-target' }), async () => { await gate; return new Response('done'); });
 const { task } = await accepted.json();
 const note = (origin = 'https://example.test', text = 'Extra detail') => new Request(`${origin}/api/v1/lopu/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Thingtime-Task-Owner': 'owner' }, body: JSON.stringify({ action: 'note', id: task.id, noteId: 'note-1', text }) });
 try {
 const first = await stopBackgroundTask(note());
 assert.equal(first.status, 200);
 const payload = await first.json();
 assert.equal(payload.active, true);
 assert.equal(payload.messages[0].text, 'Extra detail');
 const replay = await (await stopBackgroundTask(note())).json();
 assert.equal(replay.messages[0].requestId, payload.messages[0].requestId);
 assert.notEqual(rows[0].cancelRequested, true);
 assert.equal((await stopBackgroundTask(note('https://other.test'))).status, 404);
 chatAccessible = false;
 assert.equal((await stopBackgroundTask(note())).status, 404);
 assert.equal((await stopBackgroundTask(note('https://example.test', 'x'.repeat(8001)))).status, 400);
 } finally { release(); await Promise.all(pending); }
});

test('durable child claims execution before its handler begins and Stop cancels the root', async () => {
 rows.push({shareId:'root',ownerId:'owner',thingtime:['lopu-background-task'],taskScope:'scope',crystal:{status:'needs-attention',workflowStatus:'running'}});
 let calls=0;
 const response=await startBackgroundTask(request('child',{chatId:'chat',requestId:'child',text:'Continue',management:'server'}), async () => {
  calls++; assert.equal(rows.find(row=>row.crystal.requestId==='child').workerStarted,true);
  return new Response('{"type":"done","stopReason":"checkpoint"}\n',{headers:{'Content-Type':'application/x-ndjson'}});
 }, {user,scope:'scope',rootTaskId:'root',wait:true});
 assert.equal(response.status,202); assert.equal(calls,1);
 const child=rows.find(row=>row.crystal.requestId==='child');
 // Stop's authenticated request scope must match the stored scope.
 const {backgroundTaskScopeFor}=await import('./backgroundTaskScope');
 const stopRequest=new Request('https://example.test/api/v1/lopu/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop',id:child.shareId})});
 const scope=await backgroundTaskScopeFor(stopRequest); rows[0].taskScope=scope; child.taskScope=scope;
 assert.equal((await stopBackgroundTask(stopRequest)).status,200); assert.equal(rows[0].cancelRequested,true); assert.equal(child.cancelRequested,true);
});
