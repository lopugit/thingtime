import { parentPort, workerData } from 'node:worker_threads';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { openLocalBackupStore } from '../../remix/app/api/utils/backups/localBackupStore';
import { copySealedBackup, type BackupObjectStore } from '../../remix/app/api/utils/backups/portableBackup';
import { BACKUP_METADATA_BYTES, backupDigest, backupId, backupJson, parseBackupSeal } from '../../remix/app/backups/manifest';
import { timelineScopeKey, type TimelineScope } from '../../remix/app/timeline/contract';

// This adapter has no network or credential interface. The parent retains
// account/session authority; the shared engine retains the portable format.
const port = parentPort;
if (!port) throw Error('Backup worker requires a parent');
const abort = new AbortController();
let sequence = 0;
let pending: { id: number; finish(allowed: boolean): void } | undefined;
port.on('message', (message: unknown) => {
	if (!message || typeof message !== 'object') return;
	const m = message as Record<string, unknown>;
	if (m.type === 'cancel') { abort.abort(); pending?.finish(false); }
	if (m.type === 'authorization' && m.id === pending?.id && typeof m.allowed === 'boolean') pending?.finish(m.allowed);
});
port.on('close', () => { abort.abort(); pending?.finish(false); });
const exact = (v: any, keys: string[]) => {
	if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw Error('Invalid worker input');
};
type Identity = { dev: string; ino: string };
async function identity(directory: string, expected: Identity) {
	abort.signal.throwIfAborted();
	const info = await lstat(directory, { bigint: true });
	if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077n) !== 0n ||
		(process.getuid && info.uid !== BigInt(process.getuid())) || info.dev.toString() !== expected.dev || info.ino.toString() !== expected.ino ||
		await realpath(directory) !== directory) throw Error('Backup directory changed');
}
async function run() {
	const data = workerData;
	exact(data, ['protocol', 'jobId', 'sourceDirectory', 'destinationDirectory', 'snapshotId', 'scope', 'sourceIdentity', 'destinationIdentity', 'manifestHash']);
	if (data.protocol !== 1 || !backupId(data.jobId) || !backupId(data.snapshotId) || !backupDigest(data.manifestHash)) throw Error('Invalid worker identity');
	for (const key of ['sourceDirectory', 'destinationDirectory']) {
		const path = data[key];
		if (typeof path !== 'string' || path.length > 32768 || path.includes('\0') || !isAbsolute(path) || resolve(path) !== path) throw Error('Invalid worker path');
	}
	const { sourceDirectory, destinationDirectory } = data;
	if (sourceDirectory === destinationDirectory || sourceDirectory.startsWith(destinationDirectory + sep) || destinationDirectory.startsWith(sourceDirectory + sep)) throw Error('Backup stores must be independent');
	for (const value of [data.sourceIdentity, data.destinationIdentity]) {
		exact(value, ['dev', 'ino']);
		if (![value.dev, value.ino].every(v => typeof v === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(v))) throw Error('Invalid directory identity');
	}
	exact(data.scope, ['apiOrigin', 'ownerId', 'dataPlane']);
	const scope = data.scope as TimelineScope;
	timelineScopeKey(scope);
	if (scope.dataPlane !== 'home') throw Error('Invalid data plane');
	const checkDirectories = async () => {
		await identity(sourceDirectory, data.sourceIdentity);
		await identity(destinationDirectory, data.destinationIdentity);
	};
	const authorize = async () => {
		abort.signal.throwIfAborted();
		await checkDirectories();
		abort.signal.throwIfAborted();
		if (pending) throw Error('Concurrent authorization');
		const allowed = await new Promise<boolean>(resolveAuthorization => {
			const id = ++sequence;
			const timer = setTimeout(() => { abort.abort(); pending?.finish(false); }, 30_000);
			pending = { id, finish(value) { clearTimeout(timer); pending = undefined; resolveAuthorization(value); } };
			port!.postMessage({ type: 'authorize', id });
		});
		if (!allowed) { abort.abort(); throw Error('Authorization interrupted'); }
		abort.signal.throwIfAborted();
		await checkDirectories();
	};
	await authorize();
	const source = await openLocalBackupStore(sourceDirectory, { create: false });
	const destination = await openLocalBackupStore(destinationDirectory, { create: false });
	const guard = (store: BackupObjectStore): BackupObjectStore => ({
		async read(key, bound) { await checkDirectories(); const bytes = await store.read(key, bound); await checkDirectories(); return bytes; },
		async put(key, bytes) {
			await checkDirectories();
			if (key === `snapshots/${data.snapshotId}/complete.json`) {
				const seal = parseBackupSeal(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
				if (seal.manifestHash !== data.manifestHash) throw Error('Copied manifest changed');
			}
			await store.put(key, bytes);
			await checkDirectories();
		}
	});
	const guardedSource = guard(source);
	const bytes = await guardedSource.read(`snapshots/${data.snapshotId}/complete.json`, BACKUP_METADATA_BYTES);
	if (!bytes) throw Error('Missing source seal');
	const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const seal = parseBackupSeal(JSON.parse(text));
	if (backupJson(seal) !== text || seal.snapshotId !== data.snapshotId || seal.manifestHash !== data.manifestHash) throw Error('Source seal changed');
	const result = await copySealedBackup(guardedSource, guard(destination), data.snapshotId, { scope, authorize, signal: abort.signal }, {
		async onProgress(progress) {
			if (progress.phase === 'complete') return; // Publish completion only after checking the pinned seal.
			port!.postMessage({ type: 'progress', progress });
		}
	});
	await authorize();
	if (result.seal.manifestHash !== data.manifestHash) throw Error('Copied manifest changed');
	const completed = { snapshotId: data.snapshotId, manifestHash: result.seal.manifestHash, copiedBytes: result.copiedBytes, reusedBytes: result.reusedBytes, totalBytes: result.seal.bytes };
	port!.postMessage({ type: 'progress', progress: { snapshotId: completed.snapshotId, phase: 'complete', copiedBytes: completed.copiedBytes, reusedBytes: completed.reusedBytes, totalBytes: completed.totalBytes } });
	port!.postMessage({ type: 'complete', ...completed });
}
void run().catch(() => {
	// Filesystem errors and manifest data can contain private paths/content.
	port.postMessage({ type: 'paused', code: abort.signal.aborted ? 'INTERRUPTED' : 'COPY_FAILED' });
}).finally(() => { pending?.finish(false); port.close(); });
