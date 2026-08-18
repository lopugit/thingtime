import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { startAttachmentUpload } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/uploads — reserve quota and create a private MPU.
// Requires the upload permission scope matching the requested purpose (public
// = post/comment/custom-emoji, private = message/profile media): new signups
// start with both withheld (even once their email is verified) until an admin
// grants them — per scope or all — from the /admin Users tab. Deliberately NOT
// requireUploadGrant: that any-scope check runs before the body is read, so it
// would preempt this route's purpose-matched public/private 403 code with the
// generic media_upload_not_granted one. The already-started parts/complete
// routes keep it.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.start',
	service: startAttachmentUpload,
	requireUploadPermission: true
});

export const loader = attachmentPostOnlyLoader;
