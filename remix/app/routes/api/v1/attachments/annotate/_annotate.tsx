import { JSON_BODY_WITHOUT_APPLICATION_LIMIT } from '~/api/http';
import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { annotateAttachment } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/annotate — set/clear an owned ready attachment's
// display filename, title and description (the media Thing page + lightbox presentation text).
export const action = createAttachmentMutationAction({
	bodyBudget: JSON_BODY_WITHOUT_APPLICATION_LIMIT,
	rateKey: 'attachments.annotate',
	service: annotateAttachment
});

export const loader = attachmentPostOnlyLoader;
