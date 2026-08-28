import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { deleteAttachment } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/delete — delete an owned ready attachment.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.delete',
	service: deleteAttachment
});

export const loader = attachmentPostOnlyLoader;
