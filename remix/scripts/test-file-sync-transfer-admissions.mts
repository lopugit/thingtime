/** Built Nitro and a private disposable Mongo replica. All product state is
 * created through HTTP APIs; no personal credentials or database are used. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { access, chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeJwt, SignJWT } from 'jose';
import { authCookie } from '../app/api/utils/auth/authCookie';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
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
	adminName = 'operator-' + randomUUID().slice(0, 8),
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
const start = (command: string, args: string[], env: SpawnOptions['env'] = clean) => {
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
	const child = start(process.execPath, ['.output/server/index.mjs'], { ...serverEnv, ...(admin ? { ADMIN_USERNAMES: adminName } : {}) });
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
		admin = await register(adminName),
		outsider = await register('other-' + randomUUID().slice(0, 8));
	await stop(firstServer);
	await startApi(true);
	const allowUploads = (userId: string, enabled: boolean) =>
		expect('/api/v1/admin/users/public-uploads', { userId, enabled, scope: 'private' }, admin);
	await allowUploads(owner.userId, true);
	const manifest = (await expect('/.well-known/thingtime-capabilities.json')).data;
	assert.equal(manifest.origin, base);
	assert.ok(capabilitySatisfies(manifest.features['api.auth-accounts-remove']?.version, '1.0.1'));
	assert.ok(capabilitySatisfies(manifest.features['api.file-sync-transfer-admissions']?.version, '1.5.0'));
	assert.deepEqual(manifest.operations.find((operation: any) => operation.path === admissions).methods, ['POST']);
	assert.ok(capabilitySatisfies(manifest.features['api.things']?.version, '1.53.0'));
	assert.ok(capabilitySatisfies(manifest.features['api.things-update']?.version, '1.21.0'));
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
	async function reserve(parts: Buffer[], label: string, nested = false, photo = false) {
		const sizeBytes = parts.reduce((sum, part) => sum + part.length, 0),
			requestId = randomUUID(),
			filename = photo ? sha(Buffer.from(label)).toString('hex') + '-photo.jpg' : label + '.bin';
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
	const publish = (admissionId: string) => ({ action: 'publish', admissionId });
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
	await allowUploads(outsider.userId, true);
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
	await expect(admissions, { ...signParts(a.admissionId, single), transport: 'background-file-v1' }, node, 400);
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
	await expect(admissions, publish(a.admissionId), node, 403);
	await expect(admissions, { ...first, publication: { expectedRevision: null } }, owner, 409);
	const stagedPhoto = await reserve(single, 'older-photos-only', false, true);
	const stagedPhotoLease = (await expect(admissions, stagedPhoto, owner)).data;
	await expect(admissions, { ...stagedPhoto, publication: { expectedRevision: null } }, owner, 409);
	await expect(admissions, publish(stagedPhotoLease.admissionId), node, 403);
	await expect(admissions, { ...await reserve(single, 'nested-photo', true, true), publication: { expectedRevision: null } }, owner, 409);
	const photoPolicy = { ...configuration, configurationVersion: 4, photoAutomation: {
		notificationIntervalMs: 30 * 60_000, uploadBytesPerSecond: 625_000, uploadBytesPerHour: 1_000_000_000
	} };
	saved = (await expect('/api/v1/things/update', { id: saved.id, crystal: photoPolicy, expectedUpdatedAt: saved.updatedAt }, owner)).data.thing;
	assert.deepEqual((await expect(things + '?id=' + saved.id, undefined, owner)).data.thing.crystal, photoPolicy);
	async function admittedPhoto(label: string) {
		const upload = { ...await reserve(single, label, false, true), publication: { expectedRevision: null } };
		const lease = (await expect(admissions, upload, owner)).data;
		const signed = (await expect(admissions, signParts(lease.admissionId, single), node)).data.parts;
		await put(signed[0], single[0]);
		await expect(admissions, complete(lease.admissionId), node);
		const { version } = (await expect('/api/v1/attachments/content?fingerprint=1&id=' + upload.uploadId, undefined, owner)).data;
		const path = sha(Buffer.from(label)).toString('hex') + '-photo.jpg';
		const command = { id: upload.requestId, operationId: upload.requestId, expectedRevision: null, name: path, folderId: root.id,
			attachmentId: upload.uploadId, contentVersion: version, trashed: false, syncDestination: { rootId: root.id, path } };
		return { upload, lease, command };
	}
	const photo = await admittedPhoto('background');
	await expect(admissions, { ...publish(photo.lease.admissionId), folderId: child.id }, node, 400);
	await expect(admissions, publish(photo.lease.admissionId), another, 404);
	await expect(admissions, publish(photo.lease.admissionId), owner, 401);
	const fromDevice = (await expect(admissions, publish(photo.lease.admissionId), node)).data;
	assert.equal(fromDevice.replayed, false);
	assert.equal(fromDevice.file.content.fingerprint.sha256, photo.upload.fingerprint.sha256);
	assert.equal(fromDevice.file.folderId, root.id);
	assert.deepEqual((await expect(admissions, publish(photo.lease.admissionId), node)).data, { ...fromDevice, replayed: true });
	assert.deepEqual((await expect('/api/v1/files', photo.command, owner)).data, { ...fromDevice, replayed: true });
	assert.deepEqual((await expect('/api/v1/files?id=' + photo.command.id, undefined, owner)).data.file, fromDevice.file);
	const configAfterPublish = (await expect(things + '?id=' + saved.id, undefined, owner)).data.thing;
	assert.deepEqual(configAfterPublish.crystal, photoPolicy);
	assert.equal(configAfterPublish.updatedAt, saved.updatedAt);
	assert.equal(configAfterPublish.sizeBytes, saved.sizeBytes);
	assert.equal(JSON.stringify(configAfterPublish).includes('fileSyncPublicationFence'), false);
	const devicesAfterPublish = (await expect('/api/v1/devices', undefined, owner)).data;
	assert.equal(JSON.stringify(devicesAfterPublish).includes('fileSyncPublicationFence'), false);
	const foreground = await admittedPhoto('foreground');
	const firstWrite = (await expect('/api/v1/files', foreground.command, owner)).data;
	assert.deepEqual((await expect(admissions, publish(foreground.lease.admissionId), node)).data, { ...firstWrite, replayed: true });
	const racedPhoto = await admittedPhoto('concurrent');
	const [nodeWrite, browserWrite] = await Promise.all([
		expect(admissions, publish(racedPhoto.lease.admissionId), node), expect('/api/v1/files', racedPhoto.command, owner)
	]).then(results => results.map(result => result.data));
	assert.deepEqual(nodeWrite.file, browserWrite.file);
	assert.notEqual(nodeWrite.replayed, browserWrite.replayed);
	const revokedPhoto = await admittedPhoto('revoked');
	await expect(admissions, revoke(revokedPhoto.lease.admissionId), owner);
	await expect(admissions, publish(revokedPhoto.lease.admissionId), node, 410);
	await expect('/api/v1/files?id=' + revokedPhoto.command.id, undefined, owner, 404);
	const withheldPhoto = await admittedPhoto('withheld-uploads');
	await allowUploads(owner.userId, false);
	await expect(admissions, publish(withheldPhoto.lease.admissionId), node, 410);
	await expect('/api/v1/files?id=' + withheldPhoto.command.id, undefined, owner, 404);
	await allowUploads(owner.userId, true);
	const pausingPhoto = await admittedPhoto('paused');
	saved = (await expect(things, { id: saved.id, crystal: { ...photoPolicy, paused: true }, expectedUpdatedAt: saved.updatedAt }, { ...owner, method: 'PATCH' })).data.thing;
	await expect(admissions, publish(pausingPhoto.lease.admissionId), node, 409);
	await expect('/api/v1/files?id=' + pausingPhoto.command.id, undefined, owner, 404);
	saved = (await expect(things, { id: saved.id, crystal: configuration, replaceCrystal: true, expectedUpdatedAt: saved.updatedAt }, { ...owner, method: 'PATCH' })).data.thing;
	await expect(admissions, publish(pausingPhoto.lease.admissionId), node, 409);
	const openRun = () => ({ action: 'open-photo-run', configurationId: saved.id, configurationRevision: saved.updatedAt,
		deviceId: node.deviceId, localRootId, grantRevision: sha(Buffer.from('selected library grant')).toString('hex') });
	const run = (await expect(admissions, openRun(), owner)).data;
	assert.deepEqual((await expect(admissions, openRun(), owner)).data, run);
	await expect(admissions, openRun(), node, 401);
	await expect(admissions, { ...openRun(), configurationRevision: pausingPhoto.upload.configurationRevision }, owner, 409);
	const checkRun = (runId: string) => ({ action: 'check-photo-run', runId });
	const revokeRun = (runId: string) => ({ action: 'revoke-photo-run', runId });
	const newOriginal = (runId: string, label: string, parts = single) => {
		const sizeBytes = parts.reduce((sum, bytes) => sum + bytes.length, 0);
		return { action: 'reserve-photo-original', runId, path: sha(Buffer.from(label)).toString('hex') + '-photo.jpg',
			sourceVersion: 'original-' + label, sizeBytes,
			fingerprint: { ...contentPartPlan(sizeBytes), sha256: sha(Buffer.concat(parts.map(sha))).toString('hex') } };
	};
	await expect(admissions, checkRun(run.runId), owner, 401);
	await expect(admissions, checkRun(run.runId), another, 404);
	await expect(admissions, checkRun(run.runId), foreign, 404);
	await expect(admissions, checkRun(run.runId), { ...node, origin: alternateOrigin }, 404);
	await expect('/api/v1/files', { id: first.requestId }, { bearer: run.runId }, 401);
	await expect(admissions, { ...newOriginal(run.runId, 'invalid'), folderId: child.id }, node, 400);
	await expect(admissions, { ...newOriginal(run.runId, 'invalid'), path: 'Child/original.jpg' }, node, 400);
	await expect(admissions, { ...newOriginal(run.runId, 'invalid'), fingerprint: { partCount: 2 } }, node, 400);
	await expect(admissions, checkRun(run.runId), node);
	// One owner authorization, then paired-only reserve/sign/upload/publish.
	// Six originals cross the native four-original initial lookahead boundary.
	const refilled: any[] = [];
	const refillParts = Array.from({ length: 6 }, (_, i) => i === 4 ? multi : single);
	const refillRequests = refillParts.map((parts, i) => newOriginal(run.runId, 'refill-' + i, parts));
	// Match the installed native worker's five lanes. A shared path-observation
	// ceiling must apply backpressure, rather than reject siblings and cancel
	// the whole batch before its first publication.
	const firstWave = await Promise.all(refillRequests.slice(0, 5).map(async request => (await expect(admissions, request, node)).data));
	assert.equal(new Set(firstWave.map(row => row.uploadId)).size, 5);
	for (let i = 0; i < 6; i++) {
		const parts = refillParts[i], request = refillRequests[i];
		const reserved = i < firstWave.length ? firstWave[i] : (await expect(admissions, request, node)).data;
		assert.equal(reserved.state, 'reserved');
		if (i === 0) {
			const observer = await expect('/api/v1/login', { username: ownerName, password });
			const roster = observer.response.headers.getSetCookie().find(value => value.startsWith('tt_accounts='))?.split(';')[0];
			assert.ok(observer.cookie && roster && observer.cookie !== owner.cookie);
			const removed = await expect('/api/v1/auth/accounts/remove', { userId: owner.userId },
				{ cookie: observer.cookie + '; ' + roster });
			assert.equal(removed.data.user, null);
			assert.deepEqual(removed.data.accounts, []);
			assert.equal((await expect('/api/v1/auth/me', undefined, { cookie: observer.cookie })).data.user, null);
			await expect(admissions, checkRun(run.runId), node);
		}
		assert.deepEqual((await expect(admissions, request, node)).data, reserved);
		const signed = (await expect(admissions, signParts(reserved.admissionId, parts), node)).data.parts;
		if (i === 0) {
			await expect(admissions, { ...signParts(reserved.admissionId, parts), transport: 'caller-selected' }, node, 400);
			await expect(admissions, { ...complete(reserved.admissionId), transport: 'background-file-v1' }, node, 400);
			const local = (await expect(admissions, { ...signParts(reserved.admissionId, parts), transport: 'background-file-v1' }, node)).data.parts;
			assert.ok(local.every((part: any) => !Object.hasOwn(part, 'transport')), 'local storage never asserts canonical provider redirect trust');
			assert.ok(local.every((part: any) => Date.parse(part.expiresAt) <= Date.parse(reserved.expiresAt)));
		}
		await Promise.all(signed.map((part: any, index: number) => put(part, parts[index])));
		await expect(admissions, complete(reserved.admissionId), node);
		const ready = (await expect(admissions, request, node)).data;
		assert.deepEqual(ready, { ...reserved, staged: true });
		const published = (await expect(admissions, publish(reserved.admissionId), node)).data;
		assert.equal(published.file.id, reserved.requestId);
		assert.equal(published.file.content.fingerprint.sha256, request.fingerprint.sha256);
		assert.deepEqual((await expect(admissions, request, node)).data, { ok: true, state: 'already-backed' });
		refilled.push(published.file);
	}
	assert.equal(new Set(refilled.map(file => file.id)).size, 6);
	for (const file of refilled) assert.deepEqual((await expect('/api/v1/files?id=' + file.id, undefined, owner)).data.file, file);
	const differs = newOriginal(run.runId, 'refill-0', [Buffer.from('different original')]);
	await expect(admissions, differs, node, 409);
	await expect(admissions, { ...differs, guardedReplacement: true }, node, 403);
	const interruptedRequest = newOriginal(run.runId, 'paused-run');
	const interrupted = (await expect(admissions, interruptedRequest, node)).data;
	saved = (await expect(things, { id: saved.id, crystal: { ...configuration, paused: true }, expectedUpdatedAt: saved.updatedAt }, { ...owner, method: 'PATCH' })).data.thing;
	assert.equal((await expect(admissions, checkRun(run.runId), node, 409)).data.code, 'sync_configuration_changed');
	await expect(admissions, interruptedRequest, node, 409);
	await expect(admissions, signParts(interrupted.admissionId, single), node, 409);
	await expect(admissions, openRun(), owner, 409);
	saved = (await expect(things, { id: saved.id, crystal: configuration, replaceCrystal: true, expectedUpdatedAt: saved.updatedAt }, { ...owner, method: 'PATCH' })).data.thing;
	const rearmed = (await expect(admissions, openRun(), owner)).data;
	assert.notEqual(rearmed.runId, run.runId);
	await expect(admissions, checkRun(run.runId), node, 404);
	await expect(admissions, checkRun(rearmed.runId), node);
	const revokedRunPhoto = (await expect(admissions, newOriginal(rearmed.runId, 'revoked-run'), node)).data;
	const revokedRunParts = (await expect(admissions, signParts(revokedRunPhoto.admissionId, single), node)).data.parts;
	await put(revokedRunParts[0], single[0]);
	await expect(admissions, complete(revokedRunPhoto.admissionId), node);
	await expect(admissions, revokeRun(rearmed.runId), another, 404);
	await expect(admissions, revokeRun(rearmed.runId), owner);
	await expect(admissions, checkRun(rearmed.runId), node, 410);
	await expect(admissions, publish(revokedRunPhoto.admissionId), node, 410);
	await expect('/api/v1/files?id=' + revokedRunPhoto.requestId, undefined, owner, 404);
	const guardedRun = (await expect(admissions, { ...openRun(), guardedReplacement: true }, owner)).data;
	const updatedParts = [Buffer.from('edited original with a retained prior version')];
	const changeOriginal = { ...newOriginal(guardedRun.runId, 'refill-0', updatedParts), guardedReplacement: true };
	const updated = (await expect(admissions, changeOriginal, node)).data, priorOriginal = refilled[0];
	assert.equal(updated.fileId, priorOriginal.id);
	assert.notEqual(updated.requestId, priorOriginal.id);
	assert.deepEqual(updated.publication, { expectedRevision: priorOriginal.revision });
	assert.deepEqual((await expect(admissions, changeOriginal, node)).data, updated);
	const updateParts = (await expect(admissions, signParts(updated.admissionId, updatedParts), node)).data.parts;
	await put(updateParts[0], updatedParts[0]);
	await expect(admissions, complete(updated.admissionId), node);
	const replacementFile = (await expect(admissions, publish(updated.admissionId), node)).data.file;
	assert.equal(replacementFile.id, priorOriginal.id);
	assert.notEqual(replacementFile.revision, priorOriginal.revision);
	assert.equal(replacementFile.content.fingerprint.sha256, changeOriginal.fingerprint.sha256);
	assert.deepEqual((await expect('/api/v1/files?id=' + priorOriginal.id + '&operationId=' + priorOriginal.id, undefined, owner)).data.receipt.file, priorOriginal);
	const differentGrant = (await expect(admissions, { ...openRun(), guardedReplacement: true, grantRevision: 'b'.repeat(64) }, owner)).data;
	const needsReview = await expect(admissions, { ...newOriginal(differentGrant.runId, 'refill-0', [Buffer.from('different grant')]), guardedReplacement: true }, node, 409);
	assert.equal(needsReview.data.code, 'photo_path_conflict');
	const unrelated = await reserve(single, 'manual-existing', false, true);
	const stagedOnly = (await expect(admissions, unrelated, owner)).data;
	const unrelatedParts = (await expect(admissions, signParts(stagedOnly.admissionId, single), node)).data.parts;
	await put(unrelatedParts[0], single[0]);
	await expect(admissions, complete(stagedOnly.admissionId), node);
	const { version: unrelatedVersion } = (await expect('/api/v1/attachments/content?fingerprint=1&id=' + unrelated.uploadId, undefined, owner)).data;
	const unrelatedPath = newOriginal(differentGrant.runId, 'manual-existing').path;
	await expect('/api/v1/files', { id: unrelated.requestId, operationId: unrelated.requestId, expectedRevision: null,
		name: unrelatedPath, folderId: root.id, attachmentId: unrelated.uploadId, contentVersion: unrelatedVersion, trashed: false }, owner);
	const needsManagedProof = (await expect(admissions, { ...openRun(), guardedReplacement: true }, owner)).data;
	const occupied = await expect(admissions, { ...newOriginal(needsManagedProof.runId, 'manual-existing', updatedParts), guardedReplacement: true }, node, 409);
	assert.equal(occupied.data.code, 'photo_path_conflict');
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
	saved = (await expect(things, { id: saved.id, crystal: configuration, replaceCrystal: true, expectedUpdatedAt: saved.updatedAt }, { ...owner, method: 'PATCH' })).data
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
	const logout = await admittedPhoto('logout');
	await expect('/api/v1/auth/logout', {}, owner);
	await expect(admissions, publish(logout.lease.admissionId), node, 410);
	const ownerAgain = await expect('/api/v1/login', { username: ownerName, password });
	assert.ok(ownerAgain.cookie);
	await expect('/api/v1/devices/disconnect', { deviceId: node.deviceId }, ownerAgain);
	await expect(admissions, publish(logout.lease.admissionId), node, 401);
	console.log(
		'PASS built API: six paired-only Photos refills, guarded retained update/refusals, revoke/pause/rotation, scoped Photos publication and canonical two-way replay, staged-only refusal, multipart integrity, v4 save/readback, private placement, pause/revision/revocation, credential expiry, owner logout and device disconnect'
	);
} finally {
	await cleanup();
	await rm(directory, { recursive: true, force: true });
}
