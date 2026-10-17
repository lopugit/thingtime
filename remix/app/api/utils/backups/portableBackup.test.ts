import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, stat, symlink, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fingerprintSource, contentPartPlan } from '../../../fileSync/contentFingerprint';
import { parseTimelineEvent } from '../../../timeline/contract';
import {
	BACKUP_FORMAT,
	BACKUP_CHUNK_BYTES,
	BACKUP_PAGE_BYTES,
	backupTimelineSnapshot,
	backupJson,
	parseBackupHeader,
	parseBackupItem,
	type BackupHeader,
	type BackupItem
} from '../../../backups/manifest';
import { openLocalBackupStore } from './localBackupStore';
import {
	prepareBackup,
	captureBackup,
	sealBackup,
	verifySealedBackup,
	copySealedBackup,
	openBackupItem,
	type BackupObjectStore
} from './portableBackup';
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const scope = { apiOrigin: 'https://backup.test', ownerId: 'owner', dataPlane: 'home' };
const access = { scope, authorize: async () => {} };
const header = (): BackupHeader => ({
	format: BACKUP_FORMAT,
	snapshotId: randomUUID(),
	scope,
	boundary: {
		kind: 'point-in-time',
		token: 'fixture-frozen-inventory',
		startedAt: '2026-10-17T00:00:00.000Z',
		completedAt: '2026-10-17T00:00:00.000Z'
	},
	coverage: { selectionId: 'selected-root', description: 'Disposable explicitly frozen fixture, not an account inventory' }
});
async function* values(items: BackupItem[]) {
	yield* items;
}
async function fixture(root: string, size = BACKUP_CHUNK_BYTES + 17) {
	const h = header(),
		original = join(root, 'original.bin'),
		bytes = Buffer.alloc(size);
	for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + Math.floor(i / BACKUP_CHUNK_BYTES)) % 251;
	await writeFile(original, bytes, { mode: 0o600 });
	const fingerprint = await fingerprintSource({ size, check: () => {}, read: async (offset, length) => bytes.slice(offset, offset + length) });
	const items: BackupItem[] = [
		{
			ordinal: 0,
			thingId: 'a-empty',
			revision: 'v1',
			snapshot: { adapter: 'fixture-file', version: 1, value: { name: 'empty' } },
			content: { size: 0, fingerprint: null }
		},
		{
			ordinal: 1,
			thingId: 'b-file',
			revision: 'v1',
			snapshot: { adapter: 'fixture-file', version: 1, value: { name: '../../never-a-restore-path', folderId: 'old-folder' } },
			content: { size, fingerprint }
		},
		{ ordinal: 2, thingId: 'c-folder', revision: 'v1', snapshot: { adapter: 'fixture-folder', version: 1, value: { name: 'Folder' } }, content: null }
	];
	const store = await openLocalBackupStore(join(root, 'vault'));
	await prepareBackup(store, h, values(items), access);
	const reads: number[] = [];
	const source = {
		read: async (_item: BackupItem, offset: number, length: number, _signal?: AbortSignal) => {
			reads.push(length);
			const handle = await open(original, 'r');
			try {
				const data = Buffer.alloc(length);
				const result = await handle.read(data, 0, length, offset);
				assert.equal(result.bytesRead, length);
				return data;
			} finally {
				await handle.close();
			}
		}
	};
	return { h, items, bytes, original, store, source, reads };
}
const noSource = {
	read: async (): Promise<Uint8Array> => {
		throw Error('Original source no longer exists');
	}
};
async function collect(store: BackupObjectStore, id: string, thingId = 'b-file') {
	const file = await openBackupItem(store, id, thingId, access),
		chunks: Uint8Array[] = [];
	for await (const chunk of file.ranges) chunks.push(chunk);
	return { item: file.item, bytes: Buffer.concat(chunks) };
}

