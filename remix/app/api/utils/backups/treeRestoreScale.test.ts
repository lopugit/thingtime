import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readdir, readFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BACKUP_FORMAT, backupJson, type BackupItem } from '../../../backups/manifest';
import { fingerprintSource } from '../../../fileSync/contentFingerprint';
import { openLocalBackupStore } from './localBackupStore';
import { prepareBackup, captureBackup, sealBackup } from './portableBackup';
import { CLOUD_BACKUP_FOLDER_ADAPTER } from './cloudBackupTree';
import { planBackupTree, treeRestoreReview } from './treeRestorePlan';
import { restoreBackupTree, canonicalRestoreDestination } from './localTreeRestore';

const scope = { apiOrigin: 'https://restore-scale.test', ownerId: 'owner', dataPlane: 'home' };
const access = { scope, authorize: async () => {} };
const exec = promisify(execFile), cwd = fileURLToPath(new URL('../../../../', import.meta.url));
async function fixture(folders: number, wide = false) {
	const directory = await mkdtemp(join(tmpdir(), 'tree-restore-scale-'));
	const vault = join(directory, 'vault'), scratch = join(directory, 'scratch'), output = join(directory, 'output');
	await mkdir(scratch, { mode: 0o700 });
	const store = await openLocalBackupStore(vault), id = randomUUID(), bytes = Buffer.from('Retained bytes from an unavailable source.');
	const fingerprint = await fingerprintSource({ size: bytes.length, check() {}, read: async (at, length) => bytes.subarray(at, at + length) });
	const content = { attachmentId: 'attachment', version: 'a'.repeat(64), size: bytes.length, fingerprint };
	const rootId = wide ? 'z-' + 'r'.repeat(180) : 'z-root', revision = wide ? 'v-' + 'r'.repeat(180) : 'v1';
	let metadataBytes = 0;
	async function* entries(): AsyncGenerator<BackupItem> {
		const file: BackupItem = { ordinal: 0, thingId: 'a-file', revision: 'v1', content: { size: bytes.length, fingerprint },
			snapshot: { adapter: 'file-content', version: 1,
				value: { id: 'a-file', revision: 'v1', folderId: rootId, name: 'Saved.txt', trashed: false, content } } };
		metadataBytes += Buffer.byteLength(backupJson(file)); yield file;
		for (let n = 0; n <= folders; n++) {
			const root = n === folders, suffix = String(n).padStart(6, '0');
			const thingId = root ? rootId : 'f-' + suffix + (wide ? '-' + 'i'.repeat(180) : '');
			const name = 'Folder-' + suffix + (wide ? '-' + 'n'.repeat(185) : '');
			const item: BackupItem = { ordinal: n + 1, thingId, revision, content: null,
				snapshot: { adapter: CLOUD_BACKUP_FOLDER_ADAPTER, version: 1,
					value: { id: thingId, revision, name, folderId: root ? null : rootId } } };
			metadataBytes += Buffer.byteLength(backupJson(item)); yield item;
		}
	}
	const at = '2026-10-19T00:00:00.000Z';
	try {
		await prepareBackup(store, { format: BACKUP_FORMAT, snapshotId: id, scope,
			boundary: { kind: 'point-in-time', token: 'fixture', startedAt: at, completedAt: at },
			coverage: { selectionId: rootId, description: 'Generated scale fixture, not hardware throughput evidence' } }, entries(), access);
		await captureBackup(store, id, { read: async (_item, at, length) => bytes.subarray(at, at + length) }, access);
		await sealBackup(store, id, access);
		return { directory, vault, scratch, output, store, id, bytes, metadataBytes,
			close: () => rm(directory, { recursive: true, force: true }) };
	} catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

test('restores more than 10,000 folders and resumes without source reads, preserving the legacy review hash', async () => {
	const f = await fixture(10_051);
	try {
		const plan = await planBackupTree(f.store, f.id, access, { temporaryDirectory: f.scratch });
		let review: string;
		try {
			const destination = await canonicalRestoreDestination(f.output);
			// The old v1 contract hashes metadata in ordinal order, with these exact
			// paths for this flat fixture. It is independent of the new path index.
			const legacy = createHash('sha256').update(backupJson({ format: 'thingtime-tree-restore-v1', destination, header: plan.header, seal: plan.seal }) + '\0');
			let ordinal = 0;
			for await (const row of plan.entries()) {
				const path = ordinal === 0 ? 'Saved.txt' : ordinal === 10_052 ? '' : 'Folder-' + String(ordinal - 1).padStart(6, '0');
				assert.equal(row.path, path); assert.equal(row.item.ordinal, ordinal++);
				legacy.update(backupJson({ path, kind: ordinal === 1 ? 'file' : 'folder', item: row.item }) + '\0');
			}
			assert.equal(ordinal, 10_053);
			review = await treeRestoreReview(plan, destination);
			assert.equal(review, legacy.digest('hex'));
		} finally { await plan.close(); }
		assert.deepEqual(await readdir(f.scratch), []);
		await assert.rejects(restoreBackupTree(f.store, f.id, f.output, review, access, {
			workspace: { temporaryDirectory: f.scratch }, progress(value) { if (value.kind === 'file') throw Error('Lost final acknowledgement'); }
		}), /Lost final acknowledgement/);
		assert.deepEqual(await readdir(f.scratch), []);
		const result = await restoreBackupTree({ ...f.store, read: async (key, max) => {
			assert.equal(key.startsWith('chunks/'), false, 'Already published file must be verified from its retained local bytes');
			return f.store.read(key, max);
		} }, f.id, f.output, review, access, { resume: true, workspace: { temporaryDirectory: f.scratch } });
		assert.equal(result.reusedFiles, 1); assert.equal(result.restoredFiles, 0);
		assert.deepEqual(await readFile(join(result.directory, 'Saved.txt')), f.bytes);
		assert.equal((await readdir(result.directory)).length, 10_052);
		assert.equal((await lstat(join(result.directory, 'Folder-010050'))).isDirectory(), true);
		assert.deepEqual(await readdir(f.scratch), []);
	} finally { await f.close(); }
});

test('CLI reviews over 32 MiB of real metadata with a 64 MiB V8 heap and streams every entry', async (t) => {
	const f = await fixture(32_000, true);
	try {
		assert.ok(f.metadataBytes > 32 * 1024 ** 2, String(f.metadataBytes));
		const result = await exec(process.execPath, ['--max-old-space-size=64', '--import', 'tsx',
			'scripts/backup-vault.mts', 'plan-tree', f.vault, f.id, f.output], {
			cwd, timeout: 120_000, maxBuffer: 20 * 1024 ** 2,
			env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: f.scratch }
		});
		const proof = JSON.parse(result.stdout); assert.equal(proof.entries.length, 32_002); assert.match(proof.review, /^[a-f0-9]{64}$/);
		assert.equal(proof.entries[0].path, 'Saved.txt'); assert.equal(proof.entries.at(-1).path, '');
		assert.equal(proof.destination, await canonicalRestoreDestination(f.output));
		// tsx may keep its own compiler cache in TMPDIR; only the product's
		// private backup workspaces belong to this cleanup assertion.
		assert.deepEqual((await readdir(f.scratch)).filter(name => name.startsWith('thingtime-backup-tree-')), []);
		t.diagnostic(JSON.stringify({ items: proof.entries.length, metadataBytes: f.metadataBytes, v8HeapLimitMiB: 64, reviewOutputBytes: Buffer.byteLength(result.stdout) }));
	} finally { await f.close(); }
});

test('disk exhaustion, cancellation and closed-plan access clean scratch without touching a destination', async () => {
	const f = await fixture(256, true);
	try {
		await assert.rejects(planBackupTree(f.store, f.id, access, { maxBytes: 65536, temporaryDirectory: f.scratch }), /full/);
		assert.deepEqual(await readdir(f.scratch), []);
		const abort = new AbortController();
		await assert.rejects(planBackupTree(f.store, f.id, { scope, signal: abort.signal, authorize: async () => {
			if ((await readdir(f.scratch)).length) { abort.abort(Error('Cancelled preparation')); abort.signal.throwIfAborted(); }
		} }, { temporaryDirectory: f.scratch }), /Cancelled preparation/);
		assert.deepEqual(await readdir(f.scratch), []);
		const plan = await planBackupTree(f.store, f.id, access, { temporaryDirectory: f.scratch });
		await plan.close(); await plan.close();
		await assert.rejects(treeRestoreReview(plan, f.output), /closed/);
		await assert.rejects(lstat(f.output), { code: 'ENOENT' });
	} finally { await f.close(); }
});
