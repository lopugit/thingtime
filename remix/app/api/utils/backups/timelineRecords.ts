import { createHash } from 'node:crypto';
import { parseBackupItem, type BackupItem } from '../../../backups/manifest';
import { timelineScopeKey } from '../../../timeline/contract';
import { copyBoundedJson, type JsonValue } from '../../../utils/boundedJson';
import {
	TIMELINE_EVENT_KIND,
	TIMELINE_LINK_KIND,
	TIMELINE_EVENT_MAX_BYTES,
	parseTimelineEntry,
	parseTimelineReceipt
} from '../../../timeline/contract';
import { parseTimelineEventRecord, parseTimelineLink } from '../../../timeline/records';
import { TIMELINE_BRANCH_KIND, TIMELINE_BRANCH_HEAD_KIND, parseTimelineBranch, parseTimelineBranchHead } from '../../../timeline/branches';
import { TIMELINE_SNAPSHOT_PART_KIND, parseTimelineSnapshotPart } from '../../../timeline/snapshotParts';
import { TIMELINE_NOTE_KIND, parseTimelineNote } from '../../../timeline/notes';
import { TIMELINE_VERSION_NAME_KIND, parseTimelineVersionName } from '../../../timeline/versionNames';
import { readTimelineEnvelope, unpackTimelineLink } from '../timeline/envelope';
import { timelineEventThingId, timelineLinkThingId, timelineLinkTargetKey } from '../timeline/repository';
import { branchFromDoc, branchHeadFromDoc, timelineBranchThingId, timelineBranchHeadThingId } from '../timeline/branchEnvelope';
import { timelineSnapshotPartFromDoc, timelineSnapshotPartThingId } from '../timeline/snapshotParts';
import { noteFromDoc, timelineNoteThingId } from '../timeline/notes';
import { versionNameFromDoc, timelineVersionNameThingId } from '../timeline/versionNames';
import { openBackupItem, retainBackupPayload, type BackupAccess, type BackupObjectStore } from './portableBackup';

export const BACKUP_TIMELINE_RECORD_ADAPTER = 'backup-timeline-record';
export const BACKUP_TIMELINE_RECORD_BYTES = TIMELINE_EVENT_MAX_BYTES + 16 * 1024;
export const ACCOUNT_TIMELINE_KINDS = [
	TIMELINE_EVENT_KIND,
	TIMELINE_LINK_KIND,
	TIMELINE_BRANCH_KIND,
	TIMELINE_BRANCH_HEAD_KIND,
	TIMELINE_SNAPSHOT_PART_KIND,
	TIMELINE_NOTE_KIND,
	TIMELINE_VERSION_NAME_KIND
] as const;
export type BackupTimelineRecord = { kind: (typeof ACCOUNT_TIMELINE_KINDS)[number]; value: JsonValue };
export const isAccountTimelineKind = (kind: string) => (ACCOUNT_TIMELINE_KINDS as readonly string[]).includes(kind);
// Read secure ONLY for these dedicated history families. Do not reuse for auth,
// device keys, managed attachment envelopes or arbitrary protected Things.
export const timelineBackupProjection = {
	_id: 0,
	shareId: 1,
	ownerId: 1,
	thingtime: 1,
	targetId: 1,
	parentId: 1,
	createdAt: 1,
	updatedAt: 1,
	secure: 1,
	timelineEnvelopeVersion: 1,
	timelineLinkVersion: 1,
	timelineBranchVersion: 1,
	branchRevision: 1,
	timelineSnapshotPartVersion: 1,
	timelineNoteVersion: 1,
	timelineVersionNameVersion: 1,
	timelineVersionNameCleared: 1,
	nameRevision: 1,
	'crystal.name': 1,
	'crystal.targetId': 1,
	'crystal.linkKind': 1
};
const exact = (value: any, keys: string[]) => {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== keys.length ||
		keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
	)
		throw Error('Invalid archived Timeline fields');
};
const date = (value: unknown): value is string =>
	typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
export const timelineBackupJson = (value: unknown) =>
	JSON.stringify(
		copyBoundedJson(value, { maxBytes: BACKUP_TIMELINE_RECORD_BYTES, maxDepth: 104, maxNodes: 220_000, sortKeys: true }, 'Archived Timeline record')
	);

/** The value is the existing canonical record, not its private Mongo envelope.
 * Legacy event aggregates retain their existing canonical shape. A cleared name
 * has no content record; its bounded revision tombstone is retained explicitly. */
