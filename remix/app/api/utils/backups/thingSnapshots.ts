import { createHash } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { type TimelineSnapshot } from '../../../timeline/contract';
import { isProtectedThingtime, MESSENGER_THINGTIME } from '../../../schemas/registry';
import { thingContentSnapshot } from '../timeline/recordMutation';
import { BACKUP_METADATA_BYTES, parseBackupItem } from '../../../backups/manifest';
import { BACKUP_RETAINED_PAYLOAD_BYTES, retainBackupPayload, openBackupItem, type BackupObjectStore, type BackupAccess } from './portableBackup';

export const BACKUP_THING_CONTENT_ADAPTER = 'backup-thing-content';
export const backupThingJson = (input: unknown) =>
	JSON.stringify(
		copyBoundedJson(
			input,
			{
				maxBytes: BACKUP_RETAINED_PAYLOAD_BYTES,
				maxDepth: 94,
				maxNodes: 100_000,
				sortKeys: true
			},
			'Backup Thing snapshot'
		)
	);
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function parseBackupThingSnapshot(input: unknown): TimelineSnapshot {
	const snapshot = JSON.parse(backupThingJson(input));
	if (
		!snapshot ||
		Object.keys(snapshot).length !== 3 ||
		snapshot.adapter !== 'thing-content' ||
		snapshot.version !== 1 ||
		!snapshot.value ||
		!Array.isArray(snapshot.value.thingtime) ||
		!snapshot.value.thingtime.length ||
		snapshot.value.thingtime.length > 64 ||
		snapshot.value.thingtime.some((kind: unknown) => typeof kind !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(kind)) ||
		isProtectedThingtime(snapshot.value.thingtime) ||
		snapshot.value.thingtime.some((kind: string) => (MESSENGER_THINGTIME as readonly string[]).includes(kind)) ||
		backupThingJson(thingContentSnapshot(snapshot.value)) !== backupThingJson(snapshot)
	)
		throw Error('Invalid ordinary Thing backup snapshot');
	return snapshot;
}
/** Keep small canonical snapshots inline. Large ordinary content uses exactly
 * the same canonical Timeline snapshot, retained in bounded verified chunks. */
export async function retainBackupThingSnapshot(store: BackupObjectStore, snapshotId: string, ordinal: number, doc: any, access: BackupAccess) {
	if (doc.ownerId !== access.scope.ownerId) throw Error('Backup Thing owner changed');
	const snapshot = parseBackupThingSnapshot(thingContentSnapshot(doc)),
		text = backupThingJson(snapshot),
		sha256 = digest(text);
	const revision = doc.timelineHeadId ?? 'snapshot-' + sha256;
	if (Buffer.byteLength(text) + 2048 <= BACKUP_METADATA_BYTES)
		return parseBackupItem({ ordinal, thingId: doc.shareId, revision, snapshot, content: null });
	return retainBackupPayload(
		store,
		snapshotId,
		{ ordinal, thingId: doc.shareId, revision, snapshot: { adapter: BACKUP_THING_CONTENT_ADAPTER, version: 1, value: { sha256 } } },
		Buffer.from(text),
		access
	);
}
export async function openBackupThingSnapshot(
	store: BackupObjectStore,
	snapshotId: string,
	thingId: string,
	access: BackupAccess
): Promise<TimelineSnapshot> {
	const { item, ranges } = await openBackupItem(store, snapshotId, thingId, access);
	if (item.snapshot.adapter === 'thing-content' && item.content === null) return parseBackupThingSnapshot(item.snapshot);
	const descriptor = item.snapshot.value as any;
	if (
		item.snapshot.adapter !== BACKUP_THING_CONTENT_ADAPTER ||
		item.snapshot.version !== 1 ||
		!descriptor ||
		Object.keys(descriptor).length !== 1 ||
		!/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
		!item.content ||
		item.content.size > BACKUP_RETAINED_PAYLOAD_BYTES
	)
		throw Error('Invalid retained Thing descriptor');
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const bytes of ranges) {
		size += bytes.length;
		if (size > BACKUP_RETAINED_PAYLOAD_BYTES) throw Error('Retained Thing exceeds its bound');
		chunks.push(bytes);
	}
	const bytes = Buffer.concat(chunks),
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	if (digest(bytes) !== descriptor.sha256) throw Error('Retained Thing digest changed');
	const snapshot = parseBackupThingSnapshot(JSON.parse(text));
	if (backupThingJson(snapshot) !== text) throw Error('Retained Thing is not canonical');
	return snapshot;
}
