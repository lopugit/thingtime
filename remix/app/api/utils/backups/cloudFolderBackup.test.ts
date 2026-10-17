import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprintSource } from '../../../fileSync/contentFingerprint';
import { BACKUP_METADATA_BYTES } from '../../../backups/manifest';
import { openLocalBackupStore } from './localBackupStore';
import { openBackupItem } from './portableBackup';
import { prepareCloudFolderBackup, resumeCloudFolderBackup, CLOUD_BACKUP_FOLDER_ADAPTER, type CloudBackupRuntime } from './cloudFolderBackup';

async function fixture() {
	const bytes = Buffer.alloc(8 * 1024 * 1024 + 17, 42),
		id = randomUUID();
	const fingerprint = await fingerprintSource({ size: bytes.length, check: () => {}, read: async (at, length) => bytes.slice(at, at + length) });
	const file = {
		id: 'a-file',
		revision: 'file-revision',
		name: 'saved.bin',
		folderId: 'root',
		trashed: false,
		content: { attachmentId: 'attachment-one', version: 'a'.repeat(64), size: bytes.length, fingerprint }
	};
	const root = { id: 'root', name: 'Selected', folderId: null, revision: 'root-revision' };
	const inventory = {
		version: 1,
		complete: true,
		rootId: 'root',
		rootRevision: root.revision,
		nodes: [
			{ kind: 'file', path: file.name, file },
			{ kind: 'folder', path: 'Empty', id: 'empty', folderId: 'root', revision: 'empty-revision' }
		]
	};
	const scope = { apiOrigin: 'https://cloud.test', ownerId: 'owner', dataPlane: 'home' };
	const state = {
		inventoryReads: 0,
		byteReads: [] as number[],
		unavailable: false,
		wrongVersion: false,
		wrongAccount: false,
		revokeAtAuth: Infinity,
		authReads: 0
	};
	const runtime: CloudBackupRuntime = {
		scope,
		currentScope: () => scope,
		requireCapability: async () => {},
		fetch: async (url, init) => {
			const u = new URL(String(url)),
				headers = new Headers(init?.headers);
			assert.equal(u.origin, scope.apiOrigin);
			assert.equal(init?.redirect, 'error');
			assert.equal(init?.cache, 'no-store');
			assert.equal(headers.get('X-Thingtime-Expected-Actor'), scope.ownerId);
			assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home');
			const json = (value: unknown) => Response.json({ ok: true, ...(value as object) });
			if (u.pathname === '/api/v1/auth/me') {
				state.authReads++;
				return state.authReads >= state.revokeAtAuth
					? new Response('', { status: 401 })
					: Response.json({ user: { id: state.wrongAccount ? 'other' : 'owner' } });
			}
			if (u.searchParams.has('folderId')) return json({ folder: root });
			if (u.searchParams.has('rootId')) {
				state.inventoryReads++;
				if (state.unavailable) throw Error('Live tree removed');
				return json({ inventory });
			}
			assert.equal(u.pathname, '/api/v1/attachments/content');
			assert.equal(u.searchParams.get('id'), file.content.attachmentId);
			assert.equal(u.searchParams.get('version'), file.content.version);
			const at = Number(u.searchParams.get('offset')),
				length = Number(u.searchParams.get('length'));
			assert.ok(length <= 2 * 1024 * 1024);
			state.byteReads.push(at);
			return new Response(bytes.slice(at, at + length), {
				status: 206,
				headers: {
					ETag: `"${state.wrongVersion ? 'b'.repeat(64) : file.content.version}"`,
					'Content-Range': `bytes ${at}-${at + length - 1}/${bytes.length}`,
					'Content-Length': String(length)
				}
			});
		}
	};
	const directory = await mkdtemp(join(tmpdir(), 'cloud-folder-backup-'));
	const store = await openLocalBackupStore(directory);
	return { id, file, root, inventory, scope, state, runtime, store, bytes, close: () => rm(directory, { recursive: true, force: true }) };
}

