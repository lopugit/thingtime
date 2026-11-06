// Opt-in loopback acceptance. The mode-0600 fixture supplies an existing disposable
// test account; all pairing, access checks and cleanup go through canonical APIs.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
const [fixturePath] = process.argv.slice(2);
assert.ok(fixturePath);
assert.equal((await stat(fixturePath)).mode & 0o077, 0);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')),
	base = new URL(fixture.base);
assert.equal(base.protocol, 'http:');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
assert.equal(base.origin, fixture.base);
const cookies = new Map<string, string>();
async function request(path: string, body?: unknown, token?: string, browser = false, method = body === undefined ? 'GET' : 'POST') {
	const headers = new Headers({ 'Content-Type': 'application/json' });
	if (browser) {
		headers.set('Origin', base.origin);
		headers.set('Cookie', [...cookies].map(([k, v]) => k + '=' + v).join('; '));
	}
	if (token) headers.set('Authorization', 'Bearer ' + token);
	const response = await fetch(new URL(path, base), {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
		redirect: 'error',
		signal: AbortSignal.timeout(30_000)
	});
	if (browser)
		for (const value of response.headers.getSetCookie()) {
			const pair = value.split(';')[0],
				at = pair.indexOf('=');
			cookies.set(pair.slice(0, at), pair.slice(at + 1));
		}
	return response;
}
async function api(path: string, body?: unknown, browser = false, method?: string) {
	const response = await request(path, body, undefined, browser, method);
	assert.equal(response.status, 200, path + ' status');
	return response.json();
}
const privateHeaders = (r: Response) => {
	assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(r.headers.get('Pragma'), 'no-cache');
	assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
};
const identityPath = '/api/v1/devices/node/identity';
let deviceId: string | undefined;
const deviceName = 'Identity acceptance ' + randomUUID();
try {
	await api('/api/v1/login', { username: fixture.username, password: fixture.password }, true);
	assert.equal((await api('/api/v1/auth/me', undefined, true)).user.id, fixture.userId);
	const manifest = await api('/.well-known/thingtime-capabilities.json');
	assert.equal(manifest.features['api.devices-node-identity'].version, '1.0.0');
	for (const browser of [false, true]) {
		const response = await request(identityPath, undefined, undefined, browser);
		assert.equal(response.status, 401);
		privateHeaders(response);
		assert.equal((await response.json()).ok, false);
	}
	const invalid = await request(identityPath, undefined, 'ttnode_' + randomBytes(32).toString('base64url'));
	assert.equal(invalid.status, 401);
	privateHeaders(invalid);
	const { pairing } = await api('/api/v1/devices/pairing', {}, true);
	const { privateKey, publicKey: key } = generateKeyPairSync('ed25519');
	const publicKey = key.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
	const nonce = randomBytes(32).toString('base64url'),
		credential = 'ttnode_' + randomBytes(32).toString('base64url');
	const prepared = await api('/api/v1/devices/pairing/claim', { op: 'prepare', pairingSecret: pairing.pairingSecret, publicKey, nonce });
	const { pairingId, serverNonce } = prepared.proof;
	const device = { name: deviceName, platform: 'macos', model: 'Acceptance', osVersion: 'test', appVersion: '1.0.0' },
		capabilities: string[] = [];
	const fields = [
		'thingtime-device-pairing-claim-v1',
		pairingId,
		pairing.pairingSecret,
		credential,
		publicKey,
		nonce,
		serverNonce,
		device.name,
		device.platform,
		device.model,
		device.osVersion,
		device.appVersion,
		String(capabilities.length),
		...capabilities
	];
	const bytes = Buffer.concat(
		fields.map((value) => {
			const data = Buffer.from(value, 'utf8');
			return Buffer.concat([Buffer.from(data.length + ':'), data]);
		})
	);
	const signature = sign(null, bytes, privateKey).toString('base64url');
	const claim = {
		op: 'complete',
		pairingSecret: pairing.pairingSecret,
		credential,
		device,
		capabilities,
		proof: { pairingId, publicKey, nonce, serverNonce, signature }
	};
	const claimed = await api('/api/v1/devices/pairing/claim', claim);
	deviceId = claimed.device.id;
	for (const path of [identityPath, identityPath + '?ownerId=foreign&deviceId=other']) {
		const response = await request(path, undefined, credential);
		assert.equal(response.status, 200);
		privateHeaders(response);
		assert.deepEqual(await response.json(), { ok: true, ownerId: fixture.userId, deviceId });
	}
	for (const [body, token, browser, status] of [
		[{ deviceId }, undefined, false, 401],
		[{ deviceId }, credential, false, 401],
		[{ deviceId: randomUUID() }, undefined, true, 404],
		[{ deviceId, ownerId: 'other' }, undefined, true, 400]
	] as const) {
		const response = await request('/api/v1/devices/disconnect', body, token, browser);
		assert.equal(response.status, status);
		privateHeaders(response);
	}
	const disconnect = await request('/api/v1/devices/disconnect', { deviceId }, undefined, true);
	assert.equal(disconnect.status, 200);
	privateHeaders(disconnect);
	assert.deepEqual(await disconnect.json(), { ok: true, deviceId, disconnected: true });
	await api('/api/v1/devices/disconnect', { deviceId }, true);
	const removed = await request(identityPath, undefined, credential);
	assert.equal(removed.status, 401);
	privateHeaders(removed);
	assert.equal((await removed.json()).ok, false);
	const replay = await request('/api/v1/devices/pairing/claim', claim);
	assert.equal(replay.status, 409);
	assert.equal((await api('/api/v1/auth/me', undefined, true)).user.id, fixture.userId);
	assert.equal((await api('/api/v1/devices?id=' + deviceId, undefined, true)).device.id, deviceId);
	console.log(
		'PASS live route/capability, anonymous and browser-cookie refusal, invalid token, signed pairing, exact identity/projection, caller-ID refusal, owner-only disconnect, revocation, repeated disconnect, no claim resurrection, retained device history/browser session, private headers.'
	);
} catch (error) {
	console.error('Acceptance failure:', error);
	throw error;
} finally {
	// Revoke our fixture credential even if a claim response was interrupted.
	// Protected device history remains intentionally retained by the product.
	const devices = deviceId ? [{ id: deviceId, name: deviceName }] : (await api('/api/v1/devices', undefined, true)).devices;
	for (const device of devices)
		if (device.id === deviceId || device.name === deviceName) await api('/api/v1/devices/disconnect', { deviceId: device.id }, true);
	await api('/api/v1/auth/accounts/remove', { userId: fixture.userId }, true);
}
