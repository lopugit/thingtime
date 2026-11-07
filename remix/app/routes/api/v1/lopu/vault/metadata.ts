import { json } from '~/api/http';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { resolveTokenUser } from '~/api/utils/auth/getCurrentUser';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { listUserVaultMetadata } from '~/api/utils/lopu/userVault';
import { UserVaultMetadataError } from '~/api/utils/lopu/userVaultMetadata';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization', 'Referrer-Policy': 'no-referrer' };
const defaults = { getAuthToken, resolveTokenUser, listUserVaultMetadata };
/** Invoked by the existing JSON-only, full-account, rate-limited Vault POST.
 * Cached identity or an internal Action cannot authorize account reconciliation. */
export function createVaultMetadataResponse(overrides: Partial<typeof defaults> = {}) {
 const deps = { ...defaults, ...overrides };
 return async (request: Request, expectedUser: string, body: Record<string, unknown>) => {
  const deny = (status: number, error: string, code?: string) => json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers });
  try {
   if (request.headers.get('Origin') !== resolvePublicOrigin(request).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return deny(403, 'Use the same Thingtime origin.');
   if (Object.keys(body).some(key => !['action','expectedOwnerId'].includes(key))) return deny(400, 'Invalid Vault metadata request.');
   if (internalRequestActor(request)) return deny(403, 'A current account session is required.');
   const token = await deps.getAuthToken(request), account = token ? await deps.resolveTokenUser(token) : null;
   if (!account || account.user.temporary || account.user.accountKind === 'service') return deny(401, 'Sign in to your Thingtime account.');
   if (account.user.id !== expectedUser || body.expectedOwnerId !== account.user.id) return deny(409, 'Your active account changed.', 'ACTOR_CHANGED');
   const result = await deps.listUserVaultMetadata(account.user.id);
   const fresh = await deps.resolveTokenUser(token!);
   if (!fresh || fresh.user.temporary || fresh.user.accountKind === 'service' || fresh.user.id !== account.user.id) return deny(401, 'Your account session changed.');
   return json({ ok: true, ownerId: account.user.id, ...result }, { headers });
  } catch (error) {
   if (error instanceof UserVaultMetadataError) return deny(error.status, error.message);
   return deny(503, 'Vault metadata is temporarily unavailable. Existing device entries have been kept.');
  }
 };
}
export const vaultMetadataResponse = createVaultMetadataResponse();
