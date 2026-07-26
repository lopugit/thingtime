import { getCurrentUser } from './getCurrentUser';
import type { PublicUser } from './users';

// Resolve the request's user and require admin. Returns the user, or an error
// shape the route turns into a 401/403. Admin status is the same `isAdmin` flag
// (meta.admin OR the ADMIN_USERNAMES env allowlist) toPublicUser stamps on every
// user — always re-checked server-side here, never trusted from the client.
export const requireAdmin = async (
  request: Request
): Promise<{ user: PublicUser } | { error: { status: number; message: string } }> => {
  const user = await getCurrentUser(request);
  if (!user) return { error: { status: 401, message: 'Unauthorized' } };
  if (!user.isAdmin) return { error: { status: 403, message: 'Admins only' } };
  return { user };
};
