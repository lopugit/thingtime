import { copyBoundedJson, type JsonValue } from '../utils/boundedJson';
import { timelineScopeKey, type TimelineScope, type TimelineSnapshot } from '../timeline/contract';
import { validContentFingerprint, type ContentFingerprint } from '../fileSync/contentFingerprint';

export const BACKUP_FORMAT = 'thingtime-backup-v1';
export const BACKUP_CHUNK_BYTES = 8 * 1024 * 1024;
export const BACKUP_PAGE_ITEMS = 128;
export const BACKUP_METADATA_BYTES = 128 * 1024;
export const BACKUP_PAGE_BYTES = 4 * 1024 * 1024;
export const BACKUP_TIMELINE_ADAPTER = 'backup-snapshot';

/** A source service supplies an immutable inventory boundary. A capture interval
 * must not be presented as an atomic point in time. This format does not create
 * that boundary or prove an inventory is complete; the producer must do both. */
export type BackupHeader = {
	format: typeof BACKUP_FORMAT;
	snapshotId: string;
	scope: TimelineScope;
	boundary: { kind: 'point-in-time' | 'capture-interval'; token: string; startedAt: string; completedAt: string };
	coverage: { selectionId: string; description: string };
};
/** Original placement is descriptive metadata. Restorers must map it through
 * their destination's path/ACL rules, never concatenate it into a disk path. */
export type BackupItem = {
	ordinal: number;
	thingId: string;
	revision: string;
	snapshot: TimelineSnapshot;
	content: { size: number; fingerprint: ContentFingerprint | null } | null;
};
export type BackupPage = { format: typeof BACKUP_FORMAT; snapshotId: string; ordinal: number; previous: string | null; items: BackupItem[] };
export type BackupPlan = {
	format: typeof BACKUP_FORMAT;
	snapshotId: string;
	headerHash: string;
	pages: number;
	headHash: string | null;
	items: number;
	bytes: string;
};
export type BackupRange = { offset: number; length: number; sha256: string };
export type BackupRangePage = { format: typeof BACKUP_FORMAT; snapshotId: string; item: number; ordinal: number; ranges: BackupRange[] };
export type BackupSeal = BackupPlan & { manifestHash: string; chunks: string };

