import { json, readJsonBody } from '~/api/http';

import {
  getManagedAppStorage,
  setManagedAppDefaultUserAllowance,
  setManagedAppStorageTier,
  setManagedAppUserAllowances
} from '~/api/utils/apps/appStorageManagement';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/apps/storage?clientId= — owner/co-manager storage plan + users.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const clientId = new URL(request.url).searchParams.get('clientId');
  const result = await getManagedAppStorage(user.id, clientId);
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
  return json({ ok: true, storage: result.storage });
};

// POST actions:
//   set-tier                 { clientId, tier }
//   set-default-user-cap     { clientId, allowanceBytes }
//   set-user-cap             { clientId, userIds, allowanceBytes | null }
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const limit = await enforceRateLimit(request, 'apps.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many app changes — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 64 * 1024);
  let result;
  if (body?.action === 'set-tier') {
    result = await setManagedAppStorageTier(user.id, body?.clientId, body?.tier, body?.tierVersionId);
  } else if (body?.action === 'set-default-user-cap') {
    result = await setManagedAppDefaultUserAllowance(user.id, body?.clientId, body?.allowanceBytes);
  } else if (body?.action === 'set-user-cap') {
    result = await setManagedAppUserAllowances(user.id, body?.clientId, body?.userIds, body?.allowanceBytes);
  } else {
    return json({ ok: false, error: 'Unknown storage-management action' }, { status: 400 });
  }
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });

  const refreshed = await getManagedAppStorage(user.id, body?.clientId);
  if (refreshed.ok === false) {
    return json({ ok: false, error: refreshed.error }, { status: refreshed.status });
  }
  return json({ ok: true, storage: refreshed.storage, ...('updated' in result ? { updated: result.updated } : {}) });
};
