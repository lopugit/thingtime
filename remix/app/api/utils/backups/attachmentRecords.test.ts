import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTACHMENT_PURPOSES } from '../attachments/attachmentCore';
import { backupAttachmentFixture } from './attachmentRecords.fixtures';
import { backupAttachmentFromDoc, backupAttachmentItem, backupAttachmentItemContent, parseBackupAttachment } from './attachmentRecords';

const time = Date.parse('2026-10-18T00:00:00.000Z');
test('ready attachment purposes preserve canonical content and placement, without private storage or upload authority', async () => {
	for (const purpose of ATTACHMENT_PURPOSES) {
		const f = await backupAttachmentFixture('owner', 'attachment-' + purpose, Buffer.from(purpose), purpose, 'bound-target');
		const doc = { ...f.doc, folderId: 'saved-folder', attachmentSortIndex: 4, moderation: { status: 'nsfw' } };
		const record = await backupAttachmentFromDoc(doc, 'owner', time, async () => f.head);
		assert.equal(record.purpose, purpose);
		assert.equal(record.sortIndex, 4);
		assert.equal(record.moderation, 'nsfw');
		assert.equal((record.snapshot.value as any).folderId, 'saved-folder');
		assert.equal((record.snapshot.value as any).targetId, 'bound-target');
		assert.deepEqual(backupAttachmentItemContent(backupAttachmentItem(record, 0)), f.content);
		assert.doesNotMatch(JSON.stringify(record), /NEVER_EXPORT|objects\/|private-version|uploadId|objectKey/);
		assert.throws(() => parseBackupAttachment({ ...record, objectKey: 'objects/secret' }));
	}
});

test('linked media preserves the external reference and never asks storage to fetch third-party bytes', async () => {
	const f = await backupAttachmentFixture();
	const doc: any = {
		...f.doc,
		attachmentPurpose: 'post',
		attachmentLinked: true,
		objectSizeBytes: 0,
		objectKey: 'linked/attachment-one',
		crystal: { name: 'linked.mp4', contentType: 'video/mp4', mediaKind: 'video', size: 0, url: 'https://example.invalid/media.mp4' }
	};
	delete doc.objectVersionId;
	const record = await backupAttachmentFromDoc(doc, 'owner', time, async () => {
		throw Error('Must not fetch external data');
	});
	assert.equal(record.content, null);
	assert.equal(backupAttachmentItem(record, 0).content, null);
	assert.equal((record.snapshot.value as any).crystal.url, doc.crystal.url);
	await assert.rejects(
		backupAttachmentFromDoc({ ...doc, uploadId: 'unexpected-upload' }, 'owner', time, async () => {
			throw Error('No HEAD');
		})
	);
});

test('missing immutable versions, lifecycle corruption, expired drafts and foreign objects refuse before retention', async () => {
	const f = await backupAttachmentFixture();
	for (const patch of [
		{ objectVersionId: undefined },
		{ objectVersionId: 'null' },
		{ objectKey: 'https://example.invalid/object' },
		{ attachmentState: 'finalizing' },
		{ attachmentObjectlessDelete: true },
		{ ownerId: 'foreign' },
		{ moderation: { status: 'blocked' } },
		{ appId: 'app-one' },
		{ attachmentPurpose: 'unknown' },
		{ targetId: null, attachmentPurpose: 'post', attachmentExpiresAt: new Date(time - 1) },
		{ targetId: null, attachmentPurpose: 'file', attachmentImportDraft: true }
	]) {
		let heads = 0;
		await assert.rejects(
			backupAttachmentFromDoc({ ...f.doc, ...patch }, 'owner', time, async () => {
				heads++;
				return f.head;
			})
		);
		assert.equal(heads, 0);
	}
	for (const patch of [{ attachmentId: 'foreign' }, { versionId: 'other' }, { sizeBytes: f.bytes.length + 1 }, { checksumType: 'FULL_OBJECT' }]) {
		await assert.rejects(backupAttachmentFromDoc(f.doc, 'owner', time, async () => ({ ...f.head, ...patch })));
	}
});
