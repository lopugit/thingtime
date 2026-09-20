import { handleLocalAttachmentStorageRequest } from '~/api/utils/attachments/localAttachmentStorage';
import { withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';

// GET|HEAD|PUT /api/v1/attachments/local-object — the filesystem stand-in for
// the private S3 bucket (localAttachmentStorage.ts). Every URL is minted by the
// server with a short-lived HMAC signature: PUT stores one multipart part
// (checksum and length verified), GET/HEAD streams one exact object version
// with Range support. Without THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR the route
// answers 404 for everything, and the module refuses to start on Vercel.

export const loader = async ({ request }: { request: Request }) => withAttachmentPrivateResponse(() => handleLocalAttachmentStorageRequest(request));

export const action = async ({ request }: { request: Request }) => withAttachmentPrivateResponse(() => handleLocalAttachmentStorageRequest(request));
