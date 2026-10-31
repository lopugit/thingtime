import assert from 'node:assert/strict';
import test from 'node:test';

import { NETWORK_PROBE_PACKET_BYTES, NETWORK_PROBE_UPLOAD_BYTES, NETWORK_PROBE_UPLOAD_REQUESTS, networkProbeDownloadResponse, parseNetworkProbePacketBytes, parseNetworkProbeUploadBytes, readExactNetworkProbeUpload } from './networkProbe';
import { RATE_LIMIT_DEFAULTS } from './rateLimit/config';

test('network probe accepts only the fixed bounded packet ladder', () => {
	assert.equal(parseNetworkProbePacketBytes(String(56 * 1024)), 56 * 1024);
	assert.equal(parseNetworkProbePacketBytes(10 * 1024 * 1024), 10 * 1024 * 1024);
	assert.equal(parseNetworkProbePacketBytes('1048577'), undefined);
	assert.equal(parseNetworkProbePacketBytes('0'), undefined);
	assert.deepEqual(NETWORK_PROBE_PACKET_BYTES, [56 * 1024, 500 * 1024, 2 * 1024 * 1024, 5 * 1024 * 1024, 10 * 1024 * 1024]);
});

test('network probe responses are fixed-size and never cacheable', async () => {
	const response = networkProbeDownloadResponse(56 * 1024);
	assert.equal(response.headers.get('content-length'), String(56 * 1024));
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal((await response.arrayBuffer()).byteLength, 56 * 1024);
});

test('network probe upload requires the declared and actual body to match exactly', async () => {
	await readExactNetworkProbeUpload(
		new Request('https://thingtime.test', {
			method: 'POST',
			headers: { 'content-length': String(56 * 1024) },
			body: new Uint8Array(56 * 1024)
		}),
		56 * 1024
	);
	await assert.rejects(
		() => readExactNetworkProbeUpload(new Request('https://thingtime.test', { method: 'POST', body: new Uint8Array(1) }), 56 * 1024),
		(value) => value instanceof Response && value.status === 400
	);
});

test('upload v2 admits proxy streams without Content-Length and counts every byte', async () => {
	for (const bytes of NETWORK_PROBE_UPLOAD_BYTES) {
		const request = new Request('https://thingtime.test', { method: 'POST', body: new Uint8Array(bytes) });
		assert.equal(request.headers.get('content-length'), null);
		await readExactNetworkProbeUpload(request, bytes);
	}
	for (const [actual, status] of [[57343, 400], [57345, 413]] as const) {
		await assert.rejects(() => readExactNetworkProbeUpload(new Request('https://thingtime.test', { method: 'POST', body: new Uint8Array(actual) }), 57344),
			(error) => error instanceof Response && error.status === status);
	}
});

test('upload still rejects incorrect declarations and cancels oversized streams immediately', async () => {
	for (const declared of ['0', '57343', 'nonsense']) {
		await assert.rejects(() => readExactNetworkProbeUpload(new Request('https://thingtime.test', {
			method: 'POST', headers: { 'content-length': declared }, body: new Uint8Array(57344)
		}), 57344), (error) => error instanceof Response && error.status === 400);
	}
	let cancelled = false;
	const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(57345)); }, cancel() { cancelled = true; } });
	const request = new Request('https://thingtime.test', { method: 'POST', body, duplex: 'half' } as RequestInit);
	await assert.rejects(() => readExactNetworkProbeUpload(request, 57344), (error) => error instanceof Response && error.status === 413);
	assert.equal(cancelled, true);
});

test('upload v2 sizes and quota fit the entire chunked test without increasing the old bandwidth ceiling', () => {
	for (const bytes of NETWORK_PROBE_UPLOAD_BYTES) assert.equal(parseNetworkProbeUploadBytes(String(bytes)), bytes);
	for (const bytes of [0, 1, 3 * 1024 * 1024, 5 * 1024 * 1024, 10 * 1024 * 1024, NaN, Infinity]) {
		assert.equal(parseNetworkProbeUploadBytes(bytes), undefined);
	}
	const chunks = NETWORK_PROBE_PACKET_BYTES.flatMap((bytes) => {
		const result: number[] = [];
		for (let remaining = bytes; remaining > 0; remaining -= 2 * 1024 * 1024) result.push(Math.min(remaining, 2 * 1024 * 1024));
		return result;
	});
	assert.equal(chunks.length, NETWORK_PROBE_UPLOAD_REQUESTS);
	assert.ok(chunks.every((bytes) => parseNetworkProbeUploadBytes(bytes) !== undefined));
	assert.equal(chunks.reduce((a, b) => a + b, 0), NETWORK_PROBE_PACKET_BYTES.reduce((a, b) => a + b, 0));
	assert.equal(RATE_LIMIT_DEFAULTS['networkProbe.upload.v2'].limit, chunks.length);
	assert.ok(chunks.length * Math.max(...NETWORK_PROBE_UPLOAD_BYTES) < 5 * 10 * 1024 * 1024);
});
