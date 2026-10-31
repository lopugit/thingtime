import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getUserDeploymentLinks, updateUserDeploymentLink } from '~/api/utils/auth/users';
import { runDeploymentSync } from '~/api/utils/deployments/sync';
import { isFail } from '~/api/utils/things/things';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { toPublicLink } from '../_deployment-links';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/deployment-links/sync — { id, dryRun? } — run one sync pass for
// a link. A pass is bounded (see sync.ts MAX_SYNC_OPS_PER_RUN); the report's
// `remaining` count says whether another pass is needed.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  if (request.method.toUpperCase() !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Payload too large' }, { status: 413 });
  }

  // fail-closed: each pass fans out reads+writes against a remote host — this
  // must never run unthrottled
  const limit = await enforceRateLimit(request, 'deployments.sync', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) {
    return json({ ok: false, error: 'Sync is taking a breather — try again in a moment 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return json({ ok: false, error: 'Link id is required' }, { status: 400 });

  const links = await getUserDeploymentLinks(user.id);
  const link = links.find((entry) => entry.id === id);
  if (!link) return json({ ok: false, error: 'Link not found' }, { status: 404 });

  const report = await runDeploymentSync(user, link, { dryRun: !!body?.dryRun });
  // the shared guard, so the compiler actually narrows the Fail branch away —
  // an ad-hoc `'status' in report` check reads the same but leaves `report`
  // typed as the union below, hiding any future mishandling of a failed pass
  if (isFail(report)) {
    return json({ ok: false, error: report.error }, { status: report.status });
  }

  let publicLink = toPublicLink(link);
  if (!report.dryRun) {
    const updated = await updateUserDeploymentLink(user.id, link.id, {
      lastSyncAt: report.finishedAt,
      lastSyncSummary: report
    });
    if (updated) publicLink = toPublicLink(updated);
  }

  return json({ ok: true, report, link: publicLink });
};
