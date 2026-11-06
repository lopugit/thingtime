/** Real handler/API-utils + replica snapshot engine proof, isolated synthetic
 * account/bytes/local independent vault only. No direct collection access. */
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.env.THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY;
assert.ok(
	directory && /^mongodb:\/\/127\.0\.0\.1:28173\/thingtime\?replicaSet=account-profile-backup$/.test(process.env.MONGODB_CONNECTION_STRING || ''),
	'Use the isolated backup-engine runner'
);
const base = 'http://127.0.0.1:28173';
process.env.APP_URL = base;
process.env.JWT_SECRET = randomBytes(48).toString('base64url');
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
process.env.ADMIN_USERNAMES = '';
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = join(directory!, 'objects');
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN = base;
const register = await import('../app/routes/api/v1/auth/register/_register');
const migrations = await import('../app/routes/api/v1/admin/migrations/run/_run');
const things = await import('../app/routes/api/v1/things/_things');
const uploadApproval = await import('../app/routes/api/v1/admin/users/public-uploads/_public-uploads');
const files = await import('../app/routes/api/v1/files/_files');
const me = await import('../app/routes/api/v1/auth/me/_me');
const uploads = await import('../app/routes/api/v1/attachments/uploads/_uploads');
const parts = await import('../app/routes/api/v1/attachments/uploads/parts/_parts');
const complete = await import('../app/routes/api/v1/attachments/uploads/complete/_complete');
const content = await import('../app/routes/api/v1/attachments/content/_content');
const { handleLocalAttachmentStorageRequest } = await import('../app/api/utils/attachments/localAttachmentStorage');
const { ensureIndexes } = await import('../app/api/utils/mongodb/collections');
const { getCurrentUser } = await import('../app/api/utils/auth/getCurrentUser');
const { thingtimeCapabilityManifest, capabilitySatisfies } = await import('../app/api/utils/capabilities/thingtimeCapabilities');
const { createBackupJobCoordinator } = await import('../app/api/utils/backups/backupJobs');
const { createBackupEngine } = await import('../app/api/utils/backups/backupEngine.server');
const { openLocalBackupStore } = await import('../app/api/utils/backups/localBackupStore');
const { openIndexedSealedBackup, verifyBackup } = await import('../app/api/utils/backups/portableBackup');
const { openAccountBackupFile, openAccountBackupFileVersion, openAccountBackupTimelineRecord } = await import(
	'../app/api/utils/backups/accountFileRecovery'
);
const { openBackupThingSnapshot } = await import('../app/api/utils/backups/thingSnapshots');
const { stageCloudFileBytes } = await import('../app/fileSync/cloudTransport');
const { backupJson } = await import('../app/backups/manifest');
const { fingerprintSource } = await import('../app/fileSync/contentFingerprint');
const request = (cookie: string, path = '/api/v1/things', body?: unknown) =>
	new Request(base + path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
async function call(handler: any, cookie: string, path: string, body?: unknown) {
	const response: Response = await handler({ request: request(cookie, path, body) });
	const data = await response.json();
	assert.equal(response.status, 200, JSON.stringify(data));
	return { response, data };
}
const username = 'snapshot-engine-' + randomUUID().slice(0, 8),
	created = await call(register.action, '', '/api/v1/auth/register', {
		username,
		email: username + '@example.invalid',
		password: randomUUID() + '-Disposable!'
	});
const cookie = created.response.headers
		.getSetCookie()
		.map((v) => v.split(';')[0])
		.join('; '),
	user = await getCurrentUser(request(cookie));
assert.ok(user);
assert.equal(user!.id, created.data.user.id);
process.env.ADMIN_USERNAMES = username;
await call(migrations.action, cookie, '/api/v1/admin/migrations/run', { migration: 'retire-legacy-thing-indexes', confirm: true });
await new Promise((resolve) => setTimeout(resolve, 60_100));
await call(migrations.action, cookie, '/api/v1/admin/migrations/run', { migration: 'retire-legacy-thing-indexes', confirm: true });
await ensureIndexes({ force: true });
await call(uploadApproval.action,cookie,'/api/v1/admin/users/public-uploads',{userId:user!.id,enabled:true,scope:'private'});
process.env.ADMIN_USERNAMES = '';
assert.equal((await getCurrentUser(request(cookie)))?.privateUploadsEnabled,true);
const folder = (
	await call(things.action, cookie, '/api/v1/things', { thingtime: ['folder'], acl: ['tt:user'], crystal: { name: 'Synthetic snapshot root' } })
).data.thing;
const ordinary = (
	await call(things.action, cookie, '/api/v1/things', {
		thingtime: ['data'],
		acl: ['tt:user'],
		folderId: folder.id,
		crystal: { text: 'Pinned ordinary graph 🥰' }
	})
).data.thing;
const independent = (await call(things.loader, cookie, '/api/v1/things?id=' + ordinary.id)).data.thing;
assert.equal(independent.crystal.text, 'Pinned ordinary graph 🥰');
const manifest = thingtimeCapabilityManifest(base),
	scope = { apiOrigin: base, ownerId: user!.id, dataPlane: 'home' };
const syncScope = { origin: base, ownerId: user!.id, dataPlane: 'home', rootId: folder.id, deviceId: 'isolated-snapshot-fixture' };
const fixtureFetch: typeof fetch = async (input, init) => {
	const supplied = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), base), init),
		url = new URL(supplied.url);
	assert.equal(url.origin, base);
	const headers = new Headers(supplied.headers);
	headers.set('Cookie', cookie);
	headers.set('Origin', base);
	const req = new Request(supplied, { headers });
	if (url.pathname === '/api/v1/attachments/local-object') return handleLocalAttachmentStorageRequest(req);
	const handler =
		url.pathname === '/api/v1/auth/me'
			? me.loader
			: url.pathname === '/api/v1/attachments/uploads'
			? uploads.action
			: url.pathname.endsWith('/uploads/parts')
			? parts.action
			: url.pathname.endsWith('/uploads/complete')
			? complete.action
			: url.pathname === '/api/v1/attachments/content'
			? req.method === 'POST'
				? content.action
				: content.loader
			: url.pathname === '/api/v1/files'
			? req.method === 'POST'
				? files.action
				: files.loader
			: null;
	assert.ok(handler, 'Fixed synthetic upload route');
	return handler!({ request: req } as any);
};
const uploadRuntime = {
	currentScope: () => syncScope,
	origin: () => base,
	fetch: fixtureFetch,
	requireCapability: async (feature: string, minimum: string) =>
		assert.ok(capabilitySatisfies(manifest.features[feature]?.version ?? '', minimum), feature)
};
const fileId = randomUUID(),
	oldBytes = new Uint8Array(Buffer.alloc(8 * 1024 * 1024 + 17, 37)),
	newBytes = new Uint8Array(Buffer.alloc(8 * 1024 * 1024 + 17, 63));
