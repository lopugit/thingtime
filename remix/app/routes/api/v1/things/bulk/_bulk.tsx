import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { bulkThings } from '~/api/utils/things/things';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';

// POST /api/v1/things/bulk — { op: 'move'|'copy'|'delete'|'share', ids: [...],
// folderId?, acl?, recursive? } — multi-select operations for /things. Each id
// runs through the same single-item path as the dedicated endpoints (never a
// second code path), with a per-item ok/error result so one bad id doesn't
// fail the batch. Folder copies and recursive shares walk the subtree through
// those same paths (bounded, honest per-item counts).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limitKey = user.accountKind === 'service' ? 'things.write.service' : 'things.write';
  const limit = await enforceRateLimit(request, limitKey, `user:${user.id}`);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'You’re doing that too fast — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, 64 * 1024);
  const libraryPlacement = body?.op === 'archive' || body?.op === 'restore';
  const fetchSite = request.headers.get('Sec-Fetch-Site')?.toLowerCase();
  const sameOrigin = isSameOriginAttachmentRequest(request) && (!fetchSite || fetchSite === 'same-origin' || fetchSite === 'none');
  // getCurrentUser is the unscoped account-session resolver; PATs and app
  // credentials cannot resolve on this route.
  const libraryOwnerId = libraryPlacement && user.accountKind === 'user' &&
    !user.temporary && sameOrigin ? user.id : undefined;
  const result = await bulkThings({ id: user.id, username: user.username }, body, {}, {
    libraryOwnerId,
    archiveOwnerId: user.accountKind === 'user' && sameOrigin ? user.id : undefined
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({
    ok: true,
    op: result.op,
    results: result.results,
    succeeded: result.succeeded,
    failed: result.failed
  });
};
