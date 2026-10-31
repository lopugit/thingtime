import { createHash } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { backupJson, parseBackupItem, type BackupItem } from '../../../backups/manifest';
import { timelineScopeKey } from '../../../timeline/contract';
import { CLOUD_FILE_ADAPTER, parseCloudFile } from '../../../fileSync/cloudFile';
import { parseCloudFolder } from '../../../fileSync/cloudFolder';
import { equalContentFingerprints } from '../../../fileSync/contentFingerprint';
import { syncPathKey, validSyncPath } from '../../../fileSync/reconcile';
import { CLOUD_BACKUP_FOLDER_ADAPTER } from './cloudBackupTree';
import { openBackupWorkspace, type BackupWorkspaceOptions, type BackupWorkspaceRow } from './backupWorkspace';
import { openSealedBackup, type BackupAccess, type BackupObjectStore } from './portableBackup';

export type TreeRestoreEntry = { item: BackupItem; path: string; kind: 'file' | 'folder' };
export type RestoredFileIdentity = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
const BATCH = 128;
const entry = (row: BackupWorkspaceRow): TreeRestoreEntry => ({
	item: parseBackupItem(JSON.parse(row.item as string)), path: row.path as string, kind: row.kind as 'file' | 'folder'
});

/** Validate a complete selected tree on private bounded scratch storage. Paths
 * are resolved breadth-first through indexed physical parents; no destination
 * exists until all ancestry, depth and case/Unicode checks have passed. Callers
 * must close the plan in finally. Durable backup and restore formats stay
 * unchanged, including review hashes and interrupted-restore receipts. */
