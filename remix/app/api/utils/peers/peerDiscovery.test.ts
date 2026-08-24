import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
	boundedPeerLimit,
	decodePeerCursor,
	encodePeerCursor,
	normalizePeerOrigin,
	PEER_STREAM_MAX_LIMIT,
	getPeerSigningIdentity,
	signPeerPublicRequest,
	signPeerRequest,
	signedPeerStreamEvent,
	verifyPeerStreamEvent,
	verifyPeerRequest
} from './peerDiscovery';

const originalSecret = process.env.THINGTIME_PEER_DISCOVERY_SECRET;
const originalNodeEnv = process.env.NODE_ENV;
const originalSigningKey = process.env.THINGTIME_PEER_SIGNING_PRIVATE_KEY;
const originalDataEnv = process.env.THINGTIME_DATA_ENV;

test.after(() => {
	if (originalSecret === undefined) delete process.env.THINGTIME_PEER_DISCOVERY_SECRET;
	else process.env.THINGTIME_PEER_DISCOVERY_SECRET = originalSecret;
	if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = originalNodeEnv;
	if (originalSigningKey === undefined) delete process.env.THINGTIME_PEER_SIGNING_PRIVATE_KEY;
	else process.env.THINGTIME_PEER_SIGNING_PRIVATE_KEY = originalSigningKey;
	if (originalDataEnv === undefined) delete process.env.THINGTIME_DATA_ENV;
	else process.env.THINGTIME_DATA_ENV = originalDataEnv;
});

test('peer origins are canonical and only accept configured Thingtime deployment host families', () => {
	assert.equal(normalizePeerOrigin('https://pr-68.previews.dev.thingtime.com/'), 'https://pr-68.previews.dev.thingtime.com');
	assert.equal(
		normalizePeerOrigin('https://thingtime-d4ipw8o5m-lopugits-projects.vercel.app/'),
		'https://thingtime-d4ipw8o5m-lopugits-projects.vercel.app'
	);
	assert.equal(normalizePeerOrigin('https://localhost/'), null);
	assert.equal(normalizePeerOrigin('https://evil.example/'), null);
	assert.equal(normalizePeerOrigin('https://thingtime.com/path'), null);
});

test('peer request signatures bind the raw body, method and route with a bounded timestamp', () => {
	process.env.THINGTIME_PEER_DISCOVERY_SECRET = 'p'.repeat(32);
	const { privateKey } = generateKeyPairSync('ed25519');
	process.env.THINGTIME_PEER_SIGNING_PRIVATE_KEY = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
	process.env.NODE_ENV = 'test';
	process.env.THINGTIME_DATA_ENV = 'development';
	const timestamp = '2026-08-24T00:00:00.000Z';
	const body = '{"op":"announce","origin":"http://127.0.0.1:1234"}';
	const publicSignature = signPeerPublicRequest('POST', '/api/v1/peers', timestamp, body);
	const headers = {
		'x-thingtime-peer-origin': 'http://127.0.0.1:1234',
		'x-thingtime-peer-federation-id': 'development',
		'x-thingtime-peer-timestamp': timestamp,
		'x-thingtime-peer-signature': signPeerRequest(process.env.THINGTIME_PEER_DISCOVERY_SECRET, 'POST', '/api/v1/peers', timestamp, body, 'development'),
		'x-thingtime-peer-public-key': publicSignature.publicKey,
		'x-thingtime-peer-public-signature': publicSignature.signature
	};
	const request = new Request('http://127.0.0.1:1234/api/v1/peers', { method: 'POST', headers });
	const verified = verifyPeerRequest(request, body, Date.parse(timestamp));
	assert.equal(verified.ok, true);
	if (verified.ok) {
		assert.equal(verified.origin, 'http://127.0.0.1:1234');
		assert.equal(verified.publicKey, publicSignature.publicKey);
		assert.equal(verified.dataEnvironment.federationId, 'development');
	}
	assert.equal(verifyPeerRequest(request, `${body} `, Date.parse(timestamp)).ok, false);
	const paged = new Request('http://127.0.0.1:1234/api/v1/peers?limit=50', { method: 'POST', headers });
	assert.equal(verifyPeerRequest(paged, body, Date.parse(timestamp)).ok, false);
	const alteredPublicSignature = {
		...headers,
		'x-thingtime-peer-public-signature': `${publicSignature.signature.slice(0, -2)}${
			publicSignature.signature.at(-2) === 'A' ? 'B' : 'A'
		}${publicSignature.signature.at(-1)}`
	};
	assert.equal(
		verifyPeerRequest(
			new Request('http://127.0.0.1:1234/api/v1/peers', { method: 'POST', headers: alteredPublicSignature }),
			body,
			Date.parse(timestamp)
		).ok,
		false
	);
	assert.equal(verifyPeerRequest(request, body, Date.parse(timestamp) + 6 * 60_000).ok, false);
	const wrongEnvironment = new Request('http://127.0.0.1:1234/api/v1/peers', {
		method: 'POST',
		headers: { ...headers, 'x-thingtime-peer-federation-id': 'production' }
	});
	assert.equal(verifyPeerRequest(wrongEnvironment, body, Date.parse(timestamp)).ok, false);
});

test('peer cursors are opaque and limits are bounded', () => {
	const cursor = encodePeerCursor({ lastSeenAt: '2026-08-24T00:00:00.000Z', origin: 'https://thingtime.com' });
	assert.deepEqual(decodePeerCursor(cursor), { lastSeenAt: '2026-08-24T00:00:00.000Z', origin: 'https://thingtime.com' });
	assert.equal(decodePeerCursor('not-a-cursor'), null);
	assert.equal(boundedPeerLimit('10000'), PEER_STREAM_MAX_LIMIT);
	assert.equal(boundedPeerLimit('-2'), 1);
});

test('peer stream events are independently signed by the pinned deployment key', () => {
	process.env.THINGTIME_PEER_DISCOVERY_SECRET = 'p'.repeat(32);
	process.env.THINGTIME_DATA_ENV = 'development';
	const { privateKey } = generateKeyPairSync('ed25519');
	process.env.THINGTIME_PEER_SIGNING_PRIVATE_KEY = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
	const identity = getPeerSigningIdentity();
	assert.ok(identity);
	const event = signedPeerStreamEvent(identity, 'https://thingtime.com', { federationId: 'development' }, { type: 'peer', peer: { origin: 'https://thingtime.com' } });
	assert.deepEqual(verifyPeerStreamEvent(event, 'https://thingtime.com', 'development')?.event, { type: 'peer', peer: { origin: 'https://thingtime.com' } });
	assert.equal(verifyPeerStreamEvent(event, 'https://thingtime.com', 'production'), null);
	assert.equal(verifyPeerStreamEvent({ ...event, peer: { origin: 'https://evil.example' } }, 'https://thingtime.com', 'development'), null);
});