async function publish(bytes: Uint8Array, before: any = null) {
	const operationId = randomUUID(),
		fingerprint = await fingerprintSource({ size: bytes.length, read: async (o, l) => bytes.slice(o, o + l), check: () => {} });
	const staged = await stageCloudFileBytes(
		uploadRuntime,
		{
			scope: syncScope,
			folderId: folder.id,
			before: null,
			cloudRootId: folder.id,
			operation: {
				id: operationId,
				confirmed: true,
				mutation: {
					kind: 'copy',
					from: 'local',
					path: 'synthetic.txt',
					expectedTarget: null,
					source: { kind: 'file', path: 'synthetic.txt', id: fileId, version: 'fixture', size: bytes.length, sha256: null, fingerprint }
				}
			}
		},
		fileId,
		{ size: bytes.length, read: async (o, l) => bytes.slice(o, o + l), check: () => {} },
		undefined,
		{ purpose: 'file' }
	);
	return (
		await call(files.action, cookie, '/api/v1/files', {
			id: fileId,
			operationId,
			expectedRevision: before?.revision ?? null,
			name: 'synthetic.txt',
			folderId: folder.id,
			attachmentId: staged.attachmentId,
			contentVersion: staged.version,
			trashed: false
		})
	).data.file;
}
const oldFile = await publish(oldBytes),
	currentFile = await publish(newBytes, oldFile);
assert.notEqual(oldFile.revision, currentFile.revision);
const store = await openLocalBackupStore(join(directory!, 'independent-snapshot')),
	binding = 'a'.repeat(64),
	snapshotId = randomUUID();
const jobs = createBackupJobCoordinator(),
	job = await jobs.admit(request(cookie, '/api/v1/backups'), {
		requestId: randomUUID(),
		operation: { kind: 'snapshot', snapshotId, destinationId: 'fixture-independent' },
		destinationBinding: binding
	});
const engine = () =>
	createBackupEngine({
		openDestination: async (_id, access, pin) => {
			assert.equal(pin, binding);
			await access.authorize();
			return { store, binding };
		},
		manifestReader: async () => manifest
	});