export const backupDigest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const backupId = (v: unknown): v is string =>
	typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const decimal = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function exact(v: any, fields: string[]) {
	if (
		!v ||
		typeof v !== 'object' ||
		Array.isArray(v) ||
		Object.keys(v).length !== fields.length ||
		fields.some((k) => !Object.prototype.hasOwnProperty.call(v, k))
	)
		throw Error('Invalid backup fields');
}
export function backupJson(value: unknown, maxBytes = BACKUP_PAGE_BYTES): string {
	return JSON.stringify(copyBoundedJson(value, { maxBytes, maxDepth: 64, maxNodes: 200_000, sortKeys: true }, 'Backup metadata'));
}
export function parseBackupHeader(input: unknown): BackupHeader {
	const v = JSON.parse(backupJson(input, BACKUP_METADATA_BYTES));
	exact(v, ['format', 'snapshotId', 'scope', 'boundary', 'coverage']);
	exact(v.scope, ['ownerId', 'apiOrigin', 'dataPlane']);
	timelineScopeKey(v.scope);
	exact(v.boundary, ['kind', 'token', 'startedAt', 'completedAt']);
	exact(v.coverage, ['selectionId', 'description']);
	if (
		v.format !== BACKUP_FORMAT ||
		!backupId(v.snapshotId) ||
		!['point-in-time', 'capture-interval'].includes(v.boundary.kind) ||
		!identifier(v.boundary.token) ||
		!timestamp(v.boundary.startedAt) ||
		!timestamp(v.boundary.completedAt) ||
		v.boundary.completedAt < v.boundary.startedAt ||
		(v.boundary.kind === 'point-in-time' && v.boundary.startedAt !== v.boundary.completedAt) ||
		!identifier(v.coverage.selectionId) ||
		typeof v.coverage.description !== 'string' ||
		!v.coverage.description.trim() ||
		v.coverage.description.length > 1000
	)
		throw Error('Invalid backup header');
	return v;
}
export function parseBackupItem(input: unknown): BackupItem {
	const v = JSON.parse(backupJson(input, BACKUP_METADATA_BYTES));
	exact(v, ['ordinal', 'thingId', 'revision', 'snapshot', 'content']);
	exact(v.snapshot, ['adapter', 'version', 'value']);
	if (
		!integer(v.ordinal) ||
		!identifier(v.thingId) ||
		!identifier(v.revision) ||
		!identifier(v.snapshot.adapter) ||
		!integer(v.snapshot.version) ||
		v.snapshot.version < 1
	)
		throw Error('Invalid backup item');
	if (v.content !== null) {
		exact(v.content, ['size', 'fingerprint']);
		if (v.content.size === 0) {
			if (v.content.fingerprint !== null) throw Error('Empty backup files have no multipart fingerprint');
		} else {
			exact(v.content.fingerprint, ['algorithm', 'partSizeBytes', 'partCount', 'sha256']);
			if (!validContentFingerprint(v.content.fingerprint, v.content.size)) throw Error('Invalid backup content');
		}
	}
	return v;
}
export function parseBackupPage(input: unknown): BackupPage {
	const v = JSON.parse(backupJson(input));
	exact(v, ['format', 'snapshotId', 'ordinal', 'previous', 'items']);
	if (
		v.format !== BACKUP_FORMAT ||
		!backupId(v.snapshotId) ||
		!integer(v.ordinal) ||
		(v.previous !== null && !backupDigest(v.previous)) ||
		!Array.isArray(v.items) ||
		!v.items.length ||
		v.items.length > BACKUP_PAGE_ITEMS
	)
		throw Error('Invalid backup page');
	return { ...v, items: v.items.map(parseBackupItem) };
}
export function parseBackupPlan(input: unknown): BackupPlan {
	const v = JSON.parse(backupJson(input, BACKUP_METADATA_BYTES));
	exact(v, ['format', 'snapshotId', 'headerHash', 'pages', 'headHash', 'items', 'bytes']);
	if (
		v.format !== BACKUP_FORMAT ||
		!backupId(v.snapshotId) ||
		!backupDigest(v.headerHash) ||
		!integer(v.pages) ||
		!integer(v.items) ||
		!decimal(v.bytes) ||
		(v.pages === 0
			? v.headHash !== null || v.items !== 0 || v.bytes !== '0'
			: !backupDigest(v.headHash) || v.items < v.pages || v.items > v.pages * BACKUP_PAGE_ITEMS)
	)
		throw Error('Invalid backup plan');
	return v;
}
export function parseBackupRangePage(input: unknown): BackupRangePage {
	const v = JSON.parse(backupJson(input, BACKUP_METADATA_BYTES));
	exact(v, ['format', 'snapshotId', 'item', 'ordinal', 'ranges']);
	if (
		v.format !== BACKUP_FORMAT ||
		!backupId(v.snapshotId) ||
		!integer(v.item) ||
		!integer(v.ordinal) ||
		!Array.isArray(v.ranges) ||
		!v.ranges.length ||
		v.ranges.length > BACKUP_PAGE_ITEMS
	)
		throw Error('Invalid backup ranges');
	for (const range of v.ranges) {
		exact(range, ['offset', 'length', 'sha256']);
		if (!integer(range.offset) || !integer(range.length) || !range.length || range.length > BACKUP_CHUNK_BYTES || !backupDigest(range.sha256))
			throw Error('Invalid backup range');
	}
	return v;
}
export function parseBackupSeal(input: unknown): BackupSeal {
	const v = JSON.parse(backupJson(input, BACKUP_METADATA_BYTES));
	exact(v, ['format', 'snapshotId', 'headerHash', 'pages', 'headHash', 'items', 'bytes', 'manifestHash', 'chunks']);
	const { manifestHash, chunks, ...plan } = v;
	if (!backupDigest(manifestHash) || !decimal(chunks)) throw Error('Invalid backup seal');
	return { ...parseBackupPlan(plan), manifestHash, chunks };
}
/** Same small descriptor can live in canonical local/remote Timeline snapshots.
 * Consumers must validate the server provenance and current access separately. */
export function backupTimelineSnapshot(input: BackupSeal): TimelineSnapshot {
	return { adapter: BACKUP_TIMELINE_ADAPTER, version: 1, value: parseBackupSeal(input) as unknown as JsonValue };
}
