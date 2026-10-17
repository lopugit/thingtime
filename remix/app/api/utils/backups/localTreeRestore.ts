import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, link, unlink, opendir } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { BACKUP_CHUNK_BYTES, BACKUP_METADATA_BYTES, backupJson } from '../../../backups/manifest';
import { timelineScopeKey } from '../../../timeline/contract';
import { openLocalBackupStore } from './localBackupStore';
import { openSealedBackup, verifyBackupItemBytes, type BackupAccess, type BackupObjectStore } from './portableBackup';
import { planBackupTree, treeRestoreReview } from './treeRestorePlan';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const privateMode = (stat: Awaited<ReturnType<typeof lstat>>) =>
	!(Number(stat.mode) & 0o077) && (!process.getuid || Number(stat.uid) === process.getuid());
const directory = async (path: string) => {
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || !privateMode(stat)) throw Error('Restore directory is not private');
	return stat;
};
const syncDirectory = async (path: string) => {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
};
const optionalStat = async (path: string) => {
	try {
		return await lstat(path);
	} catch (e: any) {
		if (e.code === 'ENOENT') return null;
		throw e;
	}
};
export async function canonicalRestoreDestination(destination: string) {
	const selected = resolve(destination);
	return join(await realpath(dirname(selected)), basename(selected));
}

/** Single-host local-disk exclusion. Every contender creates its own candidate
 * before checking other live processes. Concurrent contenders can both refuse,
 * but cannot both pass. Dead-process candidates are ignored, never unlinked by
 * another contender (avoids stale-lock replacement races). PID reuse refuses
 * conservatively. This is not a lock for a shared/network filesystem. */
