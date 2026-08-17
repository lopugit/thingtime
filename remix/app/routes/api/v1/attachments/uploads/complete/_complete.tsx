import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { completeAttachmentUpload } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/uploads/complete — verify S3 state and publish metadata.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.complete',
	service: completeAttachmentUpload
});

export const loader = attachmentPostOnlyLoader;
