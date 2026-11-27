import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deviceDiagnostics } from '~/api/utils/devices/deviceDiagnostics';
import { isCustomMongoEndpointActive } from '~/api/utils/mongodb/endpoint';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';

// GET /api/v1/auth/me — returns the current user (or null) for the request's
// auth cookie / Bearer token.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  // Lazy default provisioning backfills existing full owners. A quota or
  // database outage must never turn a successful sign-in into a login failure.
  if (user?.accountKind === 'user' && !user.temporary && !isCustomMongoEndpointActive())
    await deviceDiagnostics.ensure(user.id, resolvePublicOrigin(request).origin).catch(() => undefined);
  return json({ user });
};
