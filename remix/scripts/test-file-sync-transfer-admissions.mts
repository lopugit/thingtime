/** Built Nitro and a private disposable Mongo replica. All product state is
 * created through HTTP APIs; no personal credentials or database are used. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { access, chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeJwt, SignJWT } from 'jose';
import { authCookie } from '../app/api/utils/auth/authCookie';
import { canonicalDevicePairingClaimBytes } from '../app/api/utils/devices/deviceAuth';
import { contentPartPlan } from '../app/fileSync/contentFingerprint';

assert.equal(process.argv.length, 2, 'Run this fixture without arguments');
await access('.output/server/index.mjs');
const directory = await mkdtemp(join(tmpdir(), 'thingtime-transfer-admissions-'));
await chmod(directory, 0o700);
await mkdir(join(directory, 'db'));
const socket = async () => {
	const listener = createServer().listen(0, '127.0.0.1');
	await once(listener, 'listening');
	const address = listener.address();
	assert.ok(address && typeof address !== 'string');
	return { listener, port: address.port };
};
const [db, http] = await Promise.all([socket(), socket()]);
await Promise.all([db, http].map(({ listener }) => new Promise<void>((resolve) => listener.close(() => resolve()))));
const base = `http://127.0.0.1:${http.port}`,
	alternateOrigin = `http://localhost:${http.port}`;
const secret = randomBytes(48).toString('hex');
const ownerName = 'admit-' + randomUUID().slice(0, 8),
	password = randomUUID() + '-Fixture!';
const dbBase = `mongodb://127.0.0.1:${db.port}`;
const clean = { PATH: process.env.PATH, TMPDIR: tmpdir(), NODE_ENV: 'test' };
const serverEnv = {
	...clean,
	NITRO_HOST: '127.0.0.1',
	NITRO_PORT: String(http.port),
	APP_URL: base,
	JWT_SECRET: secret,
	MONGODB_CONNECTION_STRING: dbBase + '/thingtime?replicaSet=sync-transfer-admissions',
	THINGTIME_EMAIL_PROVIDER: 'console',
	THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(directory, 'objects'),
	THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN: base
};
const children = new Set<ChildProcess>();
const start = (command: string, args: string[], env: NodeJS.ProcessEnv = clean) => {
	const child = spawn(command, args, { env, stdio: 'ignore' });
	children.add(child);
	child.once('close', () => children.delete(child));
	return child;
};
const stop = async (child: ChildProcess) => {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'close');
	child.kill('SIGTERM');
	const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
	try {
		await exited;
	} finally {
		clearTimeout(timer);
	}
};
const cleanup = () => Promise.all([...children].reverse().map(stop));
const abort = () => {
	void cleanup()
		.then(() => rm(directory, { recursive: true, force: true }))
		.finally(() => process.exit(1));
};
process.once('SIGTERM', abort);
process.once('SIGINT', abort);
async function until(check: () => Promise<boolean>, label: string) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await delay(100);
	}
	assert.fail(label + ' did not become ready');
}
async function startApi(admin = false) {
	const child = start(process.execPath, ['.output/server/index.mjs'], { ...serverEnv, ...(admin ? { ADMIN_USERNAMES: ownerName } : {}) });
	await until(async () => {
		assert.equal(child.exitCode, null, 'Built API exited');
		try {
			return (await fetch(base + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(1500) })).ok;
		} catch {
			return false;
		}
	}, 'Built API');
	return child;
}

type Options = { cookie?: string; bearer?: string; method?: string; origin?: string; headers?: Record<string, string> };
async function call(path: string, body?: unknown, options: Options = {}) {
	const origin = options.origin ?? base;
	const response = await fetch(origin + path, {
		method: options.method ?? (body === undefined ? 'GET' : 'POST'),
		redirect: 'error',
		signal: AbortSignal.timeout(30_000),
		headers: {
			...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			...(options.cookie ? { Cookie: options.cookie, Origin: origin } : {}),
			...(options.bearer ? { Authorization: 'Bearer ' + options.bearer } : {}),
			...options.headers
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const cookie = response.headers
		.getSetCookie()
		.find((value) => value.startsWith('tt_auth='))
		?.split(';')[0];
	return { response, data: await response.json(), cookie };
}
async function expect(path: string, body?: unknown, options?: Options, status = 200) {
	const result = await call(path, body, options);
	assert.equal(
		result.response.status,
		status,
		`${options?.method ?? (body ? 'POST' : 'GET')} ${path.split('?')[0]} ${String((body as any)?.action ?? '')}: ${result.data?.error ?? ''}`
	);
	if (path === admissions) {
		assert.match(result.response.headers.get('Cache-Control') ?? '', /private.*no-store/);
		assert.equal(result.response.headers.get('Referrer-Policy'), 'no-referrer');
	}
	return result;
}
async function register(username: string) {
	const result = await expect('/api/v1/auth/register', { username, email: username + '@example.invalid', password });
	assert.ok(result.cookie);
	return { cookie: result.cookie, userId: result.data.user.id };
}
async function pair(cookie: string) {
	const { pairing } = (await expect('/api/v1/devices/pairing', {}, { cookie })).data;
	const { privateKey, publicKey: key } = generateKeyPairSync('ed25519');
	const publicKey = key.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
	const nonce = randomBytes(32).toString('base64url'),
		bearer = 'ttnode_' + randomBytes(32).toString('base64url');
	const { proof } = (await expect('/api/v1/devices/pairing/claim', { op: 'prepare', pairingSecret: pairing.pairingSecret, publicKey, nonce })).data;
	const device = { name: 'Disposable iPhone', platform: 'ios' as const, model: 'Fixture', osVersion: 'test', appVersion: '1.0.0' },
		capabilities: string[] = [];
	const signature = sign(
		null,
		canonicalDevicePairingClaimBytes({ ...proof, pairingSecret: pairing.pairingSecret, credential: bearer, publicKey, nonce, device, capabilities }),
		privateKey
	).toString('base64url');
	const claimed = (
		await expect('/api/v1/devices/pairing/claim', {
			op: 'complete',
			pairingSecret: pairing.pairingSecret,
			credential: bearer,
			device,
			capabilities,
			proof: { pairingId: proof.pairingId, serverNonce: proof.serverNonce, publicKey, nonce, signature }
		})
	).data;
	return { bearer, deviceId: claimed.device.id };
}

const admissions = '/api/v1/files/sync-transfer-admissions';
const uploads = '/api/v1/attachments/uploads';
const things = '/api/v1/things';
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest();

try {
	const mongo = start(process.env.THINGTIME_TEST_MONGOD || 'mongod', [
		'--bind_ip',
		'127.0.0.1',
		'--port',
		String(db.port),
		'--nounixsocket',
		'--dbpath',
		join(directory, 'db'),
		'--replSet',
		'sync-transfer-admissions',
		'--wiredTigerCacheSizeGB',
		'0.25',
		'--logpath',
		join(directory, 'db.log')
	]);
	await until(
		async () => mongo.exitCode === null && (await readFile(join(directory, 'db.log'), 'utf8').catch(() => '')).includes('Waiting for connections'),
		'Mongo'
	);
	const shell = start('mongosh', [
		'--quiet',
		dbBase + '/?directConnection=true',
		'--eval',
		`rs.initiate({_id:'sync-transfer-admissions',members:[{_id:0,host:'127.0.0.1:${db.port}'}]});while(!db.hello().isWritablePrimary){sleep(100)}`
	]);
	const bootstrapTimer = setTimeout(() => shell.kill('SIGTERM'), 30_000);
	try {
		assert.equal((await once(shell, 'close'))[0], 0, 'Replica bootstrap');
	} finally {
		clearTimeout(bootstrapTimer);
	}
	const firstServer = await startApi();
	const owner = await register(ownerName),
		outsider = await register('other-' + randomUUID().slice(0, 8));
	await stop(firstServer);
	await startApi(true);
	const manifest = (await expect('/.well-known/thingtime-capabilities.json')).data;
	assert.equal(manifest.origin, base);
	assert.equal(manifest.features['api.file-sync-transfer-admissions'].version, '1.0.0');
	assert.deepEqual(manifest.operations.find((operation: any) => operation.path === admissions).methods, ['POST']);
	await expect(admissions + '-docs');
	const node = await pair(owner.cookie),
		another = await pair(owner.cookie),
		foreign = await pair(outsider.cookie);
	const root = (await expect(things, { thingtime: ['folder'], acl: ['tt:user'], crystal: { name: 'Private' } }, owner)).data.thing;
	const child = (await expect(things, { thingtime: ['folder'], folderId: root.id, acl: ['tt:user'], crystal: { name: 'Child' } }, owner)).data.thing;
	const localRootId = randomUUID();
	const configuration = {
		name: 'Admitted source',
		deviceId: node.deviceId,
		localRootId,
		remoteFolderId: root.id,
		configurationVersion: 1,
		sourceKind: 'photos',
		paused: false,
		mode: 'backup',
		propagateDeletes: false,
		network: 'any',
		chargingOnly: false,
		excludedPaths: []
	};
	let saved = (await expect(things, { thingtime: ['file-sync'], acl: ['tt:user'], crystal: configuration }, owner)).data.thing;
	async function reserve(parts: Buffer[], label: string, nested = false) {
		const sizeBytes = parts.reduce((sum, part) => sum + part.length, 0),
			requestId = randomUUID(),
			filename = label + '.bin';
		const { upload } = (
			await expect(
				uploads,
				{
					filename,
					contentType: 'application/octet-stream',
					purpose: 'file',
					sizeBytes,
					requestId,
					fileSyncOrigin: {
						version: 1,
						deviceId: node.deviceId,
						localRootId: saved.id,
						cloudRootId: root.id,
						fileId: requestId,
						folderId: nested ? child.id : root.id,
						path: nested ? 'Child/' + filename : filename
					}
				},
				owner
			)
		).data;
		return {
			action: 'admit',
			uploadId: upload.id,
			requestId,
			configurationId: saved.id,
			configurationRevision: saved.updatedAt,
			deviceId: node.deviceId,
			localRootId,
			grantRevision: sha(Buffer.from('selected library grant')).toString('hex'),
			sourceVersion: 'revision-' + label,
			sizeBytes,
			fingerprint: { ...contentPartPlan(sizeBytes), sha256: sha(Buffer.concat(parts.map(sha))).toString('hex') }
		};
	}
	const signParts = (admissionId: string, parts: Buffer[]) => ({
		action: 'parts',
		admissionId,
		parts: parts.map((part, i) => ({ partNumber: i + 1, checksumSha256: sha(part).toString('base64') }))
	});
	const complete = (admissionId: string) => ({ action: 'complete', admissionId });
	const revoke = (admissionId: string) => ({ action: 'revoke', admissionId });
	async function put(part: { url: string; expiresAt: string; headers: Record<string, string> }, bytes: Buffer) {
		const target = new URL(part.url, base);
		assert.equal(target.origin, base);
		assert.ok(Date.parse(part.expiresAt) - Date.now() <= 121_000);
		const response = await fetch(target, {
			method: 'PUT',
			headers: part.headers,
			body: bytes,
			redirect: 'error',
			signal: AbortSignal.timeout(30_000)
		});
		assert.ok(response.ok, 'Canonical signed storage PUT ' + response.status);
	}
	const single = [Buffer.from('first saved native resource')],
		multi = [Buffer.alloc(8 * 1024 * 1024, 12), Buffer.from('second saved native resource')];
	const [first, second] = await Promise.all([reserve(single, 'first'), reserve(multi, 'second', true)]);
	const [a, b] = await Promise.all([expect(admissions, first, owner), expect(admissions, second, owner)]).then((rows) => rows.map((row) => row.data));
	assert.notEqual(a.admissionId, b.admissionId);
	assert.deepEqual((await expect(admissions, first, owner)).data, a);
	await expect(admissions, { ...first, sourceVersion: 'different' }, owner, 409);
	await expect(admissions, { ...first, uploadId: second.uploadId }, owner, 400);
	await expect(admissions, first, node, 401);
	await expect(admissions, first, outsider, 403);
	await expect('/api/v1/admin/users/public-uploads', { userId: outsider.userId, enabled: true, scope: 'private' }, owner);
	await expect(admissions, first, outsider, 400);
	await expect(admissions, complete(a.admissionId), another, 404);
	await expect(admissions, complete(a.admissionId), foreign, 404);
	await expect(admissions, complete(a.admissionId), owner, 401);
	await expect(admissions, { ...complete(a.admissionId), uploadId: second.uploadId }, node, 400);
	await expect(
		admissions,
		complete(a.admissionId),
		{ ...node, origin: alternateOrigin, headers: { 'X-Forwarded-Host': new URL(base).host, 'X-Forwarded-Proto': 'http' } },
		404
	);
	await expect(admissions, first, { ...owner, origin: alternateOrigin }, 409);
	await expect(admissions, complete(a.admissionId), { ...node, headers: { Origin: alternateOrigin } }, 403);
	await expect(uploads + '/parts', { uploadId: first.uploadId, parts: signParts(a.admissionId, single).parts }, node, 401);
	await expect(uploads + '/complete', { uploadId: first.uploadId }, node, 401);
	await expect('/api/v1/files', { id: first.requestId }, node, 401);
	await expect('/api/v1/files', { id: first.requestId }, { bearer: a.admissionId }, 401);
	const scopedSessionToken = await new SignJWT({})
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(owner.userId)
		.setJti(a.admissionId.split('.')[0])
		.setExpirationTime('60s')
		.sign(Buffer.from(secret));
	await expect('/api/v1/files', { id: first.requestId }, { bearer: scopedSessionToken }, 401);
	await expect(admissions, signParts(a.admissionId, [Buffer.from('wrong checksum')]), node, 409);
	const wrong = [multi[0], Buffer.alloc(multi[1].length, 24)];
	const wrongParts = (await expect(admissions, signParts(b.admissionId, wrong), node)).data.parts;
	await Promise.all(wrongParts.map((part: any, index: number) => put(part, wrong[index])));
	const mismatch = await expect(admissions, complete(b.admissionId), node, 409);
	assert.equal(mismatch.data.code, 'upload_parts_retryable');
	for (const [lease, reservation, parts] of [
		[a, first, single],
		[b, second, multi]
	] as const) {
		const signed = (await expect(admissions, signParts(lease.admissionId, parts), node)).data.parts;
		await Promise.all(signed.map((part: any, index: number) => put(part, parts[index])));
		const completed = (await expect(admissions, complete(lease.admissionId), node)).data;
		assert.equal(completed.attachment.id, reservation.uploadId);
		assert.deepEqual((await expect(admissions, complete(lease.admissionId), node)).data, completed);
		const { fingerprint } = (await expect('/api/v1/attachments/content?fingerprint=1&id=' + reservation.uploadId, undefined, owner)).data;
		assert.equal(fingerprint.sha256, reservation.fingerprint.sha256);
	}
	const guarded = await reserve(single, 'guarded', true);
	const guard = (await expect(admissions, guarded, owner)).data;
	const shared = (await expect(things, { id: child.id, acl: ['tt:all'], expectedUpdatedAt: child.updatedAt }, { ...owner, method: 'PATCH' })).data
		.thing;
	await expect(admissions, signParts(guard.admissionId, single), node, 409);
	await expect(things, { id: child.id, acl: ['tt:user'], expectedUpdatedAt: shared.updatedAt }, { ...owner, method: 'PATCH' });
	await expect(admissions, signParts(guard.admissionId, single), node);
	await expect(admissions, revoke(guard.admissionId), another, 404);
	await expect(admissions, revoke(guard.admissionId), owner);
	await expect(admissions, revoke(guard.admissionId), node);
	await expect(admissions, complete(guard.admissionId), node, 410);
	const hint = (await expect(admissions, guarded, owner, 410)).data;
	assert.equal(hint.code, 'admission_renewal_required');
	assert.equal(hint.admissionId, guard.admissionId);
	assert.equal((await expect(admissions, { ...guarded, sourceVersion: 'different' }, owner, 409)).data.admissionId, undefined);
	const replace = { ...guarded, replacesAdmissionId: guard.admissionId };
	await expect(admissions, { ...replace, sourceVersion: 'swapped-source' }, owner, 409);
	const replacement = (await expect(admissions, replace, owner)).data;
	assert.notEqual(replacement.admissionId, guard.admissionId);
	assert.deepEqual((await expect(admissions, replace, owner)).data, replacement);
	assert.deepEqual((await expect(admissions, guarded, owner)).data, replacement);
	await expect(admissions, { ...guarded, replacesAdmissionId: replacement.admissionId }, owner, 409);
	await expect(admissions, revoke(guard.admissionId), node, 404);
	await expect(admissions, signParts(replacement.admissionId, single), node);
	const stale = await reserve(single, 'stale');
	const staleGrant = (await expect(admissions, stale, owner)).data;
	saved = (
		await expect(
			things,
			{ id: saved.id, crystal: { ...configuration, paused: true }, expectedUpdatedAt: saved.updatedAt },
			{ ...owner, method: 'PATCH' }
		)
	).data.thing;
	await expect(admissions, signParts(staleGrant.admissionId, single), node, 409);
	await expect(admissions, stale, owner, 409);
	saved = (await expect(things, { id: saved.id, crystal: configuration, expectedUpdatedAt: saved.updatedAt }, { ...owner, method: 'PATCH' })).data
		.thing;
	await expect(admissions, signParts(staleGrant.admissionId, single), node, 409);
	const expires = await reserve(single, 'expiry');
	const ownerJwt = await authCookie.parse(owner.cookie);
	assert.equal(typeof ownerJwt, 'string');
	const { sub, jti } = decodeJwt(ownerJwt);
	const expiresInSeconds = Math.floor(Date.now() / 1000) + 4;
	const shortBearer = await new SignJWT({})
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(sub!)
		.setJti(jti!)
		.setExpirationTime(expiresInSeconds)
		.sign(Buffer.from(secret));
	const expiring = (await expect(admissions, expires, { bearer: shortBearer })).data;
	assert.equal(Date.parse(expiring.expiresAt), expiresInSeconds * 1000);
	await delay(Math.max(0, Date.parse(expiring.expiresAt) - Date.now()) + 25);
	await expect(admissions, signParts(expiring.admissionId, single), node, 410);
	const renewed = (await expect(admissions, { ...expires, replacesAdmissionId: expiring.admissionId }, owner)).data;
	assert.notEqual(renewed.admissionId, expiring.admissionId);
	await expect(admissions, signParts(expiring.admissionId, single), node, 404);
	await expect(admissions, signParts(renewed.admissionId, single), node);
	const logout = (await expect(admissions, await reserve(single, 'logout'), owner)).data;
	await expect('/api/v1/auth/logout', {}, owner);
	await expect(admissions, complete(logout.admissionId), node, 410);
	const ownerAgain = await expect('/api/v1/login', { username: ownerName, password });
	assert.ok(ownerAgain.cookie);
	await expect('/api/v1/devices/disconnect', { deviceId: node.deviceId }, ownerAgain);
	await expect(admissions, complete(logout.admissionId), node, 401);
	console.log(
		'PASS built API: two queued resources, multipart mismatch before completion, exact byte readback, idempotent retry, wrong origin/device/account, scope refusal, private destination/config CAS, explicit revocation, JWT expiry, owner logout and device disconnect'
	);
} finally {
	await cleanup();
	await rm(directory, { recursive: true, force: true });
}
