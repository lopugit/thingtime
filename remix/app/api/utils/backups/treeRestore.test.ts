import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile, lstat, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BACKUP_FORMAT, BACKUP_CHUNK_BYTES, type BackupItem } from '../../../backups/manifest';
import { fingerprintSource } from '../../../fileSync/contentFingerprint';
import { openLocalBackupStore } from './localBackupStore';
import { prepareBackup, captureBackup, sealBackup, type BackupObjectStore } from './portableBackup';
import { CLOUD_BACKUP_FOLDER_ADAPTER } from './cloudFolderBackup';
import { planBackupTree, treeRestoreReview } from './treeRestorePlan';
import { restoreBackupTree, canonicalRestoreDestination } from './localTreeRestore';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const scope = { apiOrigin: 'https://restore.test', ownerId: 'owner', dataPlane: 'home' };
const access = { scope, authorize: async () => {} };
const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
const exec = promisify(execFile);
async function fixture(change?: (items: BackupItem[]) => void) {
	const directory = await mkdtemp(join(tmpdir(), 'tree-restore-')),
		vault = join(directory, 'vault'),
		output = join(directory, 'recovery');
	const store = await openLocalBackupStore(vault),
		id = randomUUID();
	const big = Buffer.alloc(BACKUP_CHUNK_BYTES + 17, 31),
		small = Buffer.from('Another saved file');
	const sources = new Map([
		['a-file', big],
		['b-file', small]
	]);
	const folder = (id: string, name: string, parent: string | null): BackupItem => ({
		ordinal: 0,
		thingId: id,
		revision: 'v1',
		snapshot: { adapter: CLOUD_BACKUP_FOLDER_ADAPTER, version: 1, value: { id, revision: 'v1', name, folderId: parent } },
		content: null
	});
	const items: BackupItem[] = [];
	for (const [id, bytes] of sources) {
		const fingerprint = await fingerprintSource({
			size: bytes.length,
			check: () => {},
			read: async (offset, length) => bytes.slice(offset, offset + length)
		});
		const content = { attachmentId: 'attachment-' + id, version: 'a'.repeat(64), size: bytes.length, fingerprint };
		items.push({
			ordinal: items.length,
			thingId: id,
			revision: 'v1',
			snapshot: {
				adapter: 'file-content',
				version: 1,
				value: {
					id,
					revision: 'v1',
					name: id === 'a-file' ? 'Saved.bin' : 'Other.txt',
					folderId: id === 'a-file' ? 'folder' : 'root',
					trashed: false,
					content
				}
			},
			content: { size: content.size, fingerprint }
		});
	}
	items.push(folder('empty', 'Empty', 'root'), folder('folder', 'Nested', 'root'), folder('root', 'Original folder', 'external-parent'));
	items.forEach((item, ordinal) => (item.ordinal = ordinal));
	change?.(items);
	async function* entries() {
		yield* items;
	}
	const at = new Date().toISOString();
	await prepareBackup(
		store,
		{
			format: BACKUP_FORMAT,
			snapshotId: id,
			scope,
			boundary: { kind: 'point-in-time', token: 'frozen-test', startedAt: at, completedAt: at },
			coverage: { selectionId: 'root', description: 'Synthetic selected tree' }
		},
		entries(),
		access
	);
	await captureBackup(store, id, { read: async (item, at, length) => sources.get(item.thingId)!.slice(at, at + length) }, access);
	await sealBackup(store, id, access);
	sources.clear();
	const review = async (dest = output) => treeRestoreReview(await planBackupTree(store, id, access), await canonicalRestoreDestination(dest));
	return { directory, vault, store, output, id, big, small, items, review, close: () => rm(directory, { recursive: true, force: true }) };
}

