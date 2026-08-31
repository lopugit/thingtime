import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { linkAttachment } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/link — mint a READY linked-attachment draft from an
// external media URL. It binds, orders, and deletes like an uploaded
// attachment, but its bytes stay on the original site (rendered via safe
// sinks; the server never fetches the URL). No upload-approval gate: linked
// media consumes no Thingtime object storage, matching the legacy image-URL
// flow it replaces.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.link',
	service: linkAttachment
});

export const loader = attachmentPostOnlyLoader;