test('real disk backup resumes bounded ranges and restores after original removal, then survives loss of the first vault', async () => {
	const root = await mkdtemp(join(tmpdir(), 'thingtime-backup-'));
	try {
		const f = await fixture(root);
		let lost = true;
		const interrupted: BackupObjectStore = {
			...f.store,
			put: async (key, data) => {
				await f.store.put(key, data);
				if (key.includes('/ranges/') && lost) {
					lost = false;
					throw Error('Accepted range-page reply lost');
				}
			}
		};
		await assert.rejects(captureBackup(interrupted, f.h.snapshotId, f.source, access, { rangePageItems: 1 }), /reply lost/);
		assert.deepEqual(f.reads, [BACKUP_CHUNK_BYTES]);
		assert.equal(await f.store.read(`snapshots/${f.h.snapshotId}/complete.json`, 4096), null);
		const reopened = await openLocalBackupStore(join(root, 'vault'));
		const resumed = await captureBackup(reopened, f.h.snapshotId, f.source, access, { rangePageItems: 1 });
		assert.deepEqual(resumed, { copiedBytes: '17', reusedBytes: String(BACKUP_CHUNK_BYTES) });
		assert.deepEqual(f.reads, [BACKUP_CHUNK_BYTES, 17]);
		const seal = await sealBackup(reopened, f.h.snapshotId, access);
		assert.equal(seal.items, 3);
		assert.equal(seal.bytes, String(f.bytes.length));
		assert.equal(seal.chunks, '2');
		await rm(f.original);
		assert.deepEqual(await captureBackup(reopened, f.h.snapshotId, noSource, access), { copiedBytes: '0', reusedBytes: String(f.bytes.length) });
		assert.equal(hash((await collect(reopened, f.h.snapshotId)).bytes), hash(f.bytes));
		assert.equal((await collect(reopened, f.h.snapshotId, 'a-empty')).bytes.length, 0);
		const second = await openLocalBackupStore(join(root, 'export'));
		let exportSourceBytes = 0;
		const countedSource: BackupObjectStore = {
			...reopened,
			read: async (key, max) => {
				const data = await reopened.read(key, max);
				if (key.startsWith('chunks/')) exportSourceBytes += data?.byteLength ?? 0;
				return data;
			}
		};
		let loseCopy = true;
		await assert.rejects(
			copySealedBackup(
				countedSource,
				{
					...second,
					put: async (key, data) => {
						await second.put(key, data);
						if (key.startsWith('chunks/') && loseCopy) {
							loseCopy = false;
							throw Error('Copy connection lost');
						}
					}
				},
				f.h.snapshotId,
				access
			),
			/connection lost/
		);
		assert.equal(await second.read(`snapshots/${f.h.snapshotId}/complete.json`, 4096), null);
		const copied = await copySealedBackup(countedSource, second, f.h.snapshotId, access);
		assert.equal(exportSourceBytes, f.bytes.length);
		await copySealedBackup(countedSource, second, f.h.snapshotId, access);
		assert.equal(exportSourceBytes, f.bytes.length);
		assert.equal(copied.reusedBytes, String(BACKUP_CHUNK_BYTES));
		assert.equal(copied.copiedBytes, '17');
		assert.deepEqual(copied.seal, seal);
		await rm(join(root, 'vault'), { recursive: true });
		const exported = await openLocalBackupStore(join(root, 'export'));
		assert.deepEqual(await verifySealedBackup(exported, f.h.snapshotId, access), seal);
		const restored = await collect(exported, f.h.snapshotId);
		assert.equal(hash(restored.bytes), hash(f.bytes));
		assert.deepEqual(restored.item.snapshot, f.items[1].snapshot);
		const event = parseTimelineEvent({
			formatVersion: 1,
			id: 'backup-test-event',
			ownerId: scope.ownerId,
			thingId: f.h.snapshotId,
			branchId: 'main',
			parentIds: [],
			operationId: 'backup-test-op',
			actorId: scope.ownerId,
			source: 'api',
			clientId: null,
			occurredAt: '2026-10-17T00:00:00.000Z',
			mode: 'effect',
			operation: 'effect',
			label: 'Backup captured',
			before: null,
			after: backupTimelineSnapshot(seal),
			dependencies: []
		});
		assert.equal(event.after!.adapter, 'backup-snapshot');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('accepted capture receipt recovers after immediate source loss; corrupt retained bytes and incomplete capture never seal', async () => {
	const root = await mkdtemp(join(tmpdir(), 'thingtime-backup-'));
	try {
		const f = await fixture(root, 31);
		let lost = true;
		await assert.rejects(
			captureBackup(
				{
					...f.store,
					put: async (key, data) => {
						await f.store.put(key, data);
						if (key.includes('/ranges/') && lost) {
							lost = false;
							throw Error('Lost reply');
						}
					}
				},
				f.h.snapshotId,
				f.source,
				access
			),
			/Lost reply/
		);
		await rm(f.original);
		const reopened = await openLocalBackupStore(join(root, 'vault'));
		assert.deepEqual(await captureBackup(reopened, f.h.snapshotId, noSource, access), { copiedBytes: '0', reusedBytes: '31' });
		await sealBackup(reopened, f.h.snapshotId, access);
		await writeFile(join(root, 'vault', 'chunks', hash(f.bytes)), Buffer.alloc(31, 99));
		await assert.rejects(verifySealedBackup(reopened, f.h.snapshotId, access), /corrupt/);
		await assert.rejects(collect(reopened, f.h.snapshotId), /corrupt/);
		const empty = await openLocalBackupStore(join(root, 'incomplete'));
		await prepareBackup(empty, f.h, values(f.items), access);
		await assert.rejects(sealBackup(empty, f.h.snapshotId, access), /Invalid backup fields/);
		assert.equal(await empty.read(`snapshots/${f.h.snapshotId}/complete.json`, 4096), null);
		await captureBackup(empty, f.h.snapshotId, { read: async (_item, _offset, length) => new Uint8Array(length).fill(42) }, access);
		await assert.rejects(sealBackup(empty, f.h.snapshotId, access), /pinned source fingerprint/);
		assert.equal(await empty.read(`snapshots/${f.h.snapshotId}/complete.json`, 4096), null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('wrong account, cancellation and revoked access stop disclosure; changed plans cannot replace saved metadata', async () => {
	const root = await mkdtemp(join(tmpdir(), 'thingtime-backup-'));
	try {
		const f = await fixture(root, 7),
			abort = new AbortController();
		abort.abort(Error('Cancelled'));
		await assert.rejects(captureBackup(f.store, f.h.snapshotId, f.source, { ...access, signal: abort.signal }), /Cancelled/);
		await assert.rejects(captureBackup(f.store, f.h.snapshotId, f.source, { ...access, scope: { ...scope, ownerId: 'other' } }), /account/);
		await assert.rejects(
			captureBackup(f.store, f.h.snapshotId, f.source, {
				...access,
				authorize: async () => {
					throw Error('Revoked');
				}
			}),
			/Revoked/
		);
		assert.deepEqual(f.reads, []);
		await assert.rejects(
			prepareBackup(f.store, { ...f.h, coverage: { ...f.h.coverage, description: 'Changed' } }, values(f.items), access),
			/Immutable/
		);
		await assert.rejects(prepareBackup(f.store, f.h, values([...f.items].reverse()), access), /unordered/);
		let valid = true;
		await assert.rejects(
			captureBackup(
				f.store,
				f.h.snapshotId,
				{
					read: async (...args) => {
						const bytes = await f.source.read(...args);
						valid = false;
						return bytes;
					}
				},
				{
					...access,
					authorize: async () => {
						if (!valid) throw Error('Revoked during read');
					}
				}
			),
			/Revoked during read/
		);
		assert.equal(await f.store.read(`chunks/${hash(f.bytes)}`, BACKUP_CHUNK_BYTES), null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('metadata inventories represent 100 TB and beyond safe-integer totals with bounded pages and no byte allocation', async () => {
	const records = new Map<string, Uint8Array>();
	let largest = 0;
	const store: BackupObjectStore = {
		read: async (key) => records.get(key) ?? null,
		put: async (key, data) => {
			largest = Math.max(largest, data.byteLength);
			records.set(key, data.slice());
		}
	};
	const h = header(),
		size = 500_000_000_000,
		count = 20_000;
	async function* items() {
		for (let ordinal = 0; ordinal < count; ordinal++)
			yield {
				ordinal,
				thingId: 'file-' + String(ordinal).padStart(6, '0'),
				revision: 'v1',
				snapshot: { adapter: 'file-content', version: 1, value: {} },
				content: { size, fingerprint: { algorithm: 'sha256-parts-v1' as const, ...contentPartPlan(size), sha256: 'a'.repeat(64) } }
			};
	}
	const plan = await prepareBackup(store, h, items(), access);
	assert.equal(plan.bytes, '10000000000000000');
	assert.ok(BigInt(plan.bytes) > BigInt(Number.MAX_SAFE_INTEGER));
	assert.equal(plan.pages, Math.ceil(count / 128));
	assert.ok(largest < BACKUP_PAGE_BYTES);
	assert.equal(
		[...records.keys()].some((key) => key.startsWith('chunks/')),
		false
	);
	const smaller = header();
	async function* hundredTB() {
		let ordinal = 0;
		for await (const item of items()) {
			if (ordinal++ === 200) break;
			yield item;
		}
	}
	assert.equal((await prepareBackup(store, smaller, hundredTB(), access)).bytes, '100000000000000');
	// This is a metadata/counter proof, not a 100 TB byte-transfer claim.
});

test('strict metadata, storage paths, symlinks and concurrent immutable publication reject unsafe replacements', async () => {
	const root = await mkdtemp(join(tmpdir(), 'thingtime-backup-'));
	try {
		const f = await fixture(root, 3),
			key = 'chunks/' + 'a'.repeat(64);
		assert.throws(() => parseBackupHeader({ ...f.h, secret: 'no extra fields' }), /fields/);
		assert.throws(() => parseBackupHeader({ ...f.h, boundary: { ...f.h.boundary, completedAt: '2026-10-18T00:00:00.000Z' } }), /header/);
		assert.throws(
			() =>
				parseBackupItem({
					...f.items[1],
					snapshot: {
						adapter: 'file',
						version: 1,
						get value() {
							throw Error('getter executed');
						}
					}
				}),
			/accessors/
		);
		await assert.rejects(f.store.put('../escape', new Uint8Array([1])), /key/);
		const results = await Promise.allSettled([f.store.put(key, new Uint8Array([1])), f.store.put(key, new Uint8Array([2]))]);
		assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
		const winner = await f.store.read(key, 1);
		assert.ok(winner);
		await f.store.put(key, winner);
		assert.equal((await stat(join(root, 'vault', key))).mode & 0o777, 0o600);
		await symlink(f.original, join(root, 'vault', 'chunks', 'b'.repeat(64)));
		await assert.rejects(f.store.read('chunks/' + 'b'.repeat(64), BACKUP_CHUNK_BYTES));
		assert.equal((await readFile(f.original)).length, 3);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('offline CLI verifies, resumes a portable copy and restores exact bytes without overwriting an existing file', async () => {
	const { execFile } = await import('node:child_process'),
		{ promisify } = await import('node:util'),
		{ fileURLToPath } = await import('node:url');
	const run = promisify(execFile),
		cli = fileURLToPath(new URL('../../../../scripts/backup-vault.mts', import.meta.url));
	const root = await mkdtemp(join(tmpdir(), 'thingtime-backup-cli-'));
	try {
		const f = await fixture(root, BACKUP_CHUNK_BYTES + 37);
		await captureBackup(f.store, f.h.snapshotId, f.source, access);
		await sealBackup(f.store, f.h.snapshotId, access);
		await rm(f.original);
		const command = (args: string[]) => run(process.execPath, ['--import', 'tsx', cli, ...args]);
		const verified = JSON.parse((await command(['verify', join(root, 'vault'), f.h.snapshotId])).stdout);
		assert.equal(verified.verified, true);
		const copied = JSON.parse((await command(['copy', join(root, 'vault'), f.h.snapshotId, join(root, 'copied')])).stdout);
		assert.equal(copied.copiedBytes, String(f.bytes.length));
		const repeated = JSON.parse((await command(['copy', join(root, 'vault'), f.h.snapshotId, join(root, 'copied')])).stdout);
		assert.equal(repeated.copiedBytes, '0');
		await rm(join(root, 'vault'), { recursive: true });
		const destination = join(root, 'chosen-restored.bin');
		await command(['restore-file', join(root, 'copied'), f.h.snapshotId, destination, 'b-file']);
		assert.equal(hash(await readFile(destination)), hash(f.bytes));
		await assert.rejects(command(['restore-file', join(root, 'copied'), f.h.snapshotId, destination, 'b-file']), /EEXIST/);
		assert.equal(hash(await readFile(destination)), hash(f.bytes));
		await command(['restore-file', join(root, 'copied'), f.h.snapshotId, join(root, 'empty.bin'), 'a-empty']);
		assert.equal((await stat(join(root, 'empty.bin'))).size, 0);
		await assert.rejects(command(['verify', join(root, 'missing'), f.h.snapshotId]));
		await assert.rejects(stat(join(root, 'missing')), /ENOENT/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('missing/reordered manifests and overlapping ranges fail verification; revoked export yields no bytes', async () => {
	const root = await mkdtemp(join(tmpdir(), 'thingtime-backup-integrity-'));
	try {
		const f = await fixture(root, 23);
		await captureBackup(f.store, f.h.snapshotId, f.source, access);
		await sealBackup(f.store, f.h.snapshotId, access);
		const tampered = (change: (key: string, value: any) => any): BackupObjectStore => ({
			...f.store,
			read: async (key, max) => {
				const bytes = await f.store.read(key, max);
				if (!bytes || !key.endsWith('.json')) return bytes;
				const value = change(key, JSON.parse(new TextDecoder().decode(bytes)));
				return value === null ? null : new TextEncoder().encode(backupJson(value));
			}
		});
		await assert.rejects(
			verifySealedBackup(
				tampered((key, value) => (key.includes('/plan/') ? null : value)),
				f.h.snapshotId,
				access
			)
		);
		await assert.rejects(
			verifySealedBackup(
				tampered((key, value) => (key.includes('/plan/') ? { ...value, ordinal: 1 } : value)),
				f.h.snapshotId,
				access
			),
			/sequence/
		);
		await assert.rejects(
			verifySealedBackup(
				tampered((key, value) => (key.includes('/ranges/') ? { ...value, ranges: [{ ...value.ranges[0], offset: 1 }] } : value)),
				f.h.snapshotId,
				access
			),
			/gap, overlap/
		);
		await assert.rejects(
			verifySealedBackup(
				tampered((key, value) => (key.endsWith('/complete.json') ? { ...value, bytes: '999' } : value)),
				f.h.snapshotId,
				access
			),
			/completion seal/
		);
		let valid = true,
			yielded = 0;
		const entry = await openBackupItem(
			{
				...f.store,
				read: async (key, max) => {
					const bytes = await f.store.read(key, max);
					if (key.startsWith('chunks/')) valid = false;
					return bytes;
				}
			},
			f.h.snapshotId,
			'b-file',
			{
				...access,
				authorize: async () => {
					if (!valid) throw Error('Export access revoked');
				}
			}
		);
		await assert.rejects(async () => {
			for await (const _bytes of entry.ranges) yielded++;
		}, /Export access revoked/);
		assert.equal(yielded, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
