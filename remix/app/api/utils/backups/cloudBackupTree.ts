import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { parseCloudFolder } from '../../../fileSync/cloudFolder';
import { parseCloudInventoryNode, type CloudInventoryNode } from '../../../fileSync/cloudInventory';
import { CLOUD_INVENTORY_PAGE_ENTRIES } from '../../../fileSync/cloudInventoryPages';
import { CLOUD_FILE_ADAPTER } from '../../../fileSync/cloudFile';
import { syncPathKey } from '../../../fileSync/reconcile';
import { backupJson, parseBackupItem, type BackupItem } from '../../../backups/manifest';

export const CLOUD_BACKUP_FOLDER_ADAPTER = 'backup-file-folder';
export const CLOUD_BACKUP_SCRATCH_BYTES = 512 * 1024 * 1024;

// Node 24 is the app's required runtime. Keep this small built-in adapter typed
// while the rest of the workspace still uses Node 20's ambient declarations.
type Row = Record<string, string | number | null>;
type Statement = { run(...values: (string | number | null)[]): unknown; all(...values: string[]): Row[]; iterate(): Iterable<Row> };
type Database = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };

/** Request-owned scratch index, never a history database or a saved snapshot.
 * SQL indexes bound identity/path checks and Thing-ID ordering without an array
 * of the whole tree. Incomplete work is discarded; only prepareBackup publishes
 * durable metadata. No source URLs or credentials enter this workspace. */
export async function openCloudBackupTree(input: unknown, options: {
	maxBytes?: number;
	temporaryDirectory?: string;
} = {}) {
	const root = parseCloudFolder(input), maxBytes = options.maxBytes ?? CLOUD_BACKUP_SCRATCH_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 65536 || maxBytes > 8 * 1024 ** 3)
		throw Error('Invalid backup tree workspace bound');
	const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => Database };
	const directory = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'thingtime-backup-tree-'));
	let db: Database | undefined, phase: 'writing' | 'ready' | 'failed' | 'closed' = 'writing';
	const close = async () => {
		if (phase === 'closed') return;
		phase = 'closed';
		try { db?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
	};
	try {
		const path = join(directory, 'tree.sqlite');
		const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
		await file.close();
		db = new DatabaseSync(path);
		db.exec(`PRAGMA page_size=4096; PRAGMA max_page_count=${Math.floor(maxBytes / 4096)};
			PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;
			CREATE TABLE entries (thingId TEXT PRIMARY KEY COLLATE BINARY, path TEXT NOT NULL,
			pathKey TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, parentId TEXT, parentPath TEXT, item TEXT NOT NULL) WITHOUT ROWID;`);
		const insert = db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)');
		const folderItem = (value: typeof root): BackupItem => ({ ordinal: 0, thingId: value.id, revision: value.revision,
			snapshot: { adapter: CLOUD_BACKUP_FOLDER_ADAPTER, version: 1, value }, content: null });
		insert.run(root.id, '', '', 'folder', root.folderId, null, backupJson(parseBackupItem(folderItem(root))));
		const check = (expected: typeof phase) => { if (phase !== expected) throw Error('Backup tree workspace is not ' + expected); };
		return {
			append(nodes: CloudInventoryNode[]) {
				check('writing');
				try {
					if (nodes.length > CLOUD_INVENTORY_PAGE_ENTRIES) throw Error('Backup tree page exceeds its bound');
					db!.exec('BEGIN');
					for (const input of nodes) {
						const node = parseCloudInventoryNode(input), name = node.path.split('/').at(-1)!;
						const parentPath = node.path.split('/').slice(0, -1).join('/');
						const item: BackupItem = node.kind === 'folder'
							? folderItem({ id: node.id, revision: node.revision, folderId: node.folderId, name })
							: { ordinal: 0, thingId: node.file.id, revision: node.file.revision,
								snapshot: { adapter: CLOUD_FILE_ADAPTER, version: 1, value: node.file },
								content: { size: node.file.content.size, fingerprint: node.file.content.fingerprint } };
						insert.run(item.thingId, node.path, syncPathKey(node.path), node.kind,
							node.kind === 'folder' ? node.folderId : node.file.folderId, parentPath, backupJson(parseBackupItem(item)));
					}
					db!.exec('COMMIT');
				} catch (error) { phase = 'failed'; try { db!.exec('ROLLBACK'); } catch { /* No open transaction. */ } throw error; }
			},
			async validate(guard: () => void) {
				check('writing');
				try {
					const batch = db!.prepare(`SELECT n.thingId, n.parentPath, p.path AS actualParentPath, p.kind AS parentKind
						FROM entries n LEFT JOIN entries p ON p.thingId=n.parentId
						WHERE n.thingId > ? ORDER BY n.thingId LIMIT 128`);
					let last = '';
					for (;;) {
						guard(); const rows = batch.all(last);
						if (!rows.length) break;
						for (const row of rows) {
							if (row.thingId === root.id ? row.parentKind !== null
								: row.parentKind !== 'folder' || row.parentPath !== row.actualParentPath)
								throw Error('Cloud backup tree has missing parents, cycles or changed ancestry');
							last = row.thingId as string;
						}
						await yieldToEventLoop();
					}
					guard(); phase = 'ready';
				} catch (error) { phase = 'failed'; throw error; }
			},
			async *items(): AsyncGenerator<BackupItem> {
				check('ready'); let ordinal = 0;
				for (const row of db!.prepare('SELECT item FROM entries ORDER BY thingId').iterate()) {
					check('ready'); yield { ...parseBackupItem(JSON.parse(row.item as string)), ordinal: ordinal++ };
				}
			},
			close
		};
	} catch (error) { await close(); throw error; }
}
