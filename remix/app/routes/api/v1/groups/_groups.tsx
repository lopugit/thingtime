import { JSON_BODY_WITHOUT_APPLICATION_LIMIT, json, readJsonBody, requireJsonContentType } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createGroup, deleteGroup, listGroups, updateGroup } from '~/api/utils/groups/groups';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { StorageMutationError } from '~/api/utils/storage/storageCore';

// Audience groups — the reusable "share with these people" lists behind the
// custom-visibility picker. Full session only (groups configure your
// audiences; tokens and apps have no business here).
//
// GET    /api/v1/groups                  — your groups + member profiles
// POST   /api/v1/groups { name, memberIds? }        — create
// PATCH  /api/v1/groups { id, name?, memberIds? }   — rename / replace members
// PATCH  /api/v1/groups { id, addMemberIds?, removeMemberIds? } — idempotent delta
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

  const invalidContentType = requireJsonContentType(request);
  if (invalidContentType) return invalidContentType;
  const body = await readJsonBody(request, JSON_BODY_WITHOUT_APPLICATION_LIMIT);

  try {
    if (method === 'POST') {
      const result = await createGroup(user.id, { name: body?.name, memberIds: body?.memberIds });
      if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
      return json({ ok: true, group: result.group }, { status: 201 });
    }

    if (method === 'PATCH') {
      const result = await updateGroup(user.id, body?.id, {
        name: body?.name, memberIds: body?.memberIds,
        addMemberIds: body?.addMemberIds, removeMemberIds: body?.removeMemberIds
      });
      if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
      return json(result);
    }

    const id = (new URL(request.url).searchParams.get('id') || '').trim() || body?.id;
    const result = await deleteGroup(user.id, id);
    if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof StorageMutationError) return json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
};
