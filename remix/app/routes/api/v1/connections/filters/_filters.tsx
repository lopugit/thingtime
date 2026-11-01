import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deleteFeedFilter, listFeedFilters, saveFeedFilter } from '~/api/utils/connections/filters';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/connections/filters — list the caller's AI feed filters.
// POST — create ({ name, prompt, action, enabled }), update ({ id, … }), or
// delete ({ id, remove: true }). Filters classify connected feeds server-side
// ('warn' veils matched posts behind a Show button, 'hide' drops them).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'connections.read', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Listing filters very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const result = await listFeedFilters(user.id);
  return json({ ok: true, filters: result.filters });
};

export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'connections.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Saving filters very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  if (body?.remove === true) {
    const removed = await deleteFeedFilter(user, { id: body?.id });
    if (removed.ok === false) {
      return json({ ok: false, error: removed.error }, { status: removed.status });
    }
    return json({ ok: true, removed: true });
  }
  const result = await saveFeedFilter(user, {
    id: body?.id,
    name: body?.name,
    prompt: body?.prompt,
    action: body?.action,
    enabled: body?.enabled
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, filter: result.filter });
};
