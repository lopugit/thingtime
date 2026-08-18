import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { startAttachmentUpload } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/uploads — reserve quota and create a private MPU.
// Requires the upload permission scope matching the requested purpose (public
// = post/comment/custom-emoji, private = message/profile media): new signups
// start with both withheld (even once their email is verified) until an admin
// grants them — per scope or all — from the /admin Users tab. During the beta
// it additionally requires the admin-granted media-upload permission, which is
// a whole-account grant independent of the requested purpose.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.start',
	service: startAttachmentUpload,
	requireUploadPermission: true,
	requireUploadGrant: true
});

export const loader = attachmentPostOnlyLoader;