test('freezes the complete selected tree, keeps empty folders and resumes pinned bytes without rescanning the live tree', async () => {
	const f = await fixture();
	try {
		await prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime);
		const header = JSON.parse(new TextDecoder().decode((await f.store.read(`snapshots/${f.id}/header.json`, BACKUP_METADATA_BYTES))!));
		assert.equal(header.boundary.kind, 'capture-interval');
		assert.match(header.coverage.description, /ordinary Things.*not included/);
		let lost = true;
		await assert.rejects(
			resumeCloudFolderBackup(
				{
					...f.store,
					put: async (key, data) => {
						await f.store.put(key, data);
						if (lost && key.includes('/ranges/')) {
							lost = false;
							throw Error('Lost accepted page');
						}
					}
				},
				f.id,
				f.runtime
			),
			/Lost accepted page/
		);
		const reads = f.state.byteReads.length;
		f.state.unavailable = true;
		const result = await resumeCloudFolderBackup(f.store, f.id, f.runtime);
		assert.equal(result.seal.items, 3);
		assert.equal(result.copiedBytes, '0');
		assert.equal(f.state.inventoryReads, 1);
		assert.equal(f.state.byteReads.length, reads);
		const access = { scope: f.scope, authorize: async () => {} };
		const saved = await openBackupItem(f.store, f.id, f.file.id, access),
			chunks = [];
		for await (const chunk of saved.ranges) chunks.push(chunk);
		assert.deepEqual(Buffer.concat(chunks), f.bytes);
		const empty = await openBackupItem(f.store, f.id, 'empty', access);
		assert.equal(empty.item.content, null);
		assert.equal(empty.item.snapshot.adapter, CLOUD_BACKUP_FOLDER_ADAPTER);
		await assert.rejects(prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime), /already started/);
	} finally {
		await f.close();
	}
});

test('changed root, incomplete tree and changed account refuse before any plan publication', async () => {
	const f = await fixture();
	try {
		f.inventory.rootRevision = 'changed';
		await assert.rejects(prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime), /changed during inventory/);
		f.inventory.rootRevision = f.root.revision;
		f.inventory.complete = false;
		await assert.rejects(prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime), /incomplete/);
		f.inventory.complete = true;
		f.state.wrongAccount = true;
		await assert.rejects(prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime), /account changed/);
		assert.equal(await f.store.read(`snapshots/${f.id}/header.json`, BACKUP_METADATA_BYTES), null);
		assert.equal(f.state.byteReads.length, 0);
	} finally {
		await f.close();
	}
});

test('wrong version, scope switch, cancellation and revoked session cannot seal a backup', async () => {
	const f = await fixture();
	try {
		await prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime);
		f.state.wrongVersion = true;
		await assert.rejects(resumeCloudFolderBackup(f.store, f.id, f.runtime), /version changed/);
		f.state.wrongVersion = false;
		await assert.rejects(
			resumeCloudFolderBackup(f.store, f.id, { ...f.runtime, currentScope: () => ({ ...f.scope, ownerId: 'other' }) }),
			/account or origin changed/
		);
		await assert.rejects(resumeCloudFolderBackup(f.store, f.id, { ...f.runtime, signal: AbortSignal.abort(Error('Cancelled')) }), /Cancelled/);
		// Revoke exactly at final publication after bytes and verification succeed.
		f.state.revokeAtAuth = f.state.authReads + 3;
		await assert.rejects(resumeCloudFolderBackup(f.store, f.id, f.runtime), /401/);
		assert.equal(await f.store.read(`snapshots/${f.id}/complete.json`, BACKUP_METADATA_BYTES), null);
		f.state.revokeAtAuth = Infinity;
		const reads = f.state.byteReads.length;
		await resumeCloudFolderBackup(f.store, f.id, f.runtime);
		assert.equal(f.state.byteReads.length, reads);
	} finally {
		await f.close();
	}
});

test('cloud CLI rejects unsafe session files and never echoes malformed credential contents', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'cloud-backup-cli-'));
	try {
		const config = join(directory, 'session.json'),
			secret = 'private-session-value-must-never-appear';
		const run = async () => {
			try {
				await promisify(execFile)(
					process.execPath,
					['--import', 'tsx', 'scripts/backup-cloud.mts', 'resume', config, join(directory, 'vault'), randomUUID()],
					{ cwd: fileURLToPath(new URL('../../../../', import.meta.url)), maxBuffer: 1024 * 1024 }
				);
				assert.fail('Unsafe configuration was accepted');
			} catch (error: any) {
				assert.equal(error.code, 1);
				assert.equal((error.stdout + error.stderr).includes(secret), false);
				return error.stderr as string;
			}
		};
		await writeFile(config, '{"token":"' + secret, { mode: 0o600 });
		assert.match(await run(), /not valid JSON/);
		await writeFile(config, JSON.stringify({ origin: 'http://public.example', ownerId: 'owner', token: secret }));
		assert.match(await run(), /HTTPS or local loopback/);
		await chmod(config, 0o644);
		assert.match(await run(), /private owned session/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
