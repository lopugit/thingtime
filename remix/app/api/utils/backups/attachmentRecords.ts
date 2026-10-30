import { createHash } from 'node:crypto';
import { type TimelineSnapshot } from '../../../timeline/contract';
import { parseCloudFile, type CloudFileContent } from '../../../fileSync/cloudFile';
import { validContentFingerprint, equalContentFingerprints } from '../../../fileSync/contentFingerprint';
import { backupJson, parseBackupItem, type BackupItem, BACKUP_METADATA_BYTES } from '../../../backups/manifest';
import {
	canonicalAttachmentCrystal,
	attachmentObjectSizeBytesForAccounting,
	isAttachmentObjectVersionId,
	isAttachmentPurpose,
	isAttachmentProfileSlot,
	type AttachmentPurpose,
	type ProfileAttachmentSlot
} from '../attachments/attachmentCore';
import { attachmentContentVersion, fingerprintFromVerifiedHead } from '../attachments/contentFingerprint';
import { type AttachmentObjectHead } from '../attachments/privateS3';
import { thingContentSnapshot } from '../timeline/recordMutation';

export const BACKUP_ATTACHMENT_ADAPTER = 'backup-attachment';
export const backupAttachmentProjection = {
	_id: 0,
	shareId: 1,
	ownerId: 1,
	thingtime: 1,
	crystal: 1,
	extended: 1,
	tags: 1,
	acl: 1,
	folderId: 1,
	targetId: 1,
	geo: 1,
	attachmentEnvelopeVersion: 1,
	attachmentState: 1,
	objectSizeBytes: 1,
	objectKey: 1,
	objectVersionId: 1,
	attachmentPurpose: 1,
	attachmentProfileSlot: 1,
	attachmentLinked: 1,
	attachmentExpiresAt: 1,
	attachmentImportDraft: 1,
	attachmentRequestFingerprint: 1,
	attachmentFinalizationLeaseId: 1,
	attachmentPartsIssuedAt: 1,
	attachmentObjectlessDelete: 1,
	attachmentMpuEmptyVerifiedAt: 1,
	uploadId: 1,
	attachmentSortIndex: 1,
	moderation: 1,
	appId: 1,
	sandbox: 1,
	sandboxSpace: 1
};
export type BackupAttachment = {
	id: string;
	ownerId: string;
	purpose: AttachmentPurpose | null;
	profileSlot: ProfileAttachmentSlot | null;
	linked: boolean;
	sortIndex: number | null;
	moderation: 'pending' | 'nsfw' | null;
	snapshot: TimelineSnapshot;
	content: CloudFileContent | null;
};
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const exact = (v: any, keys: string[]) => {
	if (
		!v ||
		typeof v !== 'object' ||
		Array.isArray(v) ||
		Object.keys(v).length !== keys.length ||
		keys.some((k) => !Object.prototype.hasOwnProperty.call(v, k))
	)
		throw Error('Invalid backup attachment fields');
};
/** Descriptive content only. Private object keys, upload credentials and live
 * server authority are not part of the portable attachment record. */
export function parseBackupAttachment(input: unknown): BackupAttachment {
	const v = JSON.parse(backupJson(input, BACKUP_METADATA_BYTES));
	exact(v, ['id', 'ownerId', 'purpose', 'profileSlot', 'linked', 'sortIndex', 'moderation', 'snapshot', 'content']);
	if (
		!id(v.id) ||
		!id(v.ownerId) ||
		(v.purpose !== null && !isAttachmentPurpose(v.purpose)) ||
		(v.purpose === 'profile' ? !isAttachmentProfileSlot(v.profileSlot) : v.profileSlot !== null) ||
		typeof v.linked !== 'boolean' ||
		(v.sortIndex !== null && (!Number.isSafeInteger(v.sortIndex) || v.sortIndex < 0)) ||
		![null, 'pending', 'nsfw'].includes(v.moderation)
	)
		throw Error('Invalid backup attachment identity');
	exact(v.snapshot, ['adapter', 'version', 'value']);
	if (v.snapshot.adapter !== 'thing-content' || v.snapshot.version !== 1) throw Error('Invalid backup attachment metadata');
	const value = v.snapshot.value;
	exact(value, ['thingtime', 'crystal', 'extended', 'tags', 'acl', 'folderId', 'targetId', 'geo']);
	if (
		!Array.isArray(value.thingtime) ||
		value.thingtime.length !== 1 ||
		value.thingtime[0] !== 'attachment' ||
		!canonicalAttachmentCrystal(value.crystal) ||
		(value.folderId !== null && !id(value.folderId)) ||
		(value.targetId !== null && !id(value.targetId))
	)
		throw Error('Invalid backup attachment content');
	if (v.linked) {
		if (!value.crystal.url || v.content !== null) throw Error('Linked backup attachments have no stored bytes');
	} else {
		exact(v.content, ['attachmentId', 'version', 'size', 'fingerprint']);
		if (
			value.crystal.url ||
			v.content.attachmentId !== v.id ||
			!/^[a-f0-9]{64}$/.test(v.content.version) ||
			v.content.size !== value.crystal.size ||
			!validContentFingerprint(v.content.fingerprint, v.content.size)
		)
			throw Error('Invalid backup attachment bytes');
	}
	return v;
}

/** Called only on an owner-filtered row from the fixed database snapshot. The
 * source object version must already be finalized; backup never repairs it by
 * reading an unpinned latest version or mutating the source. */
