import { getCurrentUser } from './getCurrentUser';
import { resolveAppToken } from '../apps/appTokens';
import { scopeCovers } from '../apps/scopes';

// Explicit per-route opt-in, never a change to getCurrentUser. OAuth grants
// cannot mint credentials, edit account security, or access unrelated APIs.
export const getScopedUser = async (request: Request, required: string) => {
  const user = await getCurrentUser(request);
  if (user) return user;
  const app = await resolveAppToken(request);
  if (!app || app.sandbox || !scopeCovers(app.scopes, required)) return null;
  const origin = request.headers.get('Origin');
  if (origin && origin !== app.origin) return null;
  return app.user;
};
