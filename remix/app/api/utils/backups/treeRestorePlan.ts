import { createHash } from 'node:crypto';
import { backupJson, type BackupItem } from '../../../backups/manifest';
import { CLOUD_FILE_ADAPTER, parseCloudFile } from '../../../fileSync/cloudFile';
import { parseCloudFolder } from '../../../fileSync/cloudFolder';
import { equalContentFingerprints } from '../../../fileSync/contentFingerprint';
import { MAX_SYNC_SCAN_ENTRIES, syncPathKey, validSyncPath } from '../../../fileSync/reconcile';
import { CLOUD_BACKUP_FOLDER_ADAPTER } from './cloudFolderBackup';
import { openSealedBackup, type BackupAccess, type BackupObjectStore } from './portableBackup';

export type TreeRestoreEntry = { item: BackupItem; path: string; kind: 'file' | 'folder' };

/** Preflight the entire selected filesystem tree. No disk paths are used until
 * parent membership, names, cycles and case/Unicode aliases all pass. The bound
 * matches the current cloud producer and refuses larger/unsupported snapshots. */
export async function planBackupTree(store: BackupObjectStore, id: string, access: BackupAccess) {
	const backup = await openSealedBackup(store, id, access);
	const rows = new Map<string, { item: BackupItem; parent: string | null; name: string; kind: 'file' | 'folder' }>();
	let metadataBytes = 0;
	for await (const { item } of backup.entries) {
		metadataBytes += Buffer.byteLength(backupJson(item));
		if (rows.size >= MAX_SYNC_SCAN_ENTRIES + 1 || metadataBytes > 32 * 1024 * 1024) throw Error('Restore tree exceeds its metadata bound');
		if (item.snapshot.version !== 1) throw Error('Unsupported backup tree version');
		if (item.snapshot.adapter === CLOUD_BACKUP_FOLDER_ADAPTER) {
			const folder = parseCloudFolder(item.snapshot.value);
			if (item.content !== null || folder.id !== item.thingId || folder.revision !== item.revision) throw Error('Backup folder identity changed');
			rows.set(item.thingId, { item, parent: folder.folderId, name: folder.name, kind: 'folder' });
		} else if (item.snapshot.adapter === CLOUD_FILE_ADAPTER) {
			const file = parseCloudFile(item.snapshot.value);
			if (
				!item.content ||
				file.id !== item.thingId ||
				file.revision !== item.revision ||
				file.trashed ||
				file.content.size !== item.content.size ||
				!equalContentFingerprints(file.content.fingerprint, item.content.fingerprint)
			)
				throw Error('Backup file identity changed');
			rows.set(item.thingId, { item, parent: file.folderId, name: file.name, kind: 'file' });
		} else throw Error('This snapshot needs its own restore adapter');
	}
	const root = rows.get(backup.header.coverage.selectionId);
	if (!root || root.kind !== 'folder') throw Error('Backup has no selected folder root');
	if (root.parent !== null && rows.has(root.parent)) throw Error('Backup root participates in a parent cycle');
	const paths = new Map<string, string>([[root.item.thingId, '']]);
	const resolvePath = (id: string, visiting = new Set<string>()): string => {
		if (paths.has(id)) return paths.get(id)!;
		const row = rows.get(id);
		if (!row || !row.parent || rows.get(row.parent)?.kind !== 'folder' || visiting.has(id) || visiting.size >= 128)
			throw Error('Backup tree has missing parents, cycles or excessive depth');
		visiting.add(id);
		const parent = resolvePath(row.parent, visiting),
			path = parent ? parent + '/' + row.name : row.name;
		visiting.delete(id);
		if (!validSyncPath(path) || path.split('/').some((part) => Buffer.byteLength(part) > 255)) throw Error('Backup tree path is unsafe or too long');
		paths.set(id, path);
		return path;
	};
	const seen = new Set<string>();
	const entries: TreeRestoreEntry[] = [];
	for (const [id, row] of rows) {
		const path = resolvePath(id),
			key = syncPathKey(path);
		if (seen.has(key)) throw Error('Backup tree has ambiguous case or Unicode paths');
		seen.add(key);
		entries.push({ item: row.item, path, kind: row.kind });
	}
	return { header: backup.header, seal: backup.seal, entries };
}
export type TreeRestorePlan = Awaited<ReturnType<typeof planBackupTree>>;
export function treeRestoreReview(plan: TreeRestorePlan, canonicalDestination: string) {
	const hash = createHash('sha256');
	hash.update(backupJson({ format: 'thingtime-tree-restore-v1', destination: canonicalDestination, header: plan.header, seal: plan.seal }) + '\0');
	for (const entry of plan.entries) hash.update(backupJson({ path: entry.path, kind: entry.kind, item: entry.item }) + '\0');
	return hash.digest('hex');
}