export async function planBackupTree(store: BackupObjectStore, id: string, access: BackupAccess, options: BackupWorkspaceOptions = {}) {
	const backup = await openSealedBackup(store, id, access), scope = timelineScopeKey(backup.header.scope);
	const workspace = await openBackupWorkspace(options), db = workspace.db;
	let closed = false;
	const close = async () => { closed = true; await workspace.close(); };
	const guard = async () => {
		if (closed) throw Error('Restore plan is closed');
		access.signal?.throwIfAborted();
		if (timelineScopeKey(access.scope) !== scope) throw Error('Restore account changed');
		await access.authorize();
		access.signal?.throwIfAborted();
		if (timelineScopeKey(access.scope) !== scope) throw Error('Restore account changed');
	};
	try {
		await guard();
		db.exec(`CREATE TABLE entries (ordinal INTEGER PRIMARY KEY, thingId TEXT NOT NULL UNIQUE COLLATE BINARY,
			parentId TEXT, name TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL,
			path TEXT UNIQUE, pathKey TEXT UNIQUE, depth INTEGER, verified TEXT);
			CREATE INDEX children ON entries(parentId, ordinal);
			CREATE INDEX folders ON entries(kind, depth, ordinal);`);
		const insert = db.prepare('INSERT INTO entries(ordinal,thingId,parentId,name,kind,item) VALUES (?,?,?,?,?,?)');
		let count = 0;
		for await (const { item } of backup.entries) {
			if (count % BATCH === 0) { await guard(); db.exec('BEGIN'); }
			if (item.snapshot.version !== 1) throw Error('Unsupported backup tree version');
			let parent: string | null, name: string, kind: 'file' | 'folder';
			if (item.snapshot.adapter === CLOUD_BACKUP_FOLDER_ADAPTER) {
				const folder = parseCloudFolder(item.snapshot.value);
				if (item.content !== null || folder.id !== item.thingId || folder.revision !== item.revision) throw Error('Backup folder identity changed');
				parent = folder.folderId; name = folder.name; kind = 'folder';
			} else if (item.snapshot.adapter === CLOUD_FILE_ADAPTER) {
				const file = parseCloudFile(item.snapshot.value);
				if (!item.content || file.id !== item.thingId || file.revision !== item.revision || file.trashed ||
					file.content.size !== item.content.size || !equalContentFingerprints(file.content.fingerprint, item.content.fingerprint))
					throw Error('Backup file identity changed');
				parent = file.folderId; name = file.name; kind = 'file';
			} else throw Error('This snapshot needs its own restore adapter');
			insert.run(item.ordinal, item.thingId, parent, name, kind, backupJson(item)); count++;
			if (count % BATCH === 0) { db.exec('COMMIT'); await yieldToEventLoop(); }
		}
		if (count % BATCH) db.exec('COMMIT');
		await guard();
		const rootId = backup.header.coverage.selectionId, root = db.prepare('SELECT * FROM entries WHERE thingId=?').get(rootId);
		if (!root || root.kind !== 'folder') throw Error('Backup has no selected folder root');
		if (root.parentId !== null && db.prepare('SELECT 1 FROM entries WHERE thingId=?').get(root.parentId))
			throw Error('Backup root participates in a parent cycle');
		if (db.prepare(`SELECT 1 FROM entries n LEFT JOIN entries p ON p.thingId=n.parentId
			WHERE n.thingId != ? AND (p.kind IS NULL OR p.kind != 'folder') LIMIT 1`).get(rootId))
			throw Error('Backup tree has missing parents');
		db.prepare("UPDATE entries SET path='',pathKey='',depth=0 WHERE thingId=?").run(rootId);
		const folders = db.prepare(`SELECT ordinal,thingId,path,depth FROM entries WHERE kind='folder' AND depth IS NOT NULL
			AND (depth, ordinal) > (?, ?) ORDER BY depth,ordinal LIMIT ${BATCH}`);
		// While paths are being discovered, finish each depth before advancing.
		// Mixing depths in one page could pass a newly discovered lower ordinal
		// at the next depth and incorrectly leave its descendants unresolved.
		const pendingFolders = db.prepare(`SELECT ordinal,thingId,path,depth FROM entries WHERE kind='folder'
			AND depth=? AND ordinal>? ORDER BY ordinal LIMIT ${BATCH}`);
		const children = db.prepare(`SELECT ordinal,name FROM entries WHERE parentId=? AND ordinal>? ORDER BY ordinal LIMIT ${BATCH}`);
		const setPath = db.prepare('UPDATE entries SET path=?,pathKey=?,depth=? WHERE ordinal=?');
		let lastDepth = 0, lastFolder = -1, resolved = 1;
		for (;;) {
			await guard();
			const parents = pendingFolders.all(lastDepth, lastFolder);
			if (!parents.length) {
				if (lastFolder === -1) break;
				lastDepth++; lastFolder = -1; continue;
			}
			for (const parent of parents) {
				let lastChild = -1;
				for (;;) {
					await guard();
					const rows = children.all(parent.thingId, lastChild);
					if (!rows.length) break;
					db.exec('BEGIN');
					for (const row of rows) {
						const path = parent.path ? parent.path + '/' + row.name : row.name as string;
						if (!validSyncPath(path) || path.split('/').some(part => Buffer.byteLength(part) > 255))
							throw Error('Backup tree path is unsafe, too long or excessively deep');
						try { setPath.run(path, syncPathKey(path), Number(parent.depth) + 1, row.ordinal); }
						catch (error) {
							if (String(error).includes('UNIQUE constraint')) throw Error('Backup tree has ambiguous case or Unicode paths');
							throw error;
						}
						lastChild = Number(row.ordinal); resolved++;
					}
					db.exec('COMMIT'); await yieldToEventLoop();
				}
				lastFolder = Number(parent.ordinal);
			}
		}
		if (resolved !== count || count !== backup.seal.items) throw Error('Backup tree has a disconnected parent cycle');
		await guard();
		const byOrdinal = db.prepare('SELECT item,path,kind FROM entries WHERE ordinal=?');
		const byPath = db.prepare('SELECT kind FROM entries WHERE path=?');
		const verify = db.prepare("UPDATE entries SET verified=? WHERE path=? AND kind='file'");
		async function* rows(where = '') {
			await guard();
			const batch = db.prepare(`SELECT ordinal,item,path,kind,verified FROM entries WHERE ordinal>? ${where} ORDER BY ordinal LIMIT ${BATCH}`);
			let last = -1;
			for (;;) {
				await guard(); const values = batch.all(last);
				if (!values.length) break;
				for (const row of values) { last = Number(row.ordinal); yield row; }
				await yieldToEventLoop();
			}
		}
		return {
			header: backup.header, seal: backup.seal, count, close,
			async *entries() { for await (const row of rows()) yield entry(row); },
			async *folders() {
				let depth = 0, ordinal = -1;
				for (;;) {
					await guard(); const batch = folders.all(depth, ordinal);
					if (!batch.length) break;
					for (const row of batch) {
						depth = Number(row.depth); ordinal = Number(row.ordinal);
						if (row.path) yield { path: row.path as string };
					}
					await yieldToEventLoop();
				}
			},
			async entryAt(ordinal: number) { await guard(); const row = byOrdinal.get(ordinal); return row ? entry(row) : undefined; },
			async kindAtPath(path: string) { await guard(); return byPath.get(path)?.kind as 'file' | 'folder' | undefined; },
			async recordVerified(path: string, identity: RestoredFileIdentity) { await guard(); verify.run(backupJson(identity), path); },
			async *verifiedFiles() {
				for await (const row of rows('AND verified IS NOT NULL'))
					yield { path: row.path as string, identity: JSON.parse(row.verified as string) as RestoredFileIdentity };
			}
		};
	} catch (error) { await close(); throw error; }
}
export type TreeRestorePlan = Awaited<ReturnType<typeof planBackupTree>>;
export async function treeRestoreReview(plan: TreeRestorePlan, canonicalDestination: string) {
	const hash = createHash('sha256');
	hash.update(backupJson({ format: 'thingtime-tree-restore-v1', destination: canonicalDestination, header: plan.header, seal: plan.seal }) + '\0');
	for await (const entry of plan.entries()) hash.update(backupJson({ path: entry.path, kind: entry.kind, item: entry.item }) + '\0');
	return hash.digest('hex');
}
