import { backupAttachmentFixture } from './attachmentRecords.fixtures';
export async function backupDraftFixture(ownerId = 'owner') {
	const attachments = await Promise.all([
		backupAttachmentFixture(ownerId, 'draft-comment-media', Buffer.from('draft comment media'), 'comment', 'draft-working'),
		backupAttachmentFixture(ownerId, 'draft-template-media', Buffer.from('template private media'), 'post', 'draft-template')
	]);
	const common = {
		ownerId,
		thingtime: ['draft'],
		draftRevision: 3,
		draftWriteId: 'retained-write-id',
		createdAt: new Date('2026-10-17T00:00:00.000Z'),
		updatedAt: new Date('2026-10-18T00:00:00.000Z'),
		secure: 'NEVER_EXPORT',
		linkKey: 'NEVER_EXPORT',
		tokenAcl: 'NEVER_EXPORT'
	};
	const snapshot = '{\n  "text": ' + JSON.stringify('saved editor state '.repeat(20000)) + ', "selection": [2, 5]\n}';
	const docs = [
		{
			...common,
			shareId: 'draft-working',
			draftMode: 'draft',
			draftSource: { kind: 'template', id: 'draft-template' },
			crystal: { name: 'Working copy', surface: 'comment', context: 'parent-comment', snapshot, attachmentIds: [attachments[0].doc.shareId] }
		},
		{
			...common,
			shareId: 'draft-template',
			draftMode: 'template',
			draftSource: { kind: 'post', id: 'post:original' },
			crystal: {
				name: 'Reusable template',
				surface: 'post',
				context: 'composer',
				snapshot: '{ "text": "Template" }',
				attachmentIds: [attachments[1].doc.shareId]
			}
		},
		{ ...common, shareId: 'draft-deleted', draftMode: 'draft', draftRevision: 4, draftDeleted: true, crystal: {} }
	];
	return { docs, attachments, snapshot };
}