export function validateBackupAttachmentDoc(doc: any, ownerId: string, snapshotAt: number) {
	if (
		!doc ||
		doc.ownerId !== ownerId ||
		!id(doc.shareId) ||
		!Array.isArray(doc.thingtime) ||
		doc.thingtime.length !== 1 ||
		doc.thingtime[0] !== 'attachment' ||
		doc.attachmentState !== 'ready' ||
		attachmentObjectSizeBytesForAccounting(doc) === null ||
		doc.appId != null ||
		doc.sandbox != null ||
		doc.sandboxSpace != null ||
		doc.moderation?.status === 'blocked'
	)
		throw Error('Attachment needs an available canonical owner export');
	const durable =
		['file', 'recording'].includes(doc.attachmentPurpose) &&
		!doc.attachmentImportDraft &&
		!doc.attachmentExpiresAt &&
		!doc.attachmentLinked &&
		!doc.attachmentProfileSlot;
	if (doc.attachmentExpiresAt != null && (!(doc.attachmentExpiresAt instanceof Date) || !Number.isFinite(doc.attachmentExpiresAt.getTime())))
		throw Error('Invalid attachment expiry');
	if (!doc.targetId && !durable && (!doc.attachmentExpiresAt || doc.attachmentExpiresAt.getTime() <= snapshotAt))
		throw Error('Expired attachment cannot enter a backup');
	if (
		doc.attachmentLinked !== true &&
		(!/^objects\/[A-Za-z0-9_-]+$/.test(doc.objectKey) || !isAttachmentObjectVersionId(doc.objectVersionId) || doc.objectVersionId === 'null')
	)
		throw Error('Attachment needs a finalized immutable version');
}

export async function backupAttachmentFromDoc(
	doc: any,
	ownerId: string,
	snapshotAt: number,
	head: (doc: any) => Promise<AttachmentObjectHead>
): Promise<BackupAttachment> {
	validateBackupAttachmentDoc(doc, ownerId, snapshotAt);
	let content: CloudFileContent | null = null;
	if (!doc.attachmentLinked) {
		const stored = await head(doc);
		if (stored.attachmentId !== doc.shareId || stored.versionId !== doc.objectVersionId || stored.sizeBytes !== doc.objectSizeBytes)
			throw Error('Attachment backup storage identity changed');
		const fingerprint = fingerprintFromVerifiedHead(stored);
		if (!fingerprint) throw Error('Attachment backup needs a verified canonical fingerprint');
		content = {
			attachmentId: doc.shareId,
			version: attachmentContentVersion(doc.shareId, doc.objectKey, doc.objectVersionId),
			size: stored.sizeBytes,
			fingerprint
		};
	}
	return parseBackupAttachment({
		id: doc.shareId,
		ownerId,
		purpose: doc.attachmentPurpose ?? null,
		profileSlot: doc.attachmentProfileSlot ?? null,
		linked: doc.attachmentLinked === true,
		sortIndex: doc.attachmentSortIndex ?? null,
		moderation: ['pending', 'nsfw'].includes(doc.moderation?.status) ? doc.moderation.status : null,
		snapshot: thingContentSnapshot(doc),
		content
	});
}
export function backupAttachmentItem(record: BackupAttachment, ordinal: number): BackupItem {
	const value = parseBackupAttachment(record);
	return parseBackupItem({
		ordinal,
		thingId: value.id,
		revision: 'snapshot-' + createHash('sha256').update(backupJson(value)).digest('hex'),
		snapshot: { adapter: BACKUP_ATTACHMENT_ADAPTER, version: 1, value },
		content: value.content ? { size: value.content.size, fingerprint: value.content.fingerprint } : null
	});
}
export function backupAttachmentItemContent(item: BackupItem): CloudFileContent | null {
	if (item.snapshot.adapter !== BACKUP_ATTACHMENT_ADAPTER || item.snapshot.version !== 1) throw Error('Unsupported backup attachment');
	const record = parseBackupAttachment(item.snapshot.value),
		expected = backupAttachmentItem(record, item.ordinal);
	if (backupJson(expected) !== backupJson(item)) throw Error('Backup attachment descriptor changed');
	return record.content;
}
/** Canonical file snapshots are small and self-contained (never split into
 * thing-content snapshot parts). Both published revisions and retained conflict
 * effects refer to exact owned attachment objects. */
export function backupFileReferences(snapshot: TimelineSnapshot | null, thingId: string): CloudFileContent[] {
	if (snapshot?.adapter !== 'file-content') return [];
	if (snapshot.version !== 1) throw Error('Unsupported historical file snapshot');
	const file = parseCloudFile(snapshot.value);
	if (file.id !== thingId) throw Error('Historical file identity changed');
	return [file.content];
}
export function verifyBackupFileReference(reference: CloudFileContent, fileId: string, attachment: BackupAttachment) {
	if (
		attachment.purpose !== 'file' ||
		attachment.snapshot.value == null ||
		(attachment.snapshot.value as any).targetId !== fileId ||
		!attachment.content ||
		attachment.content.attachmentId !== reference.attachmentId ||
		attachment.content.version !== reference.version ||
		attachment.content.size !== reference.size ||
		!equalContentFingerprints(attachment.content.fingerprint, reference.fingerprint)
	)
		throw Error('Historical file attachment is missing or changed');
}
