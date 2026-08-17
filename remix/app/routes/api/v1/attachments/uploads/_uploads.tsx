import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { startAttachmentUpload } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/uploads — reserve quota and create a private MPU.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.start',
	service: startAttachmentUpload
});

export const loader = attachmentPostOnlyLoader;
