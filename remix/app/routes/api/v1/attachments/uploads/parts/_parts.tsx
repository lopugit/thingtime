import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { signAttachmentUploadParts } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/uploads/parts — sign a bounded checksum-locked part batch.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.parts',
	service: signAttachmentUploadParts
});

export const loader = attachmentPostOnlyLoader;
