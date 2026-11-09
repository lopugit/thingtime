import { createHash } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { notificationContentSnapshot, notificationContentValue, NOTIFICATION_CONTENT_FIELDS } from '../../../timeline/notificationContent';
import { canonicalJsonBytes, parseJsonBytes } from '../../../utils/canonicalJsonStream';
import { openBackupItem, retainBackupStream, verifiedBackupItemBytes, type BackupAccess, type BackupObjectStore } from './portableBackup';
import type { BackupItem } from '../../../backups/manifest';
import { timelineScopeKey } from '../../../timeline/contract';

export const BACKUP_NOTIFICATION_ADAPTER = 'backup-notification-content';
export const backupNotificationProjection = { _id: 0, shareId: 1, ownerId: 1, thingtime: 1, targetId: 1, readAt: 1, createdAt: 1, updatedAt: 1, historyOnly: 1, ...Object.fromEntries(NOTIFICATION_CONTENT_FIELDS.map(key => [`crystal.${key}`, 1])) };
export function backupNotificationSnapshotFromDoc(doc: any) {
	if (!doc || JSON.stringify(doc.thingtime) !== '["notification"]') throw Error('Invalid notification inventory family');
	const crystal = Object.fromEntries(NOTIFICATION_CONTENT_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(doc.crystal ?? {}, key)).map(key => [key, doc.crystal[key]]));
	return notificationContentSnapshot({ id: doc.shareId, ownerId: doc.ownerId, crystal, targetId: doc.targetId ?? null, createdAt: doc.createdAt, updatedAt: doc.updatedAt ?? null, readAt: doc.readAt ?? null, historyOnly: doc.historyOnly ?? null });
}
export async function retainBackupNotification(store: BackupObjectStore, snapshotId: string, ordinal: number, doc: any, access: BackupAccess) {
	if (doc.ownerId !== access.scope.ownerId) throw Error('Backup notification owner changed');
	const snapshot = backupNotificationSnapshotFromDoc(doc), hash = createHash('sha256'), scope = timelineScopeKey(access.scope);
	let size = 0, chunks = 0;
	const check = () => { access.signal?.throwIfAborted(); if (timelineScopeKey(access.scope) !== scope) throw Error('Backup account or origin changed'); };
	for (const bytes of canonicalJsonBytes(snapshot, check)) { check(); size += bytes.length; hash.update(bytes); if (++chunks % 128 === 0) { await yieldToEventLoop(); await access.authorize(); } }
	const sha256 = hash.digest('hex');
	return retainBackupStream(store, snapshotId, { ordinal, thingId: doc.shareId, revision: 'snapshot-' + sha256, snapshot: { adapter: BACKUP_NOTIFICATION_ADAPTER, version: 1, value: { sha256, codec: 'canonical-json-utf8-v1' } } }, { size, sha256, bytes: canonicalJsonBytes(snapshot, check) }, access);
}
export async function readBackupNotification(item: BackupItem, bytes: AsyncIterable<Uint8Array>, ownerId: string, check: () => void = () => {}, authorize?: () => Promise<void>) {
	const descriptor = item.snapshot.value as any;
	if (item.snapshot.adapter !== BACKUP_NOTIFICATION_ADAPTER || item.snapshot.version !== 1 || !item.content || !descriptor || Object.keys(descriptor).sort().join(',') !== 'codec,sha256' || descriptor.codec !== 'canonical-json-utf8-v1' || !/^[a-f0-9]{64}$/.test(descriptor.sha256) || item.revision !== 'snapshot-' + descriptor.sha256) throw Error('Invalid retained notification descriptor');
	const hash = createHash('sha256');
	let chunks = 0;
	const checkpoint = async () => { await yieldToEventLoop(); if (authorize) await authorize(); check(); };
	const value = await parseJsonBytes((async function* () { for await (const chunk of verifiedBackupItemBytes(item, bytes)) { check(); if (++chunks % 128 === 0) await checkpoint(); hash.update(chunk); yield chunk; } })(), check);
	if (hash.digest('hex') !== descriptor.sha256) throw Error('Retained notification digest changed');
	const snapshot = value as any, content = notificationContentValue(snapshot);
	if (content.ownerId !== ownerId || content.id !== item.thingId) throw Error('Retained notification owner changed');
	const canonical = notificationContentSnapshot(content), canonicalHash = createHash('sha256');
	chunks = 0;
	for (const chunk of canonicalJsonBytes(canonical, check)) { check(); canonicalHash.update(chunk); if (++chunks % 128 === 0) await checkpoint(); }
	if (canonicalHash.digest('hex') !== descriptor.sha256) throw Error('Retained notification is not canonical');
	check();
	return canonical;
}
export async function openBackupNotification(store: BackupObjectStore, snapshotId: string, thingId: string, access: BackupAccess) {
	const scopeKey = timelineScopeKey(access.scope);
	const check = () => { access.signal?.throwIfAborted(); if (timelineScopeKey(access.scope) !== scopeKey) throw Error('Backup account or origin changed'); };
	const authorize = async () => { check(); await access.authorize(); check(); };
	await authorize();
	const { item, ranges } = await openBackupItem(store, snapshotId, thingId, access);
	const snapshot = await readBackupNotification(item, ranges, access.scope.ownerId, check, authorize);
	await authorize();
	return snapshot;
}
