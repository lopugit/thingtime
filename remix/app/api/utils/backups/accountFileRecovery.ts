import { parseCloudFile, type CloudFile } from '../../../fileSync/cloudFile';
import { openBackupItem, type BackupObjectStore, type BackupAccess } from './portableBackup';
import { openBackupTimelineRecord } from './timelineRecords';
import { parseBackupAttachment, backupAttachmentItemContent, verifyBackupFileReference } from './attachmentRecords';

/** Offline byte recovery only: this cannot replay archived receipts or confer
 * current server write permission. Consumers stage privately and publish only
 * after the iterator's final full-fingerprint verification. */
async function openFileBytes(store: BackupObjectStore, snapshotId: string, file: CloudFile, access: BackupAccess) {
	const result = await openBackupItem(store, snapshotId, file.content.attachmentId, access);
	backupAttachmentItemContent(result.item);
	const attachment = parseBackupAttachment(result.item.snapshot.value);
	if (attachment.ownerId !== access.scope.ownerId) throw Error('Backup attachment owner changed');
	verifyBackupFileReference(file.content, file.id, attachment);
	return { file, ranges: result.ranges };
}
export async function openAccountBackupFile(store: BackupObjectStore, snapshotId: string, fileId: string, access: BackupAccess) {
	const result = await openBackupItem(store, snapshotId, fileId, access);
	if (result.item.snapshot.adapter !== 'file-content' || result.item.snapshot.version !== 1 || result.item.content !== null)
		throw Error('Not an account backup file descriptor');
	const file = parseCloudFile(result.item.snapshot.value);
	if (file.id !== fileId || file.revision !== result.item.revision) throw Error('Backup file identity changed');
	return openFileBytes(store, snapshotId, file, access);
}
export async function openAccountBackupFileVersion(
	store: BackupObjectStore,
	snapshotId: string,
	eventThingId: string,
	side: 'before' | 'after',
	access: BackupAccess
) {
	if (side !== 'before' && side !== 'after') throw Error('Invalid file version side');
	const record = await openBackupTimelineRecord(store, snapshotId, eventThingId, access);
	if (record.kind !== 'timeline-event') throw Error('Not an archived Timeline event');
	const event = (record.value as any).event,
		snapshot = event[side];
	if (snapshot?.adapter !== 'file-content' || snapshot.version !== 1) throw Error('This Timeline version has no saved file bytes');
	const file = parseCloudFile(snapshot.value);
	if (file.id !== event.thingId) throw Error('Backup file version identity changed');
	return openFileBytes(store, snapshotId, file, access);
}
