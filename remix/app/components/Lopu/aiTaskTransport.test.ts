import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeAiTask, type AiTaskFrame } from './aiTaskTransport';
import { canContinueLopuReply } from './lopuRecovery';
const input = { url: '/api/v1/lopu/chats/reply', method: 'POST', headers: {}, body: '{"text":"hello"}', ownerId: 'owner', requestId: 'stable-id' };
const task = { id: 'task', status: 'completed', responseStatus: 200, contentType: 'application/x-ndjson' };
test('an uncertain admission reuses its operation id and resumes the original output', async () => {
	const headers: string[] = [],
		frames: AiTaskFrame[] = [];
	let starts = 0;
	await observeAiTask(
		input,
		(frame) => frames.push(frame),
		async (url, init) => {
			if (url === input.url) {
				headers.push(new Headers(init?.headers).get('X-Thingtime-Background-Id')!);
				if (++starts === 1) throw new Error('Lost acknowledgement after commit');
				return Response.json({ task }, { status: 202 });
			}
			return Response.json({ ownerId: 'owner', task, output: '{"type":"done"}\n', offset: 16, length: 16 });
		}
	);
	assert.deepEqual(headers, ['stable-id', 'stable-id']);
	assert.deepEqual(
		frames.map((f) => f.type),
		['head', 'chunk', 'end']
	);
});
test('large saved output is read in contiguous slices without replaying inference', async () => {
	const offsets: string[] = [],
		frames: AiTaskFrame[] = [];
	let starts = 0;
	await observeAiTask(
		input,
		(frame) => frames.push(frame),
		async (url) => {
			if (url === input.url) {
				starts++;
				return Response.json({ task }, { status: 202 });
			}
			offsets.push(String(url));
			const first = offsets.length === 1;
			return Response.json({ ownerId: 'owner', task, output: first ? 'one' : 'two', offset: first ? 3 : 6, length: 6 });
		}
	);
	assert.equal(starts, 1);
	assert.match(offsets[0], /offset=0$/);
	assert.match(offsets[1], /offset=3$/);
	assert.deepEqual(
		frames.filter((f) => f.type === 'chunk').map((f) => f.text),
		['one', 'two']
	);
});
test('finished error and budget stops retain a Continue action after done', () => {
	for (const reason of ['checkpoint', 'error', 'max_tokens', 'tool_limit', 'hop_limit', 'time_limit', 'aborted'])
		assert.equal(canContinueLopuReply('done', reason), true);
	assert.equal(canContinueLopuReply('done', 'end_turn'), false);
});


test('a healthy observer keeps reading beyond the former 310-second deadline', async () => {
 const originalNow = Date.now;
 let now = 0, reads = 0;
 Date.now = () => now;
 try {
  await observeAiTask(input, () => {}, async url => {
   if (url === input.url) return Response.json({ task }, { status: 202 });
   reads++; now += 600_000;
   return Response.json({ ownerId: 'owner', task: { ...task, status: reads === 1 ? 'running' : 'completed' }, output: 'x', offset: reads, length: 2 });
  });
  assert.equal(reads, 2);
 } finally { Date.now = originalNow; }
});


test('transient observation failures reconnect to the same job instead of replaying work', async () => {
 let starts = 0, reads = 0;
 const delays: number[] = [];
 await observeAiTask(input, () => {}, async url => {
  if (url === input.url) { starts++; return Response.json({ task }, { status: 202 }); }
  if (++reads <= 5) throw new Error('offline');
  return Response.json({ ownerId: 'owner', task, output: '', offset: 0, length: 0 });
 }, async ms => { delays.push(ms); });
 assert.equal(starts, 1); assert.equal(reads, 6); assert.ok(delays.every(ms => ms <= 30_000));
});

test('account changes detach the observer immediately', async () => {
 let reads = 0;
 await assert.rejects(observeAiTask(input, () => {}, async url => {
  if (url === input.url) return Response.json({ task }, { status: 202 });
  reads++; return new Response('', { status: 401 });
 }, async () => {}), /another session/);
 assert.equal(reads, 1);
});