async function restoreLock(root: string, guard: () => Promise<void>, localGuard: () => Promise<void>) {
	const locks = join(root, 'locks'),
		name = `${process.pid}-${randomUUID()}`,
		own = join(locks, name);
	await guard();
	await directory(locks);
	const fd = await open(own, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
	try {
		await fd.sync();
	} finally {
		await fd.close();
	}
	const identity = await lstat(own);
	const release = async () => {
		await localGuard();
		const stat = await optionalStat(own);
		if (stat && stat.ino === identity.ino && stat.dev === identity.dev) {
			await unlink(own);
			await syncDirectory(locks);
		}
	};
	try {
		await syncDirectory(locks);
		let count = 0;
		for await (const candidate of await opendir(locks)) {
			if (++count > 1024 || !/^[1-9][0-9]*-[0-9a-f-]{36}$/.test(candidate.name)) throw Error('Restore lock directory needs review');
			if (candidate.name === name) continue;
			const stat = await optionalStat(join(locks, candidate.name));
			if (!stat) continue;
			if (!stat.isFile() || stat.isSymbolicLink() || !privateMode(stat)) throw Error('Invalid restore lock');
			const pid = Number(candidate.name.split('-')[0]);
			if (!Number.isSafeInteger(pid) || pid > 2147483647) throw Error('Invalid restore process');
			try {
				process.kill(pid, 0);
			} catch (error: any) {
				if (error.code === 'ESRCH') continue;
				throw Error('Restore process ownership is unavailable');
			}
			throw Error('Another restore process is using this destination');
		}
		return release;
	} catch (error) {
		await release();
		throw error;
	}
}

/** Restore a reviewed tree into DEST/files, with private state/staging alongside.
 * New destinations are exclusively created; resume requires their exact identity.
 * Range bytes are synced and read back before durable receipts. A file is linked
 * into output only after complete fingerprint verification, never overwritten.
 * Use a trusted private local disk, not an adversarial/shared filesystem. */
export async function restoreBackupTree(
	store: BackupObjectStore,
	id: string,
	destination: string,
	reviewed: string,
	access: BackupAccess,
	options: { resume?: boolean; progress?(value: { kind: 'range' | 'file'; path: string; bytes: number }): void | Promise<void> } = {}
) {
	const plan = await planBackupTree(store, id, access),
		root = await canonicalRestoreDestination(destination);
	const review = treeRestoreReview(plan, root);
	if (reviewed !== review) throw Error('Restore plan or destination changed; review it again');
	const scope = timelineScopeKey(access.scope);
	const check = async () => {
		access.signal?.throwIfAborted();
		if (timelineScopeKey(access.scope) !== scope || timelineScopeKey(plan.header.scope) !== scope) throw Error('Restore account changed');
		await access.authorize();
		access.signal?.throwIfAborted();
	};
	await check();
	if (!options.resume) {
		await mkdir(root, { mode: 0o700 });
		await syncDirectory(dirname(root));
	}
	const identity = await directory(root);
	const localGuard = async () => {
		const current = await directory(root);
		if (current.ino !== identity.ino || current.dev !== identity.dev) throw Error('Restore destination changed');
	};
	const guard = async () => {
		await check();
		await localGuard();
	};
	for (const part of ['state', 'staging', 'files', 'locks']) {
		if (!options.resume) await mkdir(join(root, part), { mode: 0o700 });
		await directory(join(root, part));
	}
	await syncDirectory(root);
	const state = await openLocalBackupStore(join(root, 'state'), { create: false });
	const key = `snapshots/${id}`;
	const expected = {
		format: 'thingtime-tree-restore-v1',
		review,
		snapshotId: id,
		manifestHash: plan.seal.manifestHash,
		destination: root,
		dev: identity.dev,
		ino: identity.ino
	};
	const encode = (v: unknown) => new TextEncoder().encode(backupJson(v));
	const readState = async (path: string) => {
		await guard();
		const bytes = await state.read(path, BACKUP_METADATA_BYTES);
		return bytes ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : null;
	};
	if (options.resume) {
		if (backupJson(await readState(`${key}/header.json`)) !== backupJson(expected))
			throw Error('This destination belongs to another restore or is uninitialized');
	} else await state.put(`${key}/header.json`, encode(expected));
	const release = await restoreLock(root, guard, localGuard);
	try {
		const output = join(root, 'files'),
			staging = join(root, 'staging');
		const entries = new Map(plan.entries.filter((e) => e.path).map((e) => [e.path, e]));
		const inspect = async (path = '', seen = new Set<string>()): Promise<Set<string>> => {
			await guard();
			await directory(join(output, path));
			for await (const child of await opendir(join(output, path))) {
				const relative = path ? path + '/' + child.name : child.name,
					wanted = entries.get(relative);
				if (!wanted) throw Error('Restore destination contains an unexpected entry');
				const stat = await lstat(join(output, relative));
				if (stat.isSymbolicLink() || !privateMode(stat) || (wanted.kind === 'folder' ? !stat.isDirectory() : !stat.isFile()))
					throw Error('Restore destination contains a changed or unsafe entry');
				seen.add(relative);
				if (wanted.kind === 'folder') await inspect(relative, seen);
			}
			return seen;
		};
		await inspect();
		const folders = plan.entries.filter((e) => e.kind === 'folder' && e.path).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
		for (const folder of folders) {
			await guard();
			const path = join(output, folder.path);
			try {
				await mkdir(path, { mode: 0o700 });
			} catch (error: any) {
				if (error.code !== 'EEXIST') throw error;
			}
			await directory(path);
			await syncDirectory(dirname(path));
		}
		const ensureParents = async (path: string) => {
			await guard();
			await directory(staging);
			await directory(output);
			let current = output;
			for (const part of path.split('/').slice(0, -1)) {
				current = join(current, part);
				await directory(current);
			}
		};
		const opened = await openSealedBackup(store, id, access);
		if (backupJson(opened.seal) !== backupJson(plan.seal)) throw Error('Backup changed after restore review');
		const verifiedFiles = new Map<string, { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>();
		let restoredFiles = 0,
			reusedFiles = 0;
		for await (const entry of opened.entries) {
			const selected = plan.entries[entry.item.ordinal];
			if (!selected || backupJson(selected.item) !== backupJson(entry.item)) throw Error('Backup item changed after restore review');
			if (selected.kind !== 'file') continue;
			const { path, item } = selected;
			await ensureParents(path);
			const finalPath = join(output, path),
				stagePath = join(staging, `${item.ordinal}.part`),
				intentKey = `${key}/plan/${item.ordinal}.json`;
			const intent = { review, ordinal: item.ordinal, path };
			const existing = await optionalStat(finalPath);
			if (existing && backupJson(await readState(intentKey)) !== backupJson(intent)) throw Error('An existing file has no restore intent');
			await state.put(intentKey, encode(intent));
			let handle;
			try {
				handle = await open(stagePath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
				await syncDirectory(staging);
			} catch (error: any) {
				if (error.code !== 'EEXIST') throw error;
				handle = await open(stagePath, constants.O_RDWR | constants.O_NOFOLLOW);
			}
			try {
				const initial = await handle.stat();
				if (
					!initial.isFile() ||
					!privateMode(initial) ||
					(!existing && initial.nlink !== 1) ||
					(existing && (initial.dev !== existing.dev || initial.ino !== existing.ino))
				)
					throw Error('Restore staging or output identity changed');
				const stageGuard = async () => {
					await ensureParents(path);
					const current = await lstat(stagePath);
					if (current.isSymbolicLink() || current.dev !== initial.dev || current.ino !== initial.ino) throw Error('Restore staging changed');
				};
				const read = async (offset: number, length: number) => {
					await stageGuard();
					const bytes = Buffer.alloc(length);
					let at = 0;
					while (at < length) {
						const result = await handle.read(bytes, at, length - at, offset + at);
						if (!result.bytesRead) throw Error('Staged restore bytes are incomplete');
						at += result.bytesRead;
					}
					await stageGuard();
					return bytes;
				};
				if (!existing) {
					let ordinal = 0;
					for await (const range of entry.ranges) {
						const receiptKey = `${key}/ranges/${item.ordinal}/${ordinal++}.json`;
						const expectedRange = { offset: range.offset, length: range.length, sha256: range.sha256, dev: initial.dev, ino: initial.ino };
						const receipt = await readState(receiptKey);
						if (receipt !== null) {
							if (backupJson(receipt) !== backupJson(expectedRange) || hash(await read(range.offset, range.length)) !== range.sha256)
								throw Error('Accepted restore range changed');
						} else {
							const bytes = await range.read();
							await stageGuard();
							if ((await handle.stat()).nlink !== 1) throw Error('Restore staging acquired another link');
							let at = 0;
							while (at < bytes.length) {
								const written = await handle.write(bytes, at, bytes.length - at, range.offset + at);
								if (!written.bytesWritten) throw Error('Restore write made no progress');
								at += written.bytesWritten;
							}
							await handle.sync();
							if (hash(await read(range.offset, range.length)) !== range.sha256) throw Error('Restore range readback failed');
							await state.put(receiptKey, encode(expectedRange));
							await options.progress?.({ kind: 'range', path, bytes: range.offset + range.length });
						}
					}
				}
				const before = await handle.stat();
				if (before.size !== item.content!.size) throw Error('Restored file size changed');
				async function* stagedBytes() {
					for (let offset = 0; offset < item.content!.size; offset += BACKUP_CHUNK_BYTES)
						yield await read(offset, Math.min(BACKUP_CHUNK_BYTES, item.content!.size - offset));
				}
				await verifyBackupItemBytes(item, stagedBytes());
				const after = await handle.stat();
				if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
					throw Error('Restored file changed during verification');
				await stageGuard();
				if (!existing) {
					await link(stagePath, finalPath);
					await syncDirectory(dirname(finalPath));
					restoredFiles++;
				} else {
					const current = await lstat(finalPath);
					if (current.isSymbolicLink() || current.ino !== initial.ino || current.dev !== initial.dev) throw Error('Restored output changed');
					await syncDirectory(dirname(finalPath));
					reusedFiles++;
				}
				const verified = await lstat(finalPath);
				verifiedFiles.set(path, { dev: verified.dev, ino: verified.ino, size: verified.size, mtimeMs: verified.mtimeMs, ctimeMs: verified.ctimeMs });
				await options.progress?.({ kind: 'file', path, bytes: item.content!.size });
			} finally {
				await handle.close();
			}
		}
		if ((await inspect()).size !== entries.size) throw Error('Restored tree is incomplete');
		for (const [path, verified] of verifiedFiles) {
			await ensureParents(path);
			const current = await lstat(join(output, path));
			if (current.isSymbolicLink() || Object.entries(verified).some(([key, value]) => current[key] !== value))
				throw Error('Restored file changed before completion');
		}
		await guard();
		await state.put(`${key}/complete.json`, encode({ ...expected, files: restoredFiles + reusedFiles, bytes: plan.seal.bytes }));
		return { directory: output, files: restoredFiles + reusedFiles, restoredFiles, reusedFiles, bytes: plan.seal.bytes, review };
	} finally {
		await release();
	}
}