let steps = 0,
	maxStepMs = 0,
	primaryRemoved = false,
	paused = false,
	lostReply = false,
	captureReplayed = false,
	lastCursor: any = null;
const started = performance.now();
for (;;) {
	assert.ok(performance.now() - started < 480_000, 'Synthetic snapshot engine exceeded bounded fixture time');
	const claim = await jobs.claim(job.id);
	assert.ok(claim.lease);
	const stepStart = performance.now();
	const outcome = await jobs.withLease(claim.lease!, async (ctx) => {
		lastCursor = ctx.cursor;
		if (ctx.cursor.phase === 'capture' && !paused) {
			await jobs.control(request(cookie), job.id, 'pause');
			await assert.rejects(ctx.guard());
			return null;
		}
		// The transport invokes actual auth/retention/range Request handlers with a
		// tokenless, original-session lease binding. A discarded committed cursor
		// acknowledgement must not allocate a new snapshot or duplicate its chunks.
		const originalCheckpoint = ctx.checkpoint.bind(ctx);
		const wrapped = {
			...ctx,
			get cursor() {
				return ctx.cursor;
			},
			checkpoint: async (next: any, options: any) => {
				await originalCheckpoint(next, options);
				if (!lostReply && next.phase === 'capture' && Number(next.rangeOffset) > 0) {
					lostReply = true;
					throw Error('fixture accepted cursor reply lost');
				}
			}
		};
		try {
			return await engine()(wrapped);
		} catch (error: any) {
			if (error.message === 'fixture accepted cursor reply lost') {
				captureReplayed = true;
				return { kind: 'continue' as const };
			}
			throw error;
		}
	});
	maxStepMs = Math.max(maxStepMs, performance.now() - stepStart);
	steps++;
	if (outcome === null) {
		paused = true;
		await jobs.control(request(cookie), job.id, 'resume');
		continue;
	}
	await jobs.finish(claim.lease!, outcome);
	if (!primaryRemoved && lastCursor?.phase === 'verify') {
		await rm(join(directory!, 'objects'), { recursive: true, force: true });
		primaryRemoved = true;
	}
	if (outcome.kind === 'complete') break;
	assert.equal(outcome.kind, 'continue');
}
assert.equal(paused, true);
assert.equal(primaryRemoved, true);
assert.equal(captureReplayed, true);
assert.equal((await jobs.current(request(cookie), job.id)).status, 'completed');
const access = { scope, authorize: async () => assert.equal((await getCurrentUser(request(cookie)))?.id, user!.id) };
const verified = await verifyBackup(store, snapshotId, access),
	index = await openIndexedSealedBackup(store, snapshotId, access);
const recovered = await openAccountBackupFile(store, snapshotId, fileId, access, index),
	currentChunks: Uint8Array[] = [];
for await (const bytes of recovered.ranges) currentChunks.push(bytes);
assert.deepEqual(Buffer.concat(currentChunks), Buffer.from(newBytes));
let oldVersionFound = false;
for await (const item of index.items())
	if (item.snapshot.adapter === 'backup-timeline-record') {
		const record = await openAccountBackupTimelineRecord(store, snapshotId, item.thingId, access, index);
		if (record.kind === 'timeline-event')
			for (const side of ['before', 'after'] as const) {
				const value = (record.value as any).event[side];
				if (value?.adapter === 'file-content' && value.value.revision === oldFile.revision) {
					const old = await openAccountBackupFileVersion(store, snapshotId, item.thingId, side, access, index),
						chunks: Uint8Array[] = [];
					for await (const bytes of old.ranges) chunks.push(bytes);
					assert.deepEqual(Buffer.concat(chunks), Buffer.from(oldBytes));
					oldVersionFound = true;
				}
			}
	}
assert.equal(oldVersionFound, true);
const ordinaryRead = await openBackupThingSnapshot(store, snapshotId, ordinary.id, access);
assert.equal((ordinaryRead.value as any).crystal.text, independent.crystal.text);
await index.close();
console.log(
	JSON.stringify({
		backupEngineProof: true,
		steps,
		maxStepMs,
		elapsedMs: performance.now() - started,
		primaryRemoved,
		pauseResume: paused,
		acceptedCaptureReplyLoss: captureReplayed,
		currentBytes: true,
		retainedHistoricalBytes: true,
		ordinaryGraph: true,
		sealHash: createHash('sha256').update(backupJson(verified)).digest('hex'),
		boundary:
			'Production Request handlers/API-utils and real replica/private independent local vault; not HTTP/browser/deployed Workflow/live S3 acceptance'
	})
);
process.exit(0);
