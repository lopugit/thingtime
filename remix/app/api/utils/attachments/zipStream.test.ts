import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';

import { createZipStream, ZipStreamError } from './zipStream';

const bytesOf = (text: string) => new TextEncoder().encode(text);

const chunked = (bytes: Uint8Array, chunk: number) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (let offset = 0; offset < bytes.byteLength; offset += chunk) controller.enqueue(bytes.subarray(offset, offset + chunk));
			controller.close();
		}
	});

const collect = async (stream: ReadableStream<Uint8Array>) => {
	const reader = stream.getReader();
	const parts: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
	}
	const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		joined.set(part, offset);
		offset += part.byteLength;
	}
	return joined;
};

test('streams stored members plus text extras into a ZIP ordinary tools can read', async () => {
	const big = new Uint8Array(300_000);
	for (let index = 0; index < big.length; index += 1) big[index] = (index * 31) & 0xff;
	const archive = await collect(
		createZipStream(
			[
				{ path: 'Dinner/photo.jpg', size: 5, open: async () => chunked(bytesOf('hello'), 2) },
				{ path: 'big.bin', size: big.byteLength, open: async () => chunked(big, 65_536) },
				{ path: 'empty.txt', size: 0, open: async () => chunked(new Uint8Array(0), 1) }
			],
			[{ path: 'links.txt', bytes: bytesOf('a\thttps://example.test/a\n') }],
			{ highWaterMarkBytes: 16 * 1024 }
		)
	);
	const entries = unzipSync(archive);
	assert.deepEqual(Object.keys(entries).sort(), ['Dinner/photo.jpg', 'big.bin', 'empty.txt', 'links.txt']);
	assert.equal(new TextDecoder().decode(entries['Dinner/photo.jpg']), 'hello');
	assert.deepEqual(entries['big.bin'], big);
	assert.equal(entries['empty.txt'].byteLength, 0);
	assert.equal(new TextDecoder().decode(entries['links.txt']), 'a\thttps://example.test/a\n');
});

test('a member whose upstream size disagrees with its declaration fails the stream instead of truncating silently', async () => {
	for (const [declared, actual] of [
		[5, 'hell'],
		[3, 'hello']
	] as const) {
		const stream = createZipStream([{ path: 'x.txt', size: declared, open: async () => chunked(bytesOf(actual), 2) }]);
		await assert.rejects(collect(stream), (error: unknown) => error instanceof ZipStreamError && /size/.test(error.message));
	}
});

test('an upstream open failure propagates and aborts the pump', async () => {
	let aborted = false;
	const stream = createZipStream([
		{
			path: 'first.txt',
			size: 5,
			open: async (signal) => {
				signal.addEventListener('abort', () => {
					aborted = true;
				});
				return chunked(bytesOf('hello'), 5);
			}
		},
		{ path: 'second.txt', size: 1, open: async () => { throw new Error('storage unavailable'); } }
	]);
	await assert.rejects(collect(stream), /storage unavailable/);
	assert.equal(aborted, true);
});

test('the deadline stops a slow archive', async () => {
	let clock = 0;
	const stream = createZipStream(
		[
			{ path: 'a.txt', size: 1, open: async () => chunked(bytesOf('a'), 1) },
			{ path: 'b.txt', size: 1, open: async () => { clock = 10_000; return chunked(bytesOf('b'), 1); } }
		],
		[],
		{ deadlineAt: 5_000, now: () => clock }
	);
	await assert.rejects(collect(stream), (error: unknown) => error instanceof ZipStreamError && /timed out/.test(error.message));
});

test('cancelling the consumer releases the upstream reader', async () => {
	let cancelled = false;
	const endless = new ReadableStream<Uint8Array>({
		pull(controller) {
			controller.enqueue(new Uint8Array(1024));
		},
		cancel() {
			cancelled = true;
		}
	});
	const stream = createZipStream([{ path: 'endless.bin', size: Number.MAX_SAFE_INTEGER, open: async () => endless }], [], { highWaterMarkBytes: 2048 });
	const reader = stream.getReader();
	await reader.read();
	await reader.cancel();
	// the pump observes the abort on its next drain/read turn
	for (let attempt = 0; attempt < 50 && !cancelled; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(cancelled, true);
});
