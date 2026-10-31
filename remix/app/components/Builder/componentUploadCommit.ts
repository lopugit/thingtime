// Client-generated retry identities use the same ordinary UUID namespace as Things.
export const componentUploadCommitId = () => crypto.randomUUID();

// Keep the native upload's commit on the canonical post/attachment write path.
// The upload is a ready draft until this private target has been persisted.
export const componentUploadCommitInput = (attachmentIds: string[], shareId: string) => ({
	thingtime: ['post'],
	crystal: { text: 'Component file', type: 'text' },
	acl: ['tt:user'],
	attachmentIds,
	shareId
});