test('restores a reviewed full tree; lost range acknowledgement resumes without reading accepted source chunks', async () => {
	const f = await fixture();
	try {
		const reviewed = await f.review();
		let lost = true;
		await assert.rejects(
			restoreBackupTree(f.store, f.id, f.output, reviewed, access, {
				progress: (value) => {
					if (value.kind === 'range' && lost) {
						lost = false;
						throw Error('Lost durable range acknowledgement');
					}
				}
			}),
			/Lost durable/
		);
		await assert.rejects(lstat(join(f.output, 'files/Nested/Saved.bin')), { code: 'ENOENT' });
		const firstChunk = 'chunks/' + sha(f.big.subarray(0, BACKUP_CHUNK_BYTES));
		await rm(join(f.vault, firstChunk));
		let sourceReads = 0,
			planReads = 0;
		const counted: BackupObjectStore = {
			...f.store,
			read: async (key, max) => {
				if (key.startsWith('chunks/')) {
					sourceReads++;
					assert.notEqual(key, firstChunk);
				}
				if (key.includes('/plan/')) planReads++;
				return f.store.read(key, max);
			}
		};
		const result = await restoreBackupTree(counted, f.id, f.output, reviewed, access, { resume: true });
		assert.equal(result.files, 2);
		assert.equal(result.reusedFiles, 0);
		assert.equal(sourceReads, 2);
		assert.ok(planReads <= 8, 'Manifest passes must be constant, not per file');
		assert.deepEqual(await readFile(join(result.directory, 'Nested/Saved.bin')), f.big);
		assert.deepEqual(await readFile(join(result.directory, 'Other.txt')), f.small);
		assert.equal((await lstat(join(result.directory, 'Empty'))).isDirectory(), true);
		const initial = await lstat(join(result.directory, 'Nested/Saved.bin'));
		const repeated = await restoreBackupTree(
			{
				...f.store,
				read: async (key, max) => {
					assert.equal(key.startsWith('chunks/'), false);
					return f.store.read(key, max);
				}
			},
			f.id,
			f.output,
			reviewed,
			access,
			{ resume: true }
		);
		assert.equal(repeated.reusedFiles, 2);
		assert.equal(repeated.restoredFiles, 0);
		const after = await lstat(join(result.directory, 'Nested/Saved.bin'));
		assert.equal(after.ino, initial.ino);
		assert.equal(after.mtimeMs, initial.mtimeMs);
	} finally {
		await f.close();
	}
});

