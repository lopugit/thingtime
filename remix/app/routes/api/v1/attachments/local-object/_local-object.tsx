import { handleLocalAttachmentStorageRequest } from '~/api/utils/attachments/localAttachmentStorage';

// GET|HEAD|PUT /api/v1/attachments/local-object — the filesystem stand-in for
// the private S3 bucket (localAttachmentStorage.ts). Every URL is minted by the
// server with a short-lived HMAC signature: PUT stores one multipart part
// (checksum and length verified), GET/HEAD streams one exact object version
// with Range support. Without THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR the route
// answers 404 for everything, and the module refuses to start on Vercel.
//
// The adapter owns its response headers (private must-revalidate + ETag for
// immutable exact versions, no-store for everything else), the same way a
// bucket owns the headers on a presigned URL — so this route deliberately
// does not wrap it in withAttachmentPrivateResponse, which would force
// no-store onto media the browser can safely revalidate.

export const loader = async ({ request }: { request: Request }) => handleLocalAttachmentStorageRequest(request);

export const action = async ({ request }: { request: Request }) => handleLocalAttachmentStorageRequest(request);
