import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { importTransfer } from '~/api/utils/things/importTransfer';
import { viewerOf } from '~/api/utils/things/things';
import { TRANSFER_LIMITS } from '~/utils/thingTransfer/format';

export const action = async ({ request }: { request: Request }) => withAttachmentPrivateResponse(async () => {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;
  if (!isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Cross-origin import is not allowed' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user || user.accountKind !== 'user') return json({ ok: false, error: 'Sign in to import Things' }, { status: 401 });
  const limit = await enforceRateLimit(request, 'webpages.install', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) return json({ ok: false, error: 'Imports are temporarily rate-limited' }, rateLimitedResponseInit(limit));
  const body = await readJsonBody(request, TRANSFER_LIMITS.manifestBytes + 1024 * 1024);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['manifest', 'files', 'folderId'].includes(key))) return json({ ok: false, error: 'Invalid import request' }, { status: 400 });
  const result = await importTransfer(viewerOf(user), body, request.signal);
  return json(result, { status: result.ok === false ? result.status : 200 });
});
