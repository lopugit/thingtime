import assert from 'node:assert/strict';
import test from 'node:test';

import { NETWORK_PROBE_PACKET_BYTES, networkProbeDownloadResponse, parseNetworkProbePacketBytes, readExactNetworkProbeUpload } from './networkProbe';

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
