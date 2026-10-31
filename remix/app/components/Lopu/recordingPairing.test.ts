import assert from 'node:assert/strict';
import test from 'node:test';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';
import { createApiCapabilitiesManifest } from '~/docs/apiDocs';
import { parseRecordingPairingChallenge, requestRecordingPairing, supportsRecordingPairing } from './recordingPairing';

const origin = 'https://recording-setup.example.invalid';
const ownerId = 'test-owner';
const response = () => ({ ok: true, ownerId, pairing: { pairingSecret: `ttpair_${'a'.repeat(43)}`, expiresAt: new Date(Date.now() + 600_000).toISOString() } });

test('setup requires the exact origin, owner-binding revision and active pairing route', () => {
	const manifest = thingtimeCapabilityManifest(origin);
	assert.equal(supportsRecordingPairing(manifest, origin), true);
	assert.equal(manifest.features['api.devices-pairing'].version, '1.1.0');
	assert.equal(createApiCapabilitiesManifest().features['api.devices-pairing'], '1.1.0');
	for (const invalid of [
		{ ...manifest, origin: 'https://other.invalid' }, { ...manifest, schemaVersion: 2 }, { ...manifest, operations: [] },
		{ ...manifest, features: { ...manifest.features, 'api.devices-pairing': { version: '1.0.0' } } },
		{ ...manifest, features: { ...manifest.features, 'api.devices-pairing': { version: '2.0.0' } } },
		{ ...manifest, features: { ...manifest.features, 'api.devices-pairing-claim': null } }
	]) assert.equal(Boolean(supportsRecordingPairing(invalid, origin)), false);
});

test('challenge projection rejects account switches, expired/long-lived responses and malformed secrets', () => {
	const value = response();
	assert.deepEqual(Object.keys(parseRecordingPairingChallenge(value, ownerId)), ['secret', 'expiresAt']);
	for (const invalid of [
		{ ...value, ownerId: 'new-account' }, { ...value, ok: false },
		{ ...value, pairing: { ...value.pairing, expiresAt: new Date(Date.now() - 1).toISOString() } },
		{ ...value, pairing: { ...value.pairing, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() } },
		{ ...value, pairing: { ...value.pairing, pairingSecret: 'not-a-pairing-secret' } }
	]) assert.throws(() => parseRecordingPairingChallenge(invalid, ownerId));
});

test('setup creates no challenge until current-origin capability negotiation succeeds', async () => {
	const calls: string[] = [];
	const signal = new AbortController().signal;
	const fetcher: typeof fetch = async (url, init) => {
		assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.signal, signal);
		const path = new URL(String(url)).pathname; calls.push(path);
		assert.equal(new URL(String(url)).origin, origin);
		return Response.json(path.startsWith('/.well-known/') ? thingtimeCapabilityManifest(origin) : response());
	};
	const result = await requestRecordingPairing({ origin, ownerId, signal, fetcher });
	assert.equal(result.secret, response().pairing.pairingSecret);
	assert.deepEqual(calls, ['/.well-known/thingtime-capabilities.json', '/api/v1/devices/pairing']);
	let count = 0;
	await assert.rejects(requestRecordingPairing({ origin, ownerId, signal, fetcher: async () => { count++; return Response.json({}); } }));
	assert.equal(count, 1);
});

test('an account change during creation discards the returned credential', async () => {
	await assert.rejects(requestRecordingPairing({ origin, ownerId, signal: new AbortController().signal,
		fetcher: async (url) => Response.json(String(url).includes('/.well-known/') ? thingtimeCapabilityManifest(origin) : { ...response(), ownerId: 'new-account' }) }), /different account/);
});

test('abort after negotiation prevents minting a challenge', async () => {
	const controller = new AbortController(); let calls = 0;
	await assert.rejects(requestRecordingPairing({ origin, ownerId, signal: controller.signal, fetcher: async () => {
		calls++; controller.abort(); return Response.json(thingtimeCapabilityManifest(origin));
	} }));
	assert.equal(calls, 1);
});
