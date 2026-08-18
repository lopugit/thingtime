import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { startAttachmentUpload } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/uploads — reserve quota and create a private MPU.
// Requires the account's public file/media upload permission: new signups start
// without it (even once their email is verified) until an admin grants it from
// the /admin Users tab.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.start',
	service: startAttachmentUpload,
	requirePublicUploads: true
});

export const loader = attachmentPostOnlyLoader;
