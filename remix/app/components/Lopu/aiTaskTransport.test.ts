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
	for (const reason of ['error', 'max_tokens', 'tool_limit', 'hop_limit', 'time_limit', 'aborted'])
		assert.equal(canContinueLopuReply('done', reason), true);
	assert.equal(canContinueLopuReply('done', 'end_turn'), false);
});
