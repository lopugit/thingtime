import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { annotateAttachment } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/annotate — set/clear an owned ready attachment's
// display filename, title and description (the media Thing page + lightbox presentation text).
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.annotate',
	service: annotateAttachment
});

export const loader = attachmentPostOnlyLoader;
