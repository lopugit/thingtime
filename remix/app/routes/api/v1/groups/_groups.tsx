import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createGroup, deleteGroup, listGroups, updateGroup } from '~/api/utils/groups/groups';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 64 * 1024;

// Audience groups — the reusable "share with these people" lists behind the
// custom-visibility picker. Full session only (groups configure your
// audiences; tokens and apps have no business here).
//
// GET    /api/v1/groups                  — your groups + member profiles
// POST   /api/v1/groups { name, memberIds? }        — create
// PATCH  /api/v1/groups { id, name?, memberIds? }   — rename / replace members
// DELETE /api/v1/groups { id } (or ?id=)            — delete (removes members)

export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const result = await listGroups(user.id);
  return json(result);
};

export const action = async ({ request }: { request: Request }) => {
  const method = request.method.toUpperCase();
  if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST, PATCH, DELETE' } });
  }

  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const limit = await enforceRateLimit(request, 'things.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re doing that too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);

  if (method === 'POST') {
    const result = await createGroup(user.id, { name: body?.name, memberIds: body?.memberIds });
    if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
    return json({ ok: true, group: result.group }, { status: 201 });
  }

  if (method === 'PATCH') {
    const result = await updateGroup(user.id, body?.id, { name: body?.name, memberIds: body?.memberIds });
    if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
    return json({ ok: true, group: result.group });
  }

  const id = (new URL(request.url).searchParams.get('id') || '').trim() || body?.id;
  const result = await deleteGroup(user.id, id);
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
  return json({ ok: true });
};
