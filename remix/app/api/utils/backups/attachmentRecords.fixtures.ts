import { fingerprintSource } from '../../../fileSync/contentFingerprint';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
import { type AttachmentPurpose } from '../attachments/attachmentCore';
import { eventFixture, entryFixture } from '../../../timeline/testFixtures';
import { splitTimelineEvent } from '../../../timeline/records';
import { packTimelineEntry, packTimelineLink } from '../timeline/envelope';
import { timelineEventThingId, timelineLinkThingId, timelineLinkTargetKey } from '../timeline/repository';

export async function backupAttachmentFixture(
	ownerId = 'owner',
	attachmentId = 'attachment-one',
	bytes = Buffer.from('retained old file'),
	purpose: AttachmentPurpose = 'file',
	targetId: string | null = 'file-one'
) {
	const fingerprint = await fingerprintSource({ size: bytes.length, check: () => {}, read: async (at, length) => bytes.subarray(at, at + length) });
	const objectKey = `objects/${attachmentId}`,
		objectVersionId = `private-version-${attachmentId}`;
	const doc = {
		shareId: attachmentId,
		ownerId,
		thingtime: ['attachment'],
		crystal: { name: 'original.bin', size: bytes.length, contentType: 'application/octet-stream', mediaKind: 'file' },
		attachmentEnvelopeVersion: 1,
		attachmentState: 'ready',
		objectSizeBytes: bytes.length,
		objectKey,
		objectVersionId,
		attachmentPurpose: purpose,
		...(purpose === 'profile' ? { attachmentProfileSlot: 'avatar' } : {}),
		targetId,
		secure: 'NEVER_EXPORT',
		linkKey: 'NEVER_EXPORT',
		tokenAcl: 'NEVER_EXPORT'
	};
	const content = { attachmentId, version: attachmentContentVersion(attachmentId, objectKey, objectVersionId), size: bytes.length, fingerprint };
	const head = {
		attachmentId,
		versionId: objectVersionId,
		sizeBytes: bytes.length,
		checksumType: 'COMPOSITE',
		checksumSha256: Buffer.from(fingerprint.sha256, 'hex').toString('base64') + '-' + fingerprint.partCount
	};
	return { doc, content, head, bytes };
}
export async function backupFileHistoryFixture(ownerId = 'owner') {
	const attachments = await Promise.all([
		backupAttachmentFixture(ownerId, 'attachment-old', Buffer.alloc(8 * 1024 * 1024 + 19, 31)),
		backupAttachmentFixture(ownerId, 'attachment-current', Buffer.from('current file')),
		backupAttachmentFixture(ownerId, 'attachment-conflict', Buffer.from('other device conflict'))
	]);
	const files = attachments.map((attachment, index) => ({
		id: 'file-one',
		revision: `file-event-${index}`,
		folderId: 'folder-one',
		name: 'saved.bin',
		trashed: false,
		content: attachment.content
	}));
	const snapshot = (file: (typeof files)[number]) => ({ adapter: 'file-content', version: 1, value: file });
	const docs: any[] = attachments.map((a) => a.doc);
	const now = new Date('2026-10-18T00:00:00.000Z');
	for (let index = 0; index < files.length; index++) {
		const event = eventFixture(files[index].revision, {
			ownerId,
			actorId: ownerId,
			thingId: 'file-one',
			source: 'api',
			mode: index === 2 ? 'effect' : 'revision',
			clientId: null,
			operation: index === 2 ? 'effect' : index === 1 ? 'update' : 'create',
			before: index === 1 ? snapshot(files[0]) : null,
			after: snapshot(files[index]),
			parentIds: index === 1 ? [files[0].revision] : []
		});
		const entry = entryFixture(event, now.getTime() + index),
			shareId = timelineEventThingId(ownerId, event.id);
		docs.push({
			shareId,
			ownerId,
			thingtime: ['timeline-event'],
			targetId: 'file-one',
			createdAt: new Date(entry.receipt.position),
			...packTimelineEntry(entry)
		});
		for (const link of splitTimelineEvent(event).links)
			docs.push({
				shareId: timelineLinkThingId(ownerId, link.id),
				ownerId,
				thingtime: ['timeline-link'],
				targetId: shareId,
				crystal: { targetId: timelineLinkTargetKey(link), linkKind: link.relation },
				...packTimelineLink(link)
			});
	}
	const current = files[1];
	docs.push({
		shareId: current.id,
		ownerId,
		thingtime: ['file'],
		folderId: current.folderId,
		timelineHeadId: current.revision,
		crystal: { name: current.name, trashed: current.trashed, content: current.content }
	});
	return { attachments, files, docs };
}
