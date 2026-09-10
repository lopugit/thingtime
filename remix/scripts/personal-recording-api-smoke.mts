// Local-only HTTP integration: no Mongo access, production credentials or provider calls.
// Creates one synthetic account and device through the real signup/pairing APIs.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { canonicalDevicePairingClaimBytes } from '../app/api/utils/devices/deviceAuth';
import { supportsPersonalRecordingSettings } from '../app/components/Lopu/recordingsCapabilities';

const origin = process.argv[2] || 'http://127.0.0.1:18000';
const target = new URL(origin);
if (target.origin !== origin || target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname))
	throw new Error('This synthetic signup smoke is restricted to a loopback HTTP origin.');
let cookie = '';
let phase = 'manifest';
const request = async (path: string, body?: unknown, authorization?: string, expected = 200, browser = true) => {
	const response = await fetch(new URL(path, origin), {
		method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
		headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			...(browser && cookie ? { Cookie: cookie } : {}), ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	if (response.status !== expected) throw new Error(`${phase}: expected HTTP ${expected}, received ${response.status}`);
	if (browser && path === '/api/v1/auth/register') cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
	const result = await response.json();
	return result;
};
try {
	assert.equal(supportsPersonalRecordingSettings(await request('/.well-known/thingtime-capabilities.json'), origin), true);
	phase = 'anonymous recording wall';
	await request('/api/v1/lopu/recordings/personal', { op: 'claim' }, undefined, 401, false);
	phase = 'synthetic signup';
	const username = `recqa${Date.now().toString(36)}`;
	const account = await request('/api/v1/auth/register', { username, email: `${username}@example.invalid`,
		password: `${randomBytes(24).toString('base64url')}!aA1`, displayName: 'Recording API QA' });
	assert.equal(account.ok, true); assert.ok(cookie);
	phase = 'browser credential cannot act as worker';
	await request('/api/v1/lopu/recordings/personal', { op: 'claim' }, undefined, 401);
	phase = 'default provider settings';
	const initial = await request('/api/v1/lopu/recordings');
	assert.equal(initial.settings.runtimeDeviceId, null);
	assert.equal(initial.settings.enabled, false);
	phase = 'foreign device selection';
	await request('/api/v1/lopu/recordings', { op: 'settings', settings: { runtimeDeviceId: 'foreign-worker' } }, undefined, 400);
	phase = 'pairing challenge';
	const { pairing } = await request('/api/v1/devices/pairing', {});
	const keys = generateKeyPairSync('ed25519');
	const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
	const nonce = randomBytes(32).toString('base64url');
	const credential = `ttnode_${randomBytes(32).toString('base64url')}`;
	phase = 'prepare signed native claim';
	const { proof } = await request('/api/v1/devices/pairing/claim', { op: 'prepare', pairingSecret: pairing.pairingSecret, publicKey, nonce });
	const device = { name: 'Synthetic recording worker', platform: 'macos' as const };
	const capabilities = ['recordings.personal.v1'];
	const signature = sign(null, canonicalDevicePairingClaimBytes({ pairingId: proof.pairingId, pairingSecret: pairing.pairingSecret,
		credential, publicKey, nonce, serverNonce: proof.serverNonce, device, capabilities }), keys.privateKey).toString('base64url');
	phase = 'complete signed native claim';
	const paired = await request('/api/v1/devices/pairing/claim', { op: 'complete', pairingSecret: pairing.pairingSecret, credential, device,
		capabilities, proof: { pairingId: proof.pairingId, publicKey, nonce, serverNonce: proof.serverNonce, signature } });
	assert.ok(paired.device.id);
	phase = 'missing recording consent';
	await request('/api/v1/lopu/recordings/personal', { op: 'claim' }, credential, 409, false);
	phase = 'select paired personal processor';
	const selected = await request('/api/v1/lopu/recordings', { op: 'settings', settings: { enabled: true, runtimeDeviceId: paired.device.id } });
	assert.equal(selected.settings.runtimeDeviceId, paired.device.id);
	assert.equal(selected.provider.mode, 'personal'); assert.equal(selected.provider.configured, true);
	phase = 'authenticated empty queue';
	assert.deepEqual(await request('/api/v1/lopu/recordings/personal', { op: 'claim' }, credential, 200, false), { ok: true, job: null });
	phase = 'opt out';
	await request('/api/v1/lopu/recordings', { op: 'settings', settings: { enabled: false } });
	await request('/api/v1/lopu/recordings/personal', { op: 'claim' }, credential, 409, false);
	console.log(JSON.stringify({ ok: true, syntheticAccount: username, checks: 11, automationEnabled: false,
		proof: 'real HTTP signup, signed pairing, selection, queue and opt-out; no audio/provider invocation' }));
} catch {
	// Never render assertion operands, cookies, pairing material or raw responses.
	console.error(`Personal recording API smoke failed at: ${phase}. No credentials were printed.`);
	process.exitCode = 1;
}