test('real process exit leaves a recoverable range and dead lock; offline CLI reviews and resumes the tree', async () => {
	const f = await fixture();
	try {
		const preview = await exec(process.execPath, ['--import', 'tsx', 'scripts/backup-vault.mts', 'plan-tree', f.vault, f.id, f.output], { cwd });
		const plan = JSON.parse(preview.stdout);
		assert.equal(plan.entries.length, 5);
		await assert.rejects(lstat(f.output), { code: 'ENOENT' });
		const child = `
   import { openLocalBackupStore } from './app/api/utils/backups/localBackupStore.ts';
   import { restoreBackupTree } from './app/api/utils/backups/localTreeRestore.ts';
   const [vault, id, output, review] = process.argv.slice(1);
   const store = await openLocalBackupStore(vault, { create: false });
   await restoreBackupTree(store, id, output, review, { scope: ${JSON.stringify(scope)}, authorize: async () => {} },
    { progress: value => { if (value.kind === 'range') process.exit(91); } });
  `;
		await assert.rejects(
			exec(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', child, '--', f.vault, f.id, f.output, plan.review], { cwd }),
			(e: any) => e.code === 91
		);
		assert.equal((await readdir(join(f.output, 'locks'))).length, 1);
		const done = await exec(process.execPath, ['--import', 'tsx', 'scripts/backup-vault.mts', 'resume-tree', f.vault, f.id, f.output, plan.review], {
			cwd
		});
		assert.equal(JSON.parse(done.stdout).restored, true);
		assert.deepEqual(await readFile(join(f.output, 'files/Nested/Saved.bin')), f.big);
		const second = join(f.directory, 'second');
		const p = JSON.parse(
			(await exec(process.execPath, ['--import', 'tsx', 'scripts/backup-vault.mts', 'plan-tree', f.vault, f.id, second], { cwd })).stdout
		);
		const created = await exec(process.execPath, ['--import', 'tsx', 'scripts/backup-vault.mts', 'restore-tree', f.vault, f.id, second, p.review], {
			cwd
		});
		assert.equal(JSON.parse(created.stdout).files, 2);
	} finally {
		await f.close();
	}
});

test('review mismatch, existing destinations, corrupt staging and symlinks preserve user data', async () => {
	const f = await fixture();
	try {
		await assert.rejects(restoreBackupTree(f.store, f.id, f.output, '0'.repeat(64), access), /review it again/);
		await assert.rejects(lstat(f.output), { code: 'ENOENT' });
		const reviewed = await f.review(),
			abort = new AbortController();
		await assert.rejects(
			restoreBackupTree(
				f.store,
				f.id,
				f.output,
				reviewed,
				{ ...access, signal: abort.signal },
				{
					progress: (value) => {
						if (value.kind === 'range') {
							abort.abort(Error('Cancelled'));
							abort.signal.throwIfAborted();
						}
					}
				}
			),
			/Cancelled/
		);
		assert.equal((await readdir(join(f.output, 'locks'))).length, 0);
		const extra = join(f.output, 'files', 'user-data.txt');
		await writeFile(extra, 'keep me', { mode: 0o600 });
		await assert.rejects(restoreBackupTree(f.store, f.id, f.output, reviewed, access, { resume: true }), /unexpected entry/);
		await assert.rejects(restoreBackupTree(f.store, f.id, f.output, reviewed, access), { code: 'EEXIST' });
		assert.equal(await readFile(extra, 'utf8'), 'keep me');
		await rm(extra);
		const stage = join(f.output, 'staging/0.part');
		await writeFile(stage, 'damaged', { mode: 0o600 });
		await assert.rejects(restoreBackupTree(f.store, f.id, f.output, reviewed, access, { resume: true }), /incomplete|range changed/);
		assert.equal(await readFile(stage, 'utf8'), 'damaged');
		await rm(join(f.output, 'files/Empty'), { recursive: true });
		await symlink(f.directory, join(f.output, 'files/Empty'));
		await assert.rejects(restoreBackupTree(f.store, f.id, f.output, reviewed, access, { resume: true }), /unsafe entry/);
	} finally {
		await f.close();
	}
});

test('concurrent restore refuses; edits to an already restored file prevent overall completion', async () => {
	const f = await fixture();
	try {
		const reviewed = await f.review();
		let first = true;
		await assert.rejects(
			restoreBackupTree(f.store, f.id, f.output, reviewed, access, {
				progress: async (value) => {
					if (value.kind === 'range' && first) {
						first = false;
						await assert.rejects(restoreBackupTree(f.store, f.id, f.output, reviewed, access, { resume: true }), /Another restore process/);
					}
					if (value.kind === 'file' && value.path === 'Nested/Saved.bin')
						await writeFile(join(f.output, 'files/Nested/Saved.bin'), 'newer user edit');
				}
			}),
			/changed before completion/
		);
		assert.equal(await readFile(join(f.output, 'files/Nested/Saved.bin'), 'utf8'), 'newer user edit');
		await assert.rejects(lstat(join(f.output, 'state/snapshots', f.id, 'complete.json')), { code: 'ENOENT' });
		await assert.rejects(restoreBackupTree(f.store, f.id, f.output, reviewed, access, { resume: true }), /size changed/);
	} finally {
		await f.close();
	}
});

test('unsafe names, parent cycles and case aliases are refused before destination creation', async () => {
	const cases = [
		(items: BackupItem[]) => {
			(items[4].snapshot.value as any).folderId = 'folder';
		},
		(items: BackupItem[]) => {
			(items[3].snapshot.value as any).name = '../escape';
		},
		(items: BackupItem[]) => {
			(items[3].snapshot.value as any).folderId = 'folder';
		},
		(items: BackupItem[]) => {
			(items[2].snapshot.value as any).name = 'nested';
		},
		(items: BackupItem[]) => {
			(items[0].snapshot.value as any).folderId = 'missing';
		}
	];
	for (const change of cases) {
		const f = await fixture(change);
		try {
			await assert.rejects(planBackupTree(f.store, f.id, access));
			await assert.rejects(lstat(f.output), { code: 'ENOENT' });
		} finally {
			await f.close();
		}
	}
});

test('removing an empty folder during restore cannot produce a complete-tree receipt', async () => {
	const f = await fixture();
	try {
		let removed = false;
		await assert.rejects(
			restoreBackupTree(f.store, f.id, f.output, await f.review(), access, {
				progress: async (value) => {
					if (value.kind === 'file' && !removed) {
						removed = true;
						await rm(join(f.output, 'files/Empty'), { recursive: true });
					}
				}
			}),
			/tree is incomplete/
		);
		await assert.rejects(lstat(join(f.output, 'state/snapshots', f.id, 'complete.json')), { code: 'ENOENT' });
		const resumed = await restoreBackupTree(f.store, f.id, f.output, await f.review(), access, { resume: true });
		assert.equal(resumed.reusedFiles, 2);
		assert.equal((await lstat(join(f.output, 'files/Empty'))).isDirectory(), true);
	} finally {
		await f.close();
	}
});
