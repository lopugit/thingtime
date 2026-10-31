import { createHash } from 'node:crypto';
import { themeContentSnapshot, themeContentValue, THEME_CONTENT_ADAPTER } from '../../../timeline/themeContent';
import { type TimelineSnapshot } from '../../../timeline/contract';
import { BACKUP_METADATA_BYTES, backupJson, parseBackupItem } from '../../../backups/manifest';
import { openBackupItem, retainBackupPayload, type BackupAccess, type BackupObjectStore } from './portableBackup';

export const BACKUP_THEME_CONTENT_ADAPTER = 'backup-theme-content';
// The canonical theme value has a 256 KiB budget. Allow its snapshot envelope.
export const BACKUP_THEME_BYTES = 256 * 1024 + 1024;
export const backupThemeProjection = {
	_id: 0,
	shareId: 1,
	ownerId: 1,
	thingtime: 1,
	timelineHeadId: 1,
	folderId: 1,
	tags: 1,
	acl: 1,
	'crystal.name': 1,
	'crystal.title': 1,
	'crystal.theme': 1
};
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => backupJson(value, BACKUP_THEME_BYTES);

/** Use the same approved fields and partial-token semantics as saved-theme
 * Timeline history. Root credentials and unknown crystal fields are not content. */
export function backupThemeSnapshotFromDoc(doc: any): TimelineSnapshot {
	if (!doc || !Array.isArray(doc.thingtime) || doc.thingtime.length !== 1 || doc.thingtime[0] !== 'theme')
		throw Error('Invalid theme inventory family');
	return themeContentSnapshot({
		crystal: doc.crystal,
		tags: doc.tags ?? [],
		visibility: Array.isArray(doc.acl) && doc.acl.includes('tt:all') ? 'public' : 'private',
		folderId: doc.folderId ?? null
	});
}

function parseSnapshot(input: TimelineSnapshot): TimelineSnapshot {
	const snapshot = JSON.parse(json(input));
	const canonical = themeContentSnapshot(themeContentValue(snapshot));
	if (json(canonical) !== json(snapshot)) throw Error('Invalid archived theme fields');
	return canonical;
}

export async function retainBackupThemeSnapshot(store: BackupObjectStore, snapshotId: string, ordinal: number, doc: any, access: BackupAccess) {
	if (doc.ownerId !== access.scope.ownerId) throw Error('Theme backup owner changed');
	const snapshot = backupThemeSnapshotFromDoc(doc),
		text = json(snapshot),
		sha256 = digest(text),
		revision = doc.timelineHeadId ?? 'snapshot-' + sha256;
	if (Buffer.byteLength(text) + 2048 <= BACKUP_METADATA_BYTES)
		return parseBackupItem({ ordinal, thingId: doc.shareId, revision, snapshot, content: null });
	return retainBackupPayload(
		store,
		snapshotId,
		{ ordinal, thingId: doc.shareId, revision, snapshot: { adapter: BACKUP_THEME_CONTENT_ADAPTER, version: 1, value: { sha256 } } },
		Buffer.from(text),
		access
	);
}

/** Offline content reader, not authority to restore visibility, sharing or
 * theme selection. A live import must use the current reviewed theme writer. */
export async function openBackupThemeSnapshot(
	store: BackupObjectStore,
	snapshotId: string,
	thingId: string,
	access: BackupAccess
): Promise<TimelineSnapshot> {
	const { item, ranges } = await openBackupItem(store, snapshotId, thingId, access);
	if (item.snapshot.adapter === THEME_CONTENT_ADAPTER && item.content === null) return parseSnapshot(item.snapshot);
	const descriptor = item.snapshot.value as any;
	if (
		item.snapshot.adapter !== BACKUP_THEME_CONTENT_ADAPTER ||
		item.snapshot.version !== 1 ||
		!descriptor ||
		Object.keys(descriptor).length !== 1 ||
		!/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
		!item.content ||
		item.content.size > BACKUP_THEME_BYTES
	)
		throw Error('Invalid retained theme descriptor');
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const bytes of ranges) {
		size += bytes.length;
		if (size > BACKUP_THEME_BYTES) throw Error('Retained theme exceeds its bound');
		chunks.push(bytes);
	}
	const bytes = Buffer.concat(chunks),
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	if (digest(bytes) !== descriptor.sha256) throw Error('Retained theme digest changed');
	const snapshot = parseSnapshot(JSON.parse(text));
	if (json(snapshot) !== text) throw Error('Retained theme is not canonical');
	return snapshot;
}
