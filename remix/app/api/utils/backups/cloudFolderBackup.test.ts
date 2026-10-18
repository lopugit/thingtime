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
import { openBackupItem, openSealedBackup } from './portableBackup';
import { CLOUD_INVENTORY_PAGE_ENTRIES } from '../../../fileSync/cloudInventoryPages';
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
		authReads: 0,
		required: [] as [string, string][],
		stream: undefined as (() => ReadableStream<Uint8Array>) | undefined
	};
	const runtime: CloudBackupRuntime = {
		scope,
		currentScope: () => scope,
		requireCapability: async (feature, version) => { state.required.push([feature, version]); },
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
				assert.equal(u.searchParams.get('pages'), '1');
				const stream = state.stream?.() ?? new ReadableStream<Uint8Array>({ start(controller) {
					controller.enqueue(Buffer.from(JSON.stringify({ version: 1, generation: 'frozen-generation', ordinal: 0,
						rootId: inventory.rootId, rootRevision: inventory.rootRevision, nodes: inventory.nodes,
						...(inventory.complete ? { totalEntries: inventory.nodes.length } : {}) }) + '\n'));
					controller.close();
				} });
				return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
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
		await assert.rejects(prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime), /interrupted before completion/);
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

test('paged capture exceeds the legacy 10,000-item limit without an array inventory and preserves exact-byte recovery', async () => {
	const f = await fixture(), total = 10_051;
	let emitted = 0, largestPage = 0;
	f.state.stream = () => new ReadableStream<Uint8Array>({
		pull(controller) {
			if (emitted === total) { controller.close(); return; }
			const ordinal = Math.floor(emitted / CLOUD_INVENTORY_PAGE_ENTRIES), nodes = [];
			while (emitted < total && nodes.length < CLOUD_INVENTORY_PAGE_ENTRIES) {
				const i = emitted++;
				nodes.push(i === 0 ? { kind: 'file', path: f.file.name, file: f.file }
					: { kind: 'folder', path: 'Folder ' + i, id: 'z-' + String(total - i).padStart(5, '0'), folderId: 'root', revision: 'r1' });
			}
			largestPage = Math.max(largestPage, nodes.length);
			controller.enqueue(Buffer.from(JSON.stringify({ version: 1, generation: 'large-capture', rootId: 'root',
				rootRevision: f.root.revision, ordinal, nodes, ...(emitted === total ? { totalEntries: total } : {}) }) + '\n'));
		}
	});
	try {
		const plan = await prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime);
		assert.equal(plan.items, total + 1); assert.equal(plan.bytes, String(f.bytes.length));
		assert.equal(largestPage, 128); assert.ok(f.state.required.some(([feature, version]) => feature === 'api.files' && version === '1.5.0'));
		// The durable format and byte-resume contract do not require the new
		// producer after freezing; old compatible origins can recover saved plans.
		f.state.unavailable = true;
		f.runtime.requireCapability = async (feature, minimum) => {
			if (feature === 'api.files') assert.equal(minimum, '1.2.0');
		};
		await resumeCloudFolderBackup(f.store, f.id, f.runtime);
		const access = { scope: f.scope, authorize: async () => {} };
		const backup = await openSealedBackup(f.store, f.id, access);
		let count = 0, last = '';
		for await (const { item } of backup.entries) {
			assert.equal(item.ordinal, count++); assert.ok(item.thingId > last); last = item.thingId;
		}
		assert.equal(count, total + 1); assert.equal(f.state.inventoryReads, 1);
		const original = await openBackupItem(f.store, f.id, f.file.id, access), chunks = [];
		for await (const chunk of original.ranges) chunks.push(chunk);
		assert.deepEqual(Buffer.concat(chunks), f.bytes);
	} finally { await f.close(); }
});

test('cross-page collisions, changed ancestry and trailing stream failure never publish a backup header', async () => {
	for (const failure of ['duplicate-id', 'path-alias', 'wrong-parent', 'trailing-error']) {
		const f = await fixture();
		f.state.stream = () => new ReadableStream<Uint8Array>({ start(controller) {
			const first = { kind: 'folder', path: 'Café', id: 'folder', folderId: 'root', revision: 'r1' };
			const second = { kind: 'folder', path: 'Other', id: 'second', folderId: 'root', revision: 'r1' };
			if (failure === 'duplicate-id') second.id = first.id;
			if (failure === 'path-alias') second.path = 'CAFE\u0301';
			if (failure === 'wrong-parent') second.folderId = 'missing';
			for (const [ordinal, node] of [first, second].entries()) controller.enqueue(Buffer.from(JSON.stringify({
				version: 1, generation: 'failed-capture', rootId: 'root', rootRevision: f.root.revision, ordinal,
				nodes: [node], ...(ordinal === 1 ? { totalEntries: 2 } : {}) }) + '\n'));
			if (failure === 'trailing-error') controller.enqueue(Buffer.from('{"error":"source snapshot expired"}\n'));
			controller.close();
		} });
		try {
			await assert.rejects(prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime));
			assert.equal(await f.store.read(`snapshots/${f.id}/header.json`, BACKUP_METADATA_BYTES), null);
			assert.equal(f.state.byteReads.length, 0);
		} finally { await f.close(); }
	}
});

test('older origins refuse new paged captures without falling back to a smaller inventory', async () => {
	const f = await fixture();
	f.runtime.requireCapability = async (feature, minimum) => {
		if (feature === 'api.files' && minimum === '1.5.0') throw Error('Paged inventory capability unavailable');
	};
	try {
		await assert.rejects(prepareCloudFolderBackup(f.store, f.id, 'root', f.runtime), /capability unavailable/);
		assert.equal(f.state.inventoryReads, 0);
		assert.equal(await f.store.read(`snapshots/${f.id}/header.json`, BACKUP_METADATA_BYTES), null);
	} finally { await f.close(); }
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
