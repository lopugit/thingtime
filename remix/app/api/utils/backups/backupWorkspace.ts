import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BACKUP_WORKSPACE_BYTES = 512 * 1024 * 1024;
export type BackupWorkspaceOptions = { maxBytes?: number; temporaryDirectory?: string };
type Value = string | number | null;
export type BackupWorkspaceRow = Record<string, Value>;
type Statement = {
	run(...values: Value[]): unknown;
	get(...values: Value[]): BackupWorkspaceRow | undefined;
	all(...values: Value[]): BackupWorkspaceRow[];
	iterate(...values: Value[]): Iterable<BackupWorkspaceRow>;
};
type Database = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };

/** Private scratch data only. A process crash can leave this directory behind;
 * no durable snapshot or recovery receipt depends on it. Normal callers close
 * in finally, including cancellation, disk exhaustion and validation failure. */
export async function openBackupWorkspace(options: BackupWorkspaceOptions = {}) {
	const maxBytes = options.maxBytes ?? BACKUP_WORKSPACE_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 65536 || maxBytes > 8 * 1024 ** 3)
		throw Error('Invalid backup tree workspace bound');
	// Node 24 is required. The workspace's older ambient Node types do not yet
	// declare this built-in module; no third-party SQLite binding is needed.
	const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => Database };
	const directory = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'thingtime-backup-tree-'));
	let db: Database | undefined, closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		try { db?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
	};
	try {
		const path = join(directory, 'tree.sqlite');
		const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
		await file.close();
		db = new DatabaseSync(path);
		db.exec(`PRAGMA page_size=4096; PRAGMA max_page_count=${Math.floor(maxBytes / 4096)};
			PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;`);
		return { db, close };
	} catch (error) { await close(); throw error; }
}
