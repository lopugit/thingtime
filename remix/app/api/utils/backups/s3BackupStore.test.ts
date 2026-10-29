import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fingerprintSource } from '../../../fileSync/contentFingerprint';
import { BACKUP_FORMAT, BACKUP_CHUNK_BYTES, type BackupItem, type BackupHeader } from '../../../backups/manifest';
import { openLocalBackupStore } from './localBackupStore';
import { captureBackup, prepareBackup, sealBackup, openBackupItem, copySealedBackup } from './portableBackup';
import { openS3BackupStore, validateS3BackupDestination } from './s3BackupStore';

const scope = { apiOrigin: 'https://backup.test', ownerId: 'owner', dataPlane: 'home' };
const access = { scope, authorize: async () => {} };
// Synthetic credentials only; this fixture never reads environment/profile credentials.
const credentials = { accessKeyId: 'TESTBACKUP', secretAccessKey: 'synthetic-fixture-not-a-real-secret' };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const metaKey = `snapshots/${randomUUID()}/header.json`;

/** Real AWS SDK HTTP transport against a disposable loopback protocol fixture.
 * This does not establish live S3/B2 IAM, durability or provider compatibility. */
async function fixture() {
	const objects = new Map<string, Buffer>();
	const puts = new Map<string, number>();
	const requests: { method: string; key: string }[] = [];
	let intercept: ((request: IncomingMessage, response: ServerResponse, key: string) => boolean) | undefined;
	let afterWrite: ((key: string) => boolean) | undefined;
	const server = createServer(async (request, response) => {
		try {
			const key = new URL(request.url!, 'http://127.0.0.1').pathname;
			requests.push({ method: request.method!, key });
			assert.ok(request.headers.authorization?.includes('Credential=TESTBACKUP/'));
			assert.equal(request.headers['x-amz-expected-bucket-owner'], '123456789012');
			assert.match(key, /^\/test-backups\/independent\/scopes\/[a-f0-9]{64}\/v1\//);
			if (intercept?.(request, response, key)) return;
			const error = (status: number, code: string) => {
				response.writeHead(status, { 'content-type': 'application/xml' });
				response.end(`<Error><Code>${code}</Code></Error>`);
			};
			if (request.method === 'GET') {
				const data = objects.get(key);
				if (!data) return error(404, 'NoSuchKey');
				response.writeHead(200, { 'content-length': data.length, 'x-amz-checksum-sha256': createHash('sha256').update(data).digest('base64') });
				return response.end(data);
			}
			assert.equal(request.method, 'PUT');
			assert.equal(request.headers['if-none-match'], '*');
			assert.equal(request.headers['x-amz-server-side-encryption'], 'AES256');
			const parts: Buffer[] = [];
			let length = 0;
			for await (const part of request) {
				length += part.length;
				assert.ok(length <= BACKUP_CHUNK_BYTES);
				parts.push(part);
			}
			const bytes = Buffer.concat(parts);
			assert.equal(request.headers['x-amz-checksum-sha256'], createHash('sha256').update(bytes).digest('base64'));
			if (objects.has(key)) return error(412, 'PreconditionFailed');
			objects.set(key, bytes);
			puts.set(key, (puts.get(key) ?? 0) + 1);
			if (afterWrite?.(key)) {
				response.destroy();
				return;
			}
			response.writeHead(200);
			response.end();
		} catch {
			response.writeHead(500);
			response.end();
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const destination = {
		endpoint: `http://127.0.0.1:${(server.address() as any).port}`,
		region: 'test-region',
		bucket: 'test-backups',
		prefix: 'independent',
		expectedBucketOwner: '123456789012'
	};
	const runtime = { ...access, credentials, allowLoopbackHttp: true };
	return {
		objects,
		puts,
		requests,
		destination,
		runtime,
		intercept(fn: typeof intercept) {
			intercept = fn;
		},
		afterWrite(fn: typeof afterWrite) {
			afterWrite = fn;
		},
		async close() {
			server.closeAllConnections();
			await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
		}
	};
}
test('S3 writes are conditional, scope-separated, immutable and retried after a lost acknowledgement', async () => {
	const f = await fixture(),
		store = openS3BackupStore(f.destination, f.runtime);
	try {
		assert.equal(await store.read(metaKey, 100), null);
		const data = Buffer.from('retained');
		let lost = false;
		f.afterWrite(() => {
			if (lost) return false;
			lost = true;
			return true;
		});
		await store.put(metaKey, data);
		await Promise.all([store.put(metaKey, data), store.put(metaKey, data)]);
		await assert.rejects(store.put(metaKey, Buffer.from('changed')), /Immutable/);
		assert.deepEqual(await store.read(metaKey, 100), data);
		assert.deepEqual([...f.puts.values()], [1]);
		assert.deepEqual(Object.keys(credentials).sort(), ['accessKeyId', 'secretAccessKey']);
		const other = openS3BackupStore(f.destination, { ...f.runtime, scope: { ...scope, ownerId: 'other' } });
		try {
			assert.equal(await other.read(metaKey, 100), null);
		} finally {
			other.close();
		}
		assert.notEqual(f.requests[0].key, f.requests.at(-1)!.key);
		let conflicts = 0;
		f.intercept((req, res) => {
			if (req.method !== 'PUT') return false;
			conflicts++;
			res.writeHead(409, { 'content-type': 'application/xml' });
			res.end('<Error><Code>ConditionalRequestConflict</Code></Error>');
			return true;
		});
		await assert.rejects(store.put(metaKey, data), /write failed/);
		assert.equal(conflicts, 3);
	} finally {
		store.close();
		await f.close();
	}
});

test('S3 rejects unsafe destinations, missing credentials, escaping keys and unbounded or corrupt reads', async () => {
	const f = await fixture(),
		store = openS3BackupStore(f.destination, f.runtime);
	try {
		assert.throws(() => openS3BackupStore(f.destination, { ...f.runtime, credentials: undefined! }), /credentials/);
		for (const endpoint of ['http://example.com', 'https://host/path', 'https://user:pass@host', 'https://host?secret=value'])
			assert.throws(() => validateS3BackupDestination({ ...f.destination, endpoint }, true));
		assert.throws(() => validateS3BackupDestination(f.destination));
		assert.throws(
			() => validateS3BackupDestination({ ...f.destination, endpoint: 'https://s3.us-east-1.amazonaws.com', expectedBucketOwner: null }),
			/owner/
		);
		for (const prefix of ['', '../private', 'x//y', '/x', 'x/']) assert.throws(() => validateS3BackupDestination({ ...f.destination, prefix }, true));
		await assert.rejects(store.read('../source', 1), /key/);
		await assert.rejects(store.read(metaKey, BACKUP_CHUNK_BYTES + 1), /bound/);
		await assert.rejects(store.put(`chunks/${'0'.repeat(64)}`, Buffer.from('x')), /checksum/);
		assert.equal(f.requests.length, 0);
		f.intercept((_req, res) => {
			res.writeHead(301, { location: 'http://127.0.0.1:1/never-follow', 'content-type': 'application/xml' });
			res.end('<Error><Code>PermanentRedirect</Code></Error>');
			return true;
		});
		await assert.rejects(store.read(metaKey, 10), /read failed/);
		assert.equal(f.requests.length, 1);
		for (const code of ['AccessDenied', 'NoSuchBucket']) {
			f.intercept((_req, res) => {
				res.writeHead(code === 'NoSuchBucket' ? 404 : 403, { 'content-type': 'application/xml' });
				res.end(`<Error><Code>${code}</Code><Message>private-provider-detail</Message></Error>`);
				return true;
			});
			await assert.rejects(store.read(metaKey, 10), (error) => String(error) === 'Error: Backup object read failed');
		}
		f.intercept((_req, res) => {
			res.writeHead(200, { 'content-length': BACKUP_CHUNK_BYTES + 1 });
			res.flushHeaders();
			return true;
		});
		await assert.rejects(store.read(metaKey, 10), /response/);
		f.intercept((_req, res) => {
			res.writeHead(200, { 'content-length': 3 });
			res.write('x');
			setImmediate(() => res.destroy());
			return true;
		});
		await assert.rejects(store.read(metaKey, 10));
		f.intercept((_req, res) => {
			res.writeHead(200, { 'content-length': 1, 'x-amz-checksum-sha256': 'invalid' });
			res.end('x');
			return true;
		});
		await assert.rejects(store.read(metaKey, 10), /checksum/);
		f.intercept((_req, res) => {
			res.writeHead(200, { 'content-length': 1 });
			res.end('x');
			return true;
		});
		await assert.rejects(store.read(`chunks/${'0'.repeat(64)}`, 10), /checksum/);
	} finally {
		store.close();
		await f.close();
	}
});

test('S3 fences revoked access, changed scopes, aborted streams and closed providers', async () => {
	const f = await fixture(),
		abort = new AbortController();
	let authorized = true;
	const runtime = {
		...f.runtime,
		scope: { ...scope },
		signal: abort.signal,
		authorize: async () => {
			if (!authorized) throw Error('revoked');
		}
	};
	const store = openS3BackupStore(f.destination, runtime);
	try {
		authorized = false;
		await assert.rejects(store.put(metaKey, Buffer.from('a')), /revoked/);
		assert.equal(f.requests.length, 0);
		authorized = true;
		runtime.scope.ownerId = 'another';
		await assert.rejects(store.read(metaKey, 100), /account/);
		runtime.scope.ownerId = scope.ownerId;
		f.intercept((_req, res) => {
			res.writeHead(200, { 'content-length': 100 });
			res.write('a');
			setImmediate(() => abort.abort());
			return true;
		});
		await assert.rejects(store.read(metaKey, 100));
		store.close();
		await assert.rejects(store.read(metaKey, 100), /closed/);
	} finally {
		store.close();
		await f.close();
	}
});

test('an account change while vault credentials resolve prevents the first network effect', async () => {
	const f = await fixture();
	let release!: () => void, started!: () => void;
	const pending = new Promise<void>((r) => {
			release = r;
		}),
		resolving = new Promise<void>((r) => {
			started = r;
		});
	const runtime = {
		...f.runtime,
		scope: { ...scope },
		credentials: async () => {
			started();
			await pending;
			return credentials;
		}
	};
	const store = openS3BackupStore(f.destination, runtime);
	try {
		const refused = assert.rejects(store.put(metaKey, Buffer.from('private')), /account/);
		await resolving;
		runtime.scope.ownerId = 'changed';
		release();
		await refused;
		assert.equal(f.requests.length, 0);
		assert.deepEqual(Object.keys(credentials).sort(), ['accessKeyId', 'secretAccessKey']);
	} finally {
		release();
		store.close();
		await f.close();
	}
});

test('replica CLI resumes a killed upload and downloads independently after the primary vault is removed', { timeout: 60_000 }, async () => {
	const f = await fixture(),
		root = await mkdtemp(join(tmpdir(), 'thingtime-s3-backup-'));
	const sourcePath = join(root, 'source'),
		targetPath = join(root, 'recovered'),
		id = randomUUID();
	const bytes = Buffer.alloc(BACKUP_CHUNK_BYTES + 17, 73);
	bytes[bytes.length - 1] = 91;
	const h: BackupHeader = {
		format: BACKUP_FORMAT,
		snapshotId: id,
		scope,
		boundary: {
			kind: 'point-in-time' as const,
			token: 'synthetic-fixture',
			startedAt: '2026-10-19T00:00:00.000Z',
			completedAt: '2026-10-19T00:00:00.000Z'
		},
		coverage: { selectionId: 'fixture', description: 'Disposable file, not an account backup' }
	};
	const item: BackupItem = {
		ordinal: 0,
		thingId: 'file',
		revision: 'v1',
		snapshot: { adapter: 'fixture', version: 1, value: {} },
		content: {
			size: bytes.length,
			fingerprint: await fingerprintSource({ size: bytes.length, check() {}, read: async (o, n) => bytes.subarray(o, o + n) })
		}
	};
	let child: ChildProcess | undefined;
	const run = async (command: string, path: string, handoff: unknown = { destination: f.destination, scope, credentials }, localFixture = true) => {
		child = spawn(
			process.execPath,
			['--import', 'tsx', 'scripts/backup-replica.mts', command, path, id, ...(localFixture ? ['--local-http-fixture'] : [])],
			{ cwd: resolve(import.meta.dirname, '../../../..'), stdio: ['pipe', 'pipe', 'pipe'] }
		);
		let out = '',
			err = '';
		child.stdout!.on('data', (c) => {
			out += c;
		});
		child.stderr!.on('data', (c) => {
			err += c;
		});
		child.stdin!.on('error', () => {});
		child.stdin!.end(JSON.stringify(handoff));
		const [code, signal] = await once(child, 'close');
		assert.ok(!out.includes(credentials.secretAccessKey) && !err.includes(credentials.secretAccessKey));
		return { code, signal, out, err };
	};
	try {
		const local = await openLocalBackupStore(sourcePath);
		await prepareBackup(
			local,
			h,
			(async function* () {
				yield item;
			})(),
			access
		);
		await captureBackup(local, id, { read: async (_item, o, n) => bytes.subarray(o, o + n) }, access);
		await sealBackup(local, id, access);
		let killedKey = '';
		f.afterWrite((key) => {
			if (!killedKey && key.includes('/chunks/')) {
				killedKey = key;
				child!.kill('SIGKILL');
				return true;
			}
			return false;
		});
		const killed = await run('upload', sourcePath);
		assert.equal(killed.signal, 'SIGKILL', JSON.stringify({ ...killed, requests: f.requests.length }));
		assert.ok(killedKey);
		assert.ok(![...f.objects.keys()].some((k) => k.endsWith('/complete.json')));
		f.afterWrite(undefined);
		const resumed = await run('upload', sourcePath);
		assert.equal(resumed.code, 0, resumed.err);
		const uploaded = JSON.parse(resumed.out.trim().split('\n').at(-1)!);
		assert.equal(uploaded.reusedBytes, String(BACKUP_CHUNK_BYTES));
		assert.equal(uploaded.copiedBytes, '17');
		assert.equal(f.puts.get(killedKey), 1);
		const requestsBefore = f.requests.length;
		const wrongScope = await run('upload', sourcePath, { destination: f.destination, credentials, scope: { ...scope, ownerId: 'wrong-owner' } });
		assert.equal(wrongScope.code, 1);
		assert.equal(f.requests.length, requestsBefore);
		const expired = await run('upload', sourcePath, {
			destination: f.destination,
			scope,
			credentials: { ...credentials, sessionToken: 'synthetic', expiration: '2000-01-01T00:00:00.000Z' }
		});
		assert.equal(expired.code, 1);
		assert.equal(f.requests.length, requestsBefore);
		const cleartext = await run('upload', sourcePath, undefined, false);
		assert.equal(cleartext.code, 1);
		assert.equal(f.requests.length, requestsBefore);
		await rm(sourcePath, { recursive: true, force: true });
		const downloaded = await run('download', targetPath);
		assert.equal(downloaded.code, 0, downloaded.err);
		const recovered = await openLocalBackupStore(targetPath, { create: false });
		const file = await openBackupItem(recovered, id, 'file', access);
		const actual = createHash('sha256');
		for await (const range of file.ranges) actual.update(range);
		assert.equal(actual.digest('hex'), digest(bytes));
		const again = await run('download', targetPath);
		assert.equal(again.code, 0, again.err);
		assert.equal(JSON.parse(again.out.trim().split('\n').at(-1)!).copiedBytes, '0');
		// A progress callback changing authority cannot publish a completion seal.
		const destination = await openLocalBackupStore(join(root, 'revoked'));
		let revoked = false;
		await assert.rejects(
			copySealedBackup(
				recovered,
				destination,
				id,
				{
					scope,
					authorize: async () => {
						if (revoked) throw Error('revoked');
					}
				},
				{
					onProgress: async (p) => {
						if (p.phase === 'verifying') revoked = true;
					}
				}
			),
			/revoked/
		);
		assert.equal(await destination.read(`snapshots/${id}/complete.json`, 128 * 1024), null);
	} finally {
		if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGKILL');
		await f.close();
		await rm(root, { recursive: true, force: true });
	}
});
