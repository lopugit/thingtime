import { createHash } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { canonicalJsonBytes, parseJsonBytes } from '../../../utils/canonicalJsonStream';
import { type TimelineSnapshot } from '../../../timeline/contract';
import { timelineScopeKey } from '../../../timeline/contract';
import { isProtectedThingtime, MESSENGER_THINGTIME } from '../../../schemas/registry';
import { thingContentSnapshot, thingContentSnapshotValue } from '../timeline/recordMutation';
import { BACKUP_METADATA_BYTES, parseBackupItem, type BackupItem } from '../../../backups/manifest';
import { BACKUP_RETAINED_PAYLOAD_BYTES, retainBackupStream, verifiedBackupItemBytes, openBackupItem, type BackupObjectStore, type BackupAccess } from './portableBackup';

export const BACKUP_THING_CONTENT_ADAPTER = 'backup-thing-content';
export const BACKUP_THING_STREAM_CODEC = 'canonical-json-utf8-v1';
// Preserve the v1 serializer's exact bytes and refusal behavior for old readers.
export const BACKUP_THING_CONTENT_MAX_NODES = 100_000;
export const backupThingJson = (input: unknown) =>
	JSON.stringify(
		copyBoundedJson(
			input,
			{
				maxBytes: BACKUP_RETAINED_PAYLOAD_BYTES,
				maxDepth: 94,
				maxNodes: BACKUP_THING_CONTENT_MAX_NODES,
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
/** The canonical approved projection, independent of legacy serializer budgets.
 * No persistence conversion: the server stores inert JSON here. Local flatted
 * state (including its encoded Date/cycle representation) remains exact data. */
function streamSnapshot(input: any): TimelineSnapshot {
	if (!input || Object.keys(input).sort().join(',') !== 'adapter,value,version' || input.adapter !== 'thing-content' || input.version !== 1 ||
		!input.value || Object.keys(input.value).sort().join(',') !== 'acl,crystal,extended,folderId,geo,tags,targetId,thingtime')
		throw Error('Invalid ordinary Thing backup snapshot');
	const value = input.value;
	if (!Array.isArray(value.thingtime) || !value.thingtime.length ||
		value.thingtime.some((kind: unknown) => typeof kind !== 'string' || !kind || kind.trim() !== kind) ||
		isProtectedThingtime(value.thingtime) || value.thingtime.some((kind: string) => (MESSENGER_THINGTIME as readonly string[]).includes(kind)) ||
		value.tags === null || value.acl === null)
		throw Error('Invalid ordinary Thing backup snapshot');
	return input;
}
/** Keep legacy-valid small snapshots inline, preserving their exact bytes and
 * identity. All other ordinary content uses explicitly versioned v2 streaming.
 * Two passes over this one pinned Thing avoid serialized whole-record copies. */
export async function retainBackupThingSnapshot(store: BackupObjectStore, snapshotId: string, ordinal: number, doc: any, access: BackupAccess) {
	if (doc.ownerId !== access.scope.ownerId) throw Error('Backup Thing owner changed');
	const thingId = doc.shareId, head = doc.timelineHeadId;
	const check = () => {
		access.signal?.throwIfAborted();
		if (doc.ownerId !== access.scope.ownerId || doc.shareId !== thingId || doc.timelineHeadId !== head) throw Error('Backup Thing identity changed');
	};
	check(); await access.authorize(); check();
	const snapshot = streamSnapshot({ adapter: 'thing-content', version: 1, value: thingContentSnapshotValue(doc) });
	const hash = createHash('sha256');
	let size = 0;
	for (const bytes of canonicalJsonBytes(snapshot, check)) {
		size += bytes.length; if (!Number.isSafeInteger(size)) throw Error('Backup record size is not exactly representable');
		hash.update(bytes);
		await yieldToEventLoop(); check();
	}
	const sha256 = hash.digest('hex'), revision = head ?? 'snapshot-' + sha256;
	if (size + 2048 <= BACKUP_METADATA_BYTES) {
		// Deep content may be below the metadata size but outside v1 grammar.
		// Never silently widen that old decoder: retain it with v2 instead.
		let inline: TimelineSnapshot | undefined;
		try { inline = parseBackupThingSnapshot(snapshot); } catch { /* explicit v2 fallback */ }
		if (inline) {
			if (digest(backupThingJson(inline)) !== sha256) throw Error('Backup Thing changed from its pinned identity');
			let item: BackupItem | undefined;
			try { item = parseBackupItem({ ordinal, thingId, revision, snapshot: inline, content: null }); } catch { /* metadata has its own shallower grammar */ }
			if (item) { await access.authorize(); check(); return item; }
		}
	}
	return retainBackupStream(store, snapshotId,
		{ ordinal, thingId, revision, snapshot: { adapter: BACKUP_THING_CONTENT_ADAPTER, version: 2, value: { codec: BACKUP_THING_STREAM_CODEC, sha256 } } },
		{ size, sha256, bytes: canonicalJsonBytes(snapshot, check) }, access);
}

/** Streaming recovery shared by selected-item reads and account-restore scans.
 * Verify both retained multipart identity and canonical payload SHA before
 * returning the one materialized Thing. No record-size or node processing cap. */
export async function readBackupThingStream(item: BackupItem, bytes: AsyncIterable<Uint8Array>, check: () => void = () => {}): Promise<TimelineSnapshot> {
	const descriptor = item.snapshot.value as any;
	if (item.snapshot.adapter !== BACKUP_THING_CONTENT_ADAPTER || item.snapshot.version !== 2 || !item.content ||
		!descriptor || Object.keys(descriptor).sort().join(',') !== 'codec,sha256' || descriptor.codec !== BACKUP_THING_STREAM_CODEC ||
		typeof descriptor.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw Error('Invalid streamed Thing descriptor');
	const hash = createHash('sha256');
	const snapshot = streamSnapshot(await parseJsonBytes((async function* () {
		for await (const chunk of verifiedBackupItemBytes(item, bytes)) { check(); hash.update(chunk); yield chunk; }
	})(), check));
	if (hash.digest('hex') !== descriptor.sha256) throw Error('Retained Thing digest changed');
	const canonical = createHash('sha256');
	for (const chunk of canonicalJsonBytes(snapshot, check)) { canonical.update(chunk); await yieldToEventLoop(); }
	check();
	if (canonical.digest('hex') !== descriptor.sha256) throw Error('Retained Thing is not canonical');
	return snapshot;
}
export async function openBackupThingSnapshot(
	store: BackupObjectStore,
	snapshotId: string,
	thingId: string,
	access: BackupAccess
): Promise<TimelineSnapshot> {
	const scope = timelineScopeKey(access.scope);
	const { item, ranges } = await openBackupItem(store, snapshotId, thingId, access);
	if (item.snapshot.adapter === BACKUP_THING_CONTENT_ADAPTER && item.snapshot.version === 2) {
		const check = () => { access.signal?.throwIfAborted(); if (timelineScopeKey(access.scope) !== scope) throw Error('Backup account or origin changed'); };
		const snapshot = await readBackupThingStream(item, ranges, check);
		await access.authorize(); check();
		return snapshot;
	}
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
