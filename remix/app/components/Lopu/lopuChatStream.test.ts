import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import { isAbortError, LopuStreamError, readNdjson } from './lopuChatStream.ts';
// @ts-ignore same
import type { LopuChatEvent } from './lopuTurnCore.ts';

const encoder = new TextEncoder();

// a Response whose body arrives in the given chunks (bytes split mid-line on purpose)
const chunkedResponse = (chunks: string[], init?: ResponseInit): Response => {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		}
	});
	return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' }, ...init });
};

test('readNdjson parses events across chunk boundaries, skips noise and flushes the last unterminated line', async () => {
	const response = chunkedResponse([
		'{"type":"meta","chatId":"c1","userMessageId":"u1","requestId":"r1","model":"m","effort":"high","speed":"normal","provider":"test","label":"Test"}\n{"type":"del',
		'ta","text":"Hel"}\n\n   \n{"type":"delta","text":"lo"}\nnot json at all\n',
		'{"type":"tool_use_start","id":"t1","name":"create_page"}\n{"type":"done","assistantMessageId":"a1","messages":[],"stopReason":"end_turn"}'
	]);
	const events: LopuChatEvent[] = [];
	const result = await readNdjson(response, (event) => events.push(event));
	assert.equal(result.events, 5);
	assert.deepEqual(
		events.map((event) => event.type),
		['meta', 'delta', 'delta', 'tool_use_start', 'done']
	);
	assert.equal((events[1] as { text: string }).text + (events[2] as { text: string }).text, 'Hello');
});

test('readNdjson rejects a non-OK response with the API error payload', async () => {
	const response = new Response(JSON.stringify({ ok: false, error: 'Easy there, speed-typer 🌸' }), {
		status: 429,
		headers: { 'Content-Type': 'application/json', 'Retry-After': '30' }
	});
	await assert.rejects(
		readNdjson(response, () => {}),
		(error: unknown) => {
			assert.ok(error instanceof LopuStreamError);
			assert.equal(error.status, 429);
			assert.equal(error.error, 'Easy there, speed-typer 🌸');
			assert.equal(error.retryAfter, '30');
			return true;
		}
	);
	const plain = new Response('nope', { status: 500 });
	await assert.rejects(readNdjson(plain, () => {}), (error: unknown) => error instanceof LopuStreamError && /HTTP 500/.test(error.error));
});

test('readNdjson stops on an aborted signal and reports an AbortError', async () => {
	const controller = new AbortController();
	let pulls = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(streamController) {
			pulls += 1;
			streamController.enqueue(encoder.encode(`{"type":"delta","text":"${pulls}"}\n`));
			if (pulls === 2) controller.abort();
		}
	});
	const response = new Response(stream, { status: 200 });
	const seen: string[] = [];
	await assert.rejects(
		readNdjson(response, (event) => seen.push(event.type), controller.signal),
		(error: unknown) => isAbortError(error)
	);
	assert.ok(seen.length >= 1 && seen.length <= 3, `expected a bounded number of events before the abort, saw ${seen.length}`);

	const already = new AbortController();
	already.abort();
	await assert.rejects(readNdjson(chunkedResponse(['{"type":"delta","text":"x"}\n']), () => {}, already.signal), (error: unknown) => isAbortError(error));
});
