import assert from 'node:assert/strict';
import test from 'node:test';
import { backupDraftFixture } from './draftRecords.fixtures';
import { backupDraftFromDoc, parseBackupDraft, backupDraftAttachmentReferences, verifyBackupDraftAttachment } from './draftRecords';
import { backupAttachmentFromDoc } from './attachmentRecords';

test('draft archive preserves canonical editor bytes, template provenance and deletion revisions without private roots', async () => {
	const f = await backupDraftFixture();
	const records = f.docs.map(backupDraftFromDoc);
	assert.equal(records[0].deleted, false);
	if (!records[0].deleted) assert.equal(records[0].value.snapshot, f.snapshot);
	assert.deepEqual(records[1].source, { kind: 'post', id: 'post:original' });
	assert.equal(records[1].value.mode, 'template');
	assert.equal(records[2].deleted, true);
	assert.equal(records[2].value.revision, 4);
	assert.equal('snapshot' in records[2].value, false);
	assert.deepEqual(backupDraftAttachmentReferences(records[2]), []);
	assert.ok(!JSON.stringify(records).includes('NEVER_EXPORT'));
	const ref = backupDraftAttachmentReferences(records[0])[0];
	const attachment = await backupAttachmentFromDoc(f.attachments[0].doc, 'owner', Date.now(), async () => f.attachments[0].head);
	verifyBackupDraftAttachment(ref, attachment);
	for (const patch of [{ ownerId: 'foreign' }, { draftId: 'other' }, { purpose: 'post' as const }, { attachmentId: 'missing' }])
		assert.throws(() => verifyBackupDraftAttachment({ ...ref, ...patch }, attachment));
});

test('invalid or ambiguous draft records cannot become archived active content', async () => {
	const f = await backupDraftFixture();
	const original = backupDraftFromDoc(f.docs[0]);
	for (const mutate of [
		(r: any) => (r.deleted = true),
		(r: any) => (r.value.revision = 0),
		(r: any) => (r.value.updatedAt = '2026-10-16T00:00:00.000Z'),
		(r: any) => (r.value.mode = 'other'),
		(r: any) => (r.writeId = '../write'),
		(r: any) => (r.source.id = 'template:invalid'),
		(r: any) => (r.source.kind = 'passkey'),
		(r: any) => (r.value.snapshot = '{"constructor": {}}'),
		(r: any) => r.value.attachmentIds.push(r.value.attachmentIds[0]),
		(r: any) => (r.value.snapshot = JSON.stringify({ text: 'x'.repeat(512 * 1024) })),
		(r: any) => (r.value.credentials = 'private')
	]) {
		const record = structuredClone(original);
		mutate(record);
		assert.throws(() => parseBackupDraft(record));
	}
	assert.throws(() => backupDraftFromDoc({ ...f.docs[0], draftDeleted: true }));
	assert.throws(() => backupDraftFromDoc({ ...f.docs[2], draftDeleted: false }));
	assert.throws(() => backupDraftFromDoc({ ...f.docs[0], thingtime: ['draft', 'data'] }));
	assert.throws(() => backupDraftFromDoc({ ...f.docs[0], createdAt: null }));
});
