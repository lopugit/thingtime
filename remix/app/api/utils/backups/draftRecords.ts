import { createHash } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { validateDraftContent, validDraftId, type AccountDraft } from '../../../drafts/draftCore';
import { type BackupAttachment } from './attachmentRecords';
import { openBackupItem, retainBackupPayload, type BackupAccess, type BackupObjectStore } from './portableBackup';

export const BACKUP_DRAFT_ADAPTER = 'backup-draft';
// The canonical snapshot string is at most 512 KiB. JSON escaping plus 4096
// attachment IDs needs a larger envelope, still bounded independently of files.
export const BACKUP_DRAFT_BYTES = 4 * 1024 * 1024;
type DraftIdentity = Pick<AccountDraft, 'id' | 'mode' | 'revision' | 'createdAt' | 'updatedAt'>;
type DraftEnvelope = { ownerId: string; writeId: string | null; source: { kind: 'template' | 'post' | 'draft'; id: string } | null };
export type BackupDraft = DraftEnvelope & ({ deleted: false; value: AccountDraft } | { deleted: true; value: DraftIdentity });
export const backupDraftProjection = {
	_id: 0,
	shareId: 1,
	ownerId: 1,
	thingtime: 1,
	crystal: 1,
	draftMode: 1,
	draftRevision: 1,
	draftWriteId: 1,
	draftDeleted: 1,
	draftSource: 1,
	createdAt: 1,
	updatedAt: 1
};
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const sourceDate = (value: unknown) => {
	if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
	if (date(value)) return value;
	throw Error('Invalid draft source date');
};
const exact = (v: any, keys: string[]) => {
	if (
		!v ||
		typeof v !== 'object' ||
		Array.isArray(v) ||
		Object.keys(v).length !== keys.length ||
		keys.some((k) => !Object.prototype.hasOwnProperty.call(v, k))
	)
		throw Error('Invalid archived draft fields');
};
export const backupDraftJson = (value: unknown) =>
	JSON.stringify(copyBoundedJson(value, { maxBytes: BACKUP_DRAFT_BYTES, maxDepth: 8, maxNodes: 9000, sortKeys: true }, 'Archived draft'));
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
/** Preserve the existing AccountDraft and its opaque editor snapshot exactly.
 * Deleted records remain revision tombstones; they are never active templates. */
