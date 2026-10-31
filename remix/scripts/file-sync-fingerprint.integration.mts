// Opt-in real HTTP + object-storage acceptance using a disposable local account.
// Pass a mode-0600 fixture path, never credentials on the command line.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { attachmentFingerprintEntry } from '../app/fileSync/attachmentFingerprint.client';
import { sameSyncContent } from '../app/fileSync/reconcile';
const path = process.argv[2];
if (!path || ((await stat(path)).mode & 0o077)) throw Error('Pass a private mode-0600 test fixture');
const fixture = JSON.parse(await readFile(path, 'utf8'));
const base = new URL(fixture.base);
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password || base.origin !== fixture.base) throw Error('Use a canonical local test origin');
const cookies = new Map<string, string>();
async function call(route: string, body?: unknown, authenticated = true) {
	const response = await fetch(base.origin + route, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
		headers: { Accept: 'application/json', Origin: base.origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			...(authenticated ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	if (authenticated) for (const header of response.headers.getSetCookie()) { const pair = header.split(';')[0], i = pair.indexOf('='); cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
	const data = await response.json(); return { response, data };
}
async function ok(route: string, body?: unknown) {
	const result = await call(route, body);
	if (!result.response.ok || result.data.ok === false) throw Error(`${route.split('?')[0]} refused (${result.response.status}): ${String(result.data.error || 'request failed').slice(0, 240)}`);
	return result.data;
}
const bytes = Buffer.alloc(8 * 1024 * 1024 + 17, 21); bytes[bytes.length - 1] = 99;
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
let attachmentId: string | null = null;
let signedIn = false;
try {
	const manifest = await ok('/.well-known/thingtime-capabilities.json');
	assert.equal(manifest.features['api.attachment-content'].version, '1.13.0');
	await ok('/api/v1/login', { username: fixture.username, password: fixture.password }); signedIn = true;
	assert.equal((await ok('/api/v1/auth/me')).user.id, fixture.userId);
	const requestId = randomUUID();
	const input = { requestId, filename: 'sync-fingerprint-fixture.bin', contentType: 'application/octet-stream', sizeBytes: bytes.length, purpose: 'file' };
	const started = await ok('/api/v1/attachments/uploads', input); attachmentId = started.upload.id;
	const resumed = await ok('/api/v1/attachments/uploads', input); assert.equal(resumed.upload.id, attachmentId);
	assert.equal(started.upload.partCount, 2);
	const parts = Array.from({ length: started.upload.partCount }, (_, i) => {
		const data = bytes.subarray(i * started.upload.partSizeBytes, Math.min((i + 1) * started.upload.partSizeBytes, bytes.length));
		return { partNumber: i + 1, checksumSha256: createHash('sha256').update(data).digest('base64'), data };
	});
	const signed = await ok('/api/v1/attachments/uploads/parts', { uploadId: attachmentId, parts: parts.map(({ partNumber, checksumSha256 }) => ({ partNumber, checksumSha256 })) });
	for (const part of signed.parts) {
		const source = parts.find(p => p.partNumber === part.partNumber)!;
		const target = new URL(part.url, base);
		assert.ok(target.protocol === 'https:' || target.origin === base.origin);
		const uploaded = await fetch(target, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { ...part.headers, 'Content-Length': String(source.data.length) }, body: source.data });
		assert.equal(uploaded.ok, true, `Part ${part.partNumber} upload status ${uploaded.status}`);
	}
	await ok('/api/v1/attachments/uploads/complete', { uploadId: attachmentId });
	await ok('/api/v1/attachments/uploads/complete', { uploadId: attachmentId });
	const endpoint = `/api/v1/attachments/content?id=${encodeURIComponent(attachmentId!)}&fingerprint=1`;
	const remote = await call(endpoint); assert.equal(remote.response.status, 200); assert.match(remote.response.headers.get('cache-control')!, /private.*no-store/);
	const local = await fingerprintSource({ size: bytes.length, check() {}, async read(offset, length) { return new Uint8Array(bytes.subarray(offset, offset + length)); } });
	assert.deepEqual(remote.data.fingerprint, local);
	const cloudEntry = attachmentFingerprintEntry(remote.data, attachmentId!, 'fixture.bin');
	assert.equal(sameSyncContent(cloudEntry, { ...cloudEntry, id: 'local-fixture', version: 'local-version', fingerprint: local }), true);
	const downloaded = await fetch(base.origin + `/api/v1/attachments/content?id=${encodeURIComponent(attachmentId!)}&cache=bytes`, { headers: { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
	assert.equal(downloaded.status, 200); assert.equal(digest(new Uint8Array(await downloaded.arrayBuffer())), digest(bytes));
	assert.deepEqual((await ok(endpoint)), remote.data, 'Retry returns the same exact-version fingerprint');
	assert.equal((await call(endpoint, undefined, false)).response.status, 404);
	console.log('PASS: real two-part upload, stable retry identity, local/cloud fingerprints, independent download hash and anonymous denial');
} finally {
	try {
	if (attachmentId) {
		const cleanup = await ok('/api/v1/attachments/delete', { id: attachmentId });
		assert.equal((await call(`/api/v1/attachments/content?id=${encodeURIComponent(attachmentId)}&fingerprint=1`)).response.status, 404);
		console.log(cleanup.deferred ? 'Cleanup: attachment inaccessible; canonical storage cleanup deferred' : 'Cleanup: synthetic attachment deleted');
	}
	} finally {
		if (signedIn) await ok('/api/v1/auth/accounts/remove', { userId: fixture.userId });
	}
}
