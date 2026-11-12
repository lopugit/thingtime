import { json } from '~/api/http';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { resolveTokenUser } from '~/api/utils/auth/getCurrentUser';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { EXPECTED_DATA_PLANE_HEADER, isDataPlane } from '~/utils/dataPlane';
import { synchronizeUserVaultWrite, UserVaultWriteError } from '~/api/utils/lopu/userVaultWrites';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, X-Thingtime-Expected-Data-Plane', 'Referrer-Policy': 'no-referrer' };
const defaults = { getAuthToken, resolveTokenUser, synchronizeUserVaultWrite, mongoDataPlane };
class SessionChanged extends Error {
 constructor(readonly status: number, readonly code?: string) { super('Vault account confirmation changed.'); }
}
/** The existing Vault POST owns JSON/body bounds and fail-closed rate limiting.
 * This branch additionally binds writes to a current full session and plane. */
export function createVaultWriteResponse(overrides: Partial<typeof defaults> = {}) {
 const deps = { ...defaults, ...overrides };
 return async (request: Request, expectedUser: string, body: Record<string, unknown>) => {
  const deny = (status: number, error: string, code?: string) => json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers });
  try {
   if (request.headers.get('Origin') !== resolvePublicOrigin(request).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return deny(403, 'Use the same Thingtime origin.');
   if (Object.keys(body).some(key => !['action','expectedOwnerId','command'].includes(key)) || body.action !== 'sync-write' || !body.command) return deny(400, 'Invalid Vault save request.');
   if (internalRequestActor(request)) return deny(403, 'A current account session is required.');
   const token = await deps.getAuthToken(request), expectedPlane = request.headers.get(EXPECTED_DATA_PLANE_HEADER);
   if (!isDataPlane(expectedPlane)) return deny(400, 'Confirm the selected database before synchronizing.', 'INVALID_DATA_PLANE');
   const admit = async () => {
    const account = token ? await deps.resolveTokenUser(token) : null;
    if (!account || account.user.temporary || account.user.accountKind === 'service') throw new SessionChanged(401);
    if (account.user.id !== expectedUser || body.expectedOwnerId !== account.user.id) throw new SessionChanged(409, 'ACTOR_CHANGED');
    if (deps.mongoDataPlane() !== expectedPlane) throw new SessionChanged(409, 'DATA_PLANE_CHANGED');
   };
   await admit();
   const acknowledgment = await deps.synchronizeUserVaultWrite(expectedUser, body.command, admit);
   await admit();
   return json({ ok: true, ownerId: expectedUser, acknowledgment }, { headers });
  } catch (error) {
   if (error instanceof SessionChanged) return deny(error.status, 'Your account or database confirmation changed. Device changes have been kept.', error.code);
   if (error instanceof UserVaultWriteError) return deny(error.status, error.message);
   return deny(503, 'Vault synchronization is temporarily unavailable. Retry the same save; device changes have been kept.');
  }
 };
}
export const vaultWriteResponse = createVaultWriteResponse();