export function parseBackupDraft(input: unknown): BackupDraft {
	const record = JSON.parse(backupDraftJson(input));
	exact(record, ['ownerId', 'deleted', 'value', 'writeId', 'source']);
	if (!id(record.ownerId) || typeof record.deleted !== 'boolean' || (record.writeId !== null && !validDraftId(record.writeId)))
		throw Error('Invalid archived draft identity');
	if (record.source !== null) {
		exact(record.source, ['kind', 'id']);
		if (
			!['template', 'post', 'draft'].includes(record.source.kind) ||
			!(record.source.kind === 'post' ? id(record.source.id) : validDraftId(record.source.id))
		)
			throw Error('Invalid archived draft source');
	}
	const value = record.value;
	exact(value, [
		'id',
		'mode',
		'revision',
		'createdAt',
		'updatedAt',
		...(record.deleted ? [] : ['name', 'surface', 'context', 'snapshot', 'attachmentIds'])
	]);
	if (
		!validDraftId(value.id) ||
		!['draft', 'template'].includes(value.mode) ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 1 ||
		!date(value.createdAt) ||
		!date(value.updatedAt) ||
		value.updatedAt < value.createdAt
	)
		throw Error('Invalid archived draft revision');
	if (!record.deleted) validateDraftContent(value);
	return record;
}
export function backupDraftFromDoc(doc: any): BackupDraft {
	if (
		!doc ||
		!Array.isArray(doc.thingtime) ||
		doc.thingtime.length !== 1 ||
		doc.thingtime[0] !== 'draft' ||
		(doc.draftDeleted != null && typeof doc.draftDeleted !== 'boolean')
	)
		throw Error('Invalid draft inventory family');
	if (doc.draftDeleted === true) exact(doc.crystal, []);
	else exact(doc.crystal, ['name', 'surface', 'context', 'snapshot', 'attachmentIds']);
	return parseBackupDraft({
		ownerId: doc.ownerId,
		deleted: doc.draftDeleted === true,
		writeId: doc.draftWriteId ?? null,
		source: doc.draftSource ?? null,
		value: {
			...(doc.draftDeleted === true ? {} : validateDraftContent(doc.crystal)),
			id: doc.shareId,
			mode: doc.draftMode,
			revision: doc.draftRevision,
			createdAt: sourceDate(doc.createdAt),
			updatedAt: sourceDate(doc.updatedAt)
		}
	});
}
export type BackupDraftAttachmentReference = { ownerId: string; draftId: string; attachmentId: string; purpose: 'comment' | 'post' };
export function backupDraftAttachmentReferences(record: BackupDraft): BackupDraftAttachmentReference[] {
	if (record.deleted !== false) return [];
	const value = record.value;
	return value.attachmentIds.map((attachmentId) => ({
		ownerId: record.ownerId,
		draftId: value.id,
		attachmentId,
		purpose: value.surface === 'comment' ? 'comment' : 'post'
	}));
}
export function verifyBackupDraftAttachment(ref: BackupDraftAttachmentReference, attachment: BackupAttachment) {
	if (
		ref.attachmentId !== attachment.id ||
		ref.ownerId !== attachment.ownerId ||
		attachment.purpose !== ref.purpose ||
		attachment.profileSlot !== null ||
		(attachment.snapshot.value as any).targetId !== ref.draftId
	)
		throw Error('Draft attachment is missing or changed');
}
export async function retainBackupDraft(store: BackupObjectStore, snapshotId: string, ordinal: number, record: BackupDraft, access: BackupAccess) {
	const canonical = parseBackupDraft(record),
		text = backupDraftJson(canonical),
		sha256 = digest(text);
	if (canonical.ownerId !== access.scope.ownerId) throw Error('Draft backup owner changed');
	return retainBackupPayload(
		store,
		snapshotId,
		{
			ordinal,
			thingId: canonical.value.id,
			revision: 'draft-' + canonical.value.revision,
			snapshot: { adapter: BACKUP_DRAFT_ADAPTER, version: 1, value: { sha256, mode: canonical.value.mode, deleted: canonical.deleted } }
		},
		Buffer.from(text),
		access
	);
}
/** Offline content recovery only. This grants no server write/retry authority;
 * importing a draft must use the current draft API and fresh conflict checks. */
export async function openBackupDraft(store: BackupObjectStore, snapshotId: string, thingId: string, access: BackupAccess): Promise<BackupDraft> {
	const { item, ranges } = await openBackupItem(store, snapshotId, thingId, access),
		descriptor = item.snapshot.value as any;
	exact(descriptor, ['sha256', 'mode', 'deleted']);
	if (
		item.snapshot.adapter !== BACKUP_DRAFT_ADAPTER ||
		item.snapshot.version !== 1 ||
		!/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
		!['draft', 'template'].includes(descriptor.mode) ||
		typeof descriptor.deleted !== 'boolean' ||
		!item.content ||
		item.content.size > BACKUP_DRAFT_BYTES
	)
		throw Error('Invalid archived draft descriptor');
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const bytes of ranges) {
		size += bytes.length;
		if (size > BACKUP_DRAFT_BYTES) throw Error('Archived draft exceeds its bound');
		chunks.push(bytes);
	}
	const bytes = Buffer.concat(chunks),
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	if (digest(bytes) !== descriptor.sha256) throw Error('Archived draft digest changed');
	const record = parseBackupDraft(JSON.parse(text));
	if (
		backupDraftJson(record) !== text ||
		record.value.id !== thingId ||
		record.ownerId !== access.scope.ownerId ||
		item.revision !== 'draft-' + record.value.revision ||
		record.deleted !== descriptor.deleted ||
		record.value.mode !== descriptor.mode
	)
		throw Error('Archived draft identity changed');
	return record;
}