export function parseBackupTimelineRecord(input: unknown): BackupTimelineRecord {
	const result = JSON.parse(timelineBackupJson(input));
	exact(result, ['kind', 'value']);
	const value = result.value;
	switch (result.kind) {
		case TIMELINE_EVENT_KIND: {
			exact(value, ['event', 'receipt']);
			if (Object.prototype.hasOwnProperty.call(value.event ?? {}, 'parentCount')) {
				parseTimelineEventRecord(value.event);
				const receipt = parseTimelineReceipt(value.receipt);
				if (receipt.ownerId !== value.event.ownerId || receipt.eventId !== value.event.id) throw Error('Archived Timeline receipt changed');
			} else parseTimelineEntry(value);
			break;
		}
		case TIMELINE_LINK_KIND:
			parseTimelineLink(value);
			break;
		case TIMELINE_BRANCH_KIND:
			parseTimelineBranch(value);
			break;
		case TIMELINE_BRANCH_HEAD_KIND:
			parseTimelineBranchHead(value);
			break;
		case TIMELINE_SNAPSHOT_PART_KIND:
			parseTimelineSnapshotPart(value);
			break;
		case TIMELINE_NOTE_KIND:
			parseTimelineNote(value);
			break;
		case TIMELINE_VERSION_NAME_KIND:
			if (value?.cleared === false) {
				exact(value, ['cleared', 'name']);
				parseTimelineVersionName(value.name);
			} else {
				exact(value, ['cleared', 'ownerId', 'eventThingId', 'revision', 'createdAt', 'updatedAt']);
				if (
					value.cleared !== true ||
					!identifier(value.ownerId) ||
					!/^timeline-event-[a-f0-9]{64}$/.test(value.eventThingId) ||
					!Number.isSafeInteger(value.revision) ||
					value.revision < 1 ||
					!date(value.createdAt) ||
					!date(value.updatedAt) ||
					value.updatedAt < value.createdAt
				)
					throw Error('Invalid archived version-name tombstone');
			}
			break;
		default:
			throw Error('Unsupported archived Timeline kind');
	}
	return result;
}
export function backupTimelineIdentity(record: BackupTimelineRecord) {
	const value = record.value as any;
	switch (record.kind) {
		case TIMELINE_EVENT_KIND:
			return { ownerId: value.event.ownerId, thingId: timelineEventThingId(value.event.ownerId, value.event.id) };
		case TIMELINE_LINK_KIND:
			return { ownerId: value.ownerId, thingId: timelineLinkThingId(value.ownerId, value.id) };
		case TIMELINE_BRANCH_KIND:
			return { ownerId: value.ownerId, thingId: timelineBranchThingId(value.ownerId, value.id) };
		case TIMELINE_BRANCH_HEAD_KIND:
			return { ownerId: value.ownerId, thingId: timelineBranchHeadThingId(value.ownerId, value.branchId, value.thingId) };
		case TIMELINE_SNAPSHOT_PART_KIND:
			return { ownerId: value.ownerId, thingId: timelineSnapshotPartThingId(value.ownerId, value.id) };
		case TIMELINE_NOTE_KIND:
			return { ownerId: value.ownerId, thingId: timelineNoteThingId(value.ownerId, value.id) };
		case TIMELINE_VERSION_NAME_KIND:
			return value.cleared
				? { ownerId: value.ownerId, thingId: value.eventThingId.replace('timeline-event-', 'timeline-version-name-') }
				: { ownerId: value.name.ownerId, thingId: timelineVersionNameThingId(value.name.ownerId, value.name.eventId) };
	}
}
export function timelineBackupRecordFromDoc(doc: any): BackupTimelineRecord {
	if (!Array.isArray(doc.thingtime) || doc.thingtime.length !== 1 || !isAccountTimelineKind(doc.thingtime[0]))
		throw Error('Invalid Timeline inventory family');
	const kind = doc.thingtime[0];
	let value: any;
	switch (kind) {
		case TIMELINE_EVENT_KIND:
			value = readTimelineEnvelope(doc);
			if (doc.targetId !== value.event.thingId || new Date(doc.createdAt).getTime() !== value.receipt.position)
				throw Error('Timeline record envelope changed');
			break;
		case TIMELINE_LINK_KIND:
			value = unpackTimelineLink(doc);
			if (
				doc.targetId !== timelineEventThingId(value.ownerId, value.eventId) ||
				doc.crystal?.targetId !== timelineLinkTargetKey(value) ||
				doc.crystal?.linkKind !== value.relation
			)
				throw Error('Timeline link envelope changed');
			break;
		case TIMELINE_BRANCH_KIND:
			value = branchFromDoc(doc);
			break;
		case TIMELINE_BRANCH_HEAD_KIND:
			value = branchHeadFromDoc(doc);
			break;
		case TIMELINE_SNAPSHOT_PART_KIND:
			value = timelineSnapshotPartFromDoc(doc);
			break;
		case TIMELINE_NOTE_KIND:
			value = noteFromDoc(doc);
			break;
		case TIMELINE_VERSION_NAME_KIND:
			if (doc.timelineVersionNameCleared === true) {
				if (
					doc.secure != null ||
					doc.timelineVersionNameVersion != null ||
					doc.crystal?.name !== 'Version name' ||
					doc.crystal?.targetId !== doc.targetId ||
					doc.crystal?.linkKind !== kind
				)
					throw Error('Version-name tombstone envelope changed');
				value = {
					cleared: true,
					ownerId: doc.ownerId,
					eventThingId: doc.targetId,
					revision: doc.nameRevision,
					createdAt: new Date(doc.createdAt).toISOString(),
					updatedAt: new Date(doc.updatedAt).toISOString()
				};
			} else value = { cleared: false, name: versionNameFromDoc(doc) };
	}
	const record = parseBackupTimelineRecord({ kind, value }),
		identity = backupTimelineIdentity(record);
	if (identity.ownerId !== doc.ownerId || identity.thingId !== doc.shareId) throw Error('Timeline inventory identity changed');
	return record;
}
export async function retainTimelineBackupRecord(store: BackupObjectStore, snapshotId: string, ordinal: number, doc: any, access: BackupAccess) {
	const ownerId = doc.ownerId, thingId = doc.shareId, scopeKey = timelineScopeKey(access.scope);
	const check = () => { access.signal?.throwIfAborted(); if (doc.ownerId !== ownerId || doc.shareId !== thingId || ownerId !== access.scope.ownerId || timelineScopeKey(access.scope) !== scopeKey) throw Error('Timeline backup identity changed'); };
	check(); await access.authorize(); check();
	const record = timelineBackupRecordFromDoc(doc),
		text = timelineBackupJson(record),
		sha256 = createHash('sha256').update(text).digest('hex');
	if (backupTimelineIdentity(record).ownerId !== access.scope.ownerId) throw Error('Timeline backup owner changed');
	// Explicit adapter v2 keeps canonical small records inside the already
	// bounded manifest item. Deep/large records retain the exact v1 payload
	// representation; no source record is rejected to fit this optimization.
	let inline: BackupItem | undefined;
	try { inline = parseBackupItem({ ordinal, thingId, revision: 'snapshot-' + sha256,
		snapshot: { adapter: BACKUP_TIMELINE_RECORD_ADAPTER, version: 2, value: { kind: record.kind, sha256, record } }, content: null }); }
	catch { /* retain the established v1 byte-stream representation */ }
	if (inline) { await access.authorize(); check(); return inline; }
	return retainBackupPayload(
		store,
		snapshotId,
		{
			ordinal,
			thingId: doc.shareId,
			revision: 'snapshot-' + sha256,
			snapshot: { adapter: BACKUP_TIMELINE_RECORD_ADAPTER, version: 1, value: { kind: record.kind, sha256 } }
		},
		Buffer.from(text),
		access
	);
}
/** Inline adapter version is separate from the retained v1 descriptor. The
 * canonical record SHA and owner/Thing identity are checked by every reader. */
