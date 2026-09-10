// Local-only HTTP integration: no Mongo access, production credentials or provider calls.
// Creates one synthetic account and device through the real signup/pairing APIs.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pairPersonalRecordingDevice, type PersonalPairingState } from './personal-recording-pair';
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
	phase = 'launcher signed claim and lost receipt recovery';
	let saved: PersonalPairingState | null = null;
	const store = { read: async () => structuredClone(saved), write: async (state: PersonalPairingState) => { saved = structuredClone(state); } };
	let dropped = false;
	const lossyFetch: typeof fetch = async (url, init) => {
		const response = await fetch(url, init);
		if (!dropped && init?.body && JSON.parse(String(init.body)).op === 'complete' && response.ok) {
			dropped = true; await response.body?.cancel(); throw new Error('Synthetic lost completion receipt');
		}
		return response;
	};
	await assert.rejects(pairPersonalRecordingDevice({ origin, pairingSecret: pairing.pairingSecret, store, fetch: lossyFetch }));
	assert.equal(dropped, true);
	const paired = await pairPersonalRecordingDevice({ origin, store });
	const credential = (await store.read())!.credential;
	assert.ok(paired.deviceId);
	phase = 'missing recording consent';
	await request('/api/v1/lopu/recordings/personal', { op: 'claim' }, credential, 409, false);
	phase = 'select paired personal processor';
	const selected = await request('/api/v1/lopu/recordings', { op: 'settings', settings: { enabled: true, runtimeDeviceId: paired.deviceId } });
	assert.equal(selected.settings.runtimeDeviceId, paired.deviceId);
	assert.equal(selected.provider.mode, 'personal'); assert.equal(selected.provider.configured, true);
	phase = 'authenticated empty queue';
	assert.deepEqual(await request('/api/v1/lopu/recordings/personal', { op: 'claim' }, credential, 200, false), { ok: true, job: null });
	phase = 'opt out';
	await request('/api/v1/lopu/recordings', { op: 'settings', settings: { enabled: false } });
	await request('/api/v1/lopu/recordings/personal', { op: 'claim' }, credential, 409, false);
	console.log(JSON.stringify({ ok: true, syntheticAccount: username, checks: 11, automationEnabled: false,
		proof: 'real HTTP signup, launcher pairing with lost receipt recovery, selection, queue and opt-out; no audio/provider invocation' }));
} catch {
	// Never render assertion operands, cookies, pairing material or raw responses.
	console.error(`Personal recording API smoke failed at: ${phase}. No credentials were printed.`);
	process.exitCode = 1;
}
