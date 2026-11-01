import { createAttachmentMutationAction, attachmentPostOnlyLoader } from '~/api/utils/attachments/attachmentResponses';
import { cancelAttachmentUpload } from '~/api/utils/attachments/attachments';

// POST /api/v1/attachments/uploads/abort — make bytes inaccessible, then refund.
export const action = createAttachmentMutationAction({
	rateKey: 'attachments.delete',
	service: cancelAttachmentUpload
});

export const loader = attachmentPostOnlyLoader;