export function parseInlineBackupTimelineRecord(input: BackupItem, ownerId: string): BackupTimelineRecord {
 const item = parseBackupItem(input), descriptor = item.snapshot.value as any;
 if (item.snapshot.adapter !== BACKUP_TIMELINE_RECORD_ADAPTER || item.snapshot.version !== 2 || item.content !== null)
  throw Error('Invalid inline Timeline descriptor');
 exact(descriptor,['kind','sha256','record']);
 const record=parseBackupTimelineRecord(descriptor.record), identity=backupTimelineIdentity(record), text=timelineBackupJson(record);
 if (!isAccountTimelineKind(descriptor.kind) || record.kind!==descriptor.kind ||
  createHash('sha256').update(text).digest('hex')!==descriptor.sha256 || item.revision!=='snapshot-'+descriptor.sha256 ||
  identity.ownerId!==ownerId || identity.thingId!==item.thingId) throw Error('Inline Timeline identity or digest changed');
 return record;
}
/** Reads a verified offline copy. This does not authorize replay of server
 * receipts or replace current Timeline state; import still needs a reviewed writer. */
export async function openBackupTimelineRecord(
	store: BackupObjectStore,
	snapshotId: string,
	thingId: string,
	access: BackupAccess
): Promise<BackupTimelineRecord> {
	const { item, ranges } = await openBackupItem(store, snapshotId, thingId, access);
	if (item.snapshot.adapter === BACKUP_TIMELINE_RECORD_ADAPTER && item.snapshot.version === 2) return parseInlineBackupTimelineRecord(item, access.scope.ownerId);
	const descriptor = item.snapshot.value as any;
	exact(descriptor, ['kind', 'sha256']);
	if (
		item.snapshot.adapter !== BACKUP_TIMELINE_RECORD_ADAPTER ||
		item.snapshot.version !== 1 ||
		!isAccountTimelineKind(descriptor.kind) ||
		!/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
		item.revision !== 'snapshot-' + descriptor.sha256 ||
		!item.content ||
		item.content.size > BACKUP_TIMELINE_RECORD_BYTES
	)
		throw Error('Invalid archived Timeline descriptor');
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const bytes of ranges) {
		size += bytes.length;
		if (size > BACKUP_TIMELINE_RECORD_BYTES) throw Error('Archived Timeline record exceeds its bound');
		chunks.push(bytes);
	}
	const bytes = Buffer.concat(chunks),
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	if (createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw Error('Archived Timeline record digest changed');
	const record = parseBackupTimelineRecord(JSON.parse(text)),
		identity = backupTimelineIdentity(record);
	if (
		timelineBackupJson(record) !== text ||
		record.kind !== descriptor.kind ||
		identity.thingId !== thingId ||
		identity.ownerId !== access.scope.ownerId
	)
		throw Error('Archived Timeline identity changed');
	return record;
}
