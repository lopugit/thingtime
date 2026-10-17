import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BackupObjectStore } from './portableBackup';

/** Local/native provider, never exposed as an HTTP filesystem path. The caller
 * must supply its private app-controlled directory under an approved destination.
 * Fixed generated keys and no-follow final opens reject path/symlink injection.
 * Immutable files are synced before publication and parent directories after it.
 * No cleanup/GC API exists yet: deleting one snapshot must not orphan another. */
export async function openLocalBackupStore(directory: string, options: { create?: boolean } = {}): Promise<BackupObjectStore> {
	const requested = resolve(directory);
	if (options.create !== false)
		await mkdir(requested, { mode: 0o700 }).catch((error) => {
			if (error.code !== 'EEXIST') throw error;
		});
	const root = await realpath(requested),
		info = await lstat(requested);
	if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))
		throw Error('Backup destination must be a private directory');
	const filePath = (key: string) => {
		if (
			!/^(chunks\/[a-f0-9]{64}|snapshots\/[0-9a-f-]{36}\/(header|plan|complete)\.json|snapshots\/[0-9a-f-]{36}\/plan\/(0|[1-9][0-9]{0,15})\.json|snapshots\/[0-9a-f-]{36}\/ranges\/(0|[1-9][0-9]{0,15})\/(0|[1-9][0-9]{0,15})\.json)$/.test(
				key
			)
		)
			throw Error('Invalid backup storage key');
		return join(root, key);
	};
	const ensureParents = async (path: string, create: boolean) => {
		const parent = dirname(path);
		let current = root;
		const rootInfo = await lstat(root);
		if (
			!rootInfo.isDirectory() ||
			rootInfo.isSymbolicLink() ||
			rootInfo.dev !== info.dev ||
			rootInfo.ino !== info.ino ||
			(rootInfo.mode & 0o077) !== 0
		)
			throw Error('Backup destination changed');
		for (const part of parent
			.slice(root.length + 1)
			.split('/')
			.filter(Boolean)) {
			current = join(current, part);
			if (create) {
				await mkdir(current, { mode: 0o700 }).catch((error) => {
					if (error.code !== 'EEXIST') throw error;
				});
				await syncDirectory(dirname(current));
			}
			const stat = await lstat(current);
			if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Backup directory is not private');
		}
	};
	const syncDirectory = async (path: string) => {
		const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	};
	await syncDirectory(dirname(root));
	const read: BackupObjectStore['read'] = async (key, maxBytes) => {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 8 * 1024 * 1024) throw Error('Invalid backup read bound');
		const path = filePath(key);
		try {
			await ensureParents(path, false);
			const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const stat = await handle.stat();
				if (!stat.isFile() || stat.size > maxBytes || (stat.mode & 0o077) !== 0) throw Error('Invalid backup object');
				// A bounded descriptor read prevents growth after stat from allocating an
				// arbitrarily large buffer, and detects truncation/trailing bytes.
				const bytes = Buffer.alloc(stat.size + 1);
				let offset = 0;
				while (offset < bytes.length) {
					const got = await handle.read(bytes, offset, bytes.length - offset, offset);
					if (!got.bytesRead) break;
					offset += got.bytesRead;
				}
				if (offset !== stat.size) throw Error('Backup object changed while reading');
				return bytes.subarray(0, offset);
			} finally {
				await handle.close();
			}
		} catch (error: any) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
	};
	return {
		read,
		async put(key, bytes) {
			if (!(bytes instanceof Uint8Array) || bytes.byteLength > 8 * 1024 * 1024) throw Error('Invalid backup object size');
			const data = Buffer.from(bytes),
				path = filePath(key);
			await ensureParents(path, true);
			const prior = await read(key, 8 * 1024 * 1024);
			if (prior !== null) {
				if (!Buffer.from(prior).equals(data)) throw Error('Immutable backup object changed');
				await syncDirectory(dirname(path));
				return;
			}
			const temporary = join(dirname(path), '.pending-' + randomUUID());
			const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
			try {
				try {
					await handle.writeFile(data);
					await handle.sync();
				} finally {
					await handle.close();
				}
				try {
					await link(temporary, path);
				} catch (error: any) {
					if (error.code !== 'EEXIST') throw error;
					const winner = await read(key, 8 * 1024 * 1024);
					if (!winner || !Buffer.from(winner).equals(data)) throw Error('Immutable backup object changed');
				}
				await syncDirectory(dirname(path));
			} finally {
				await unlink(temporary);
			}
		}
	};
}
