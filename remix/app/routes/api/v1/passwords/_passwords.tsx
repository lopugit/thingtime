import { createHash } from 'node:crypto';
import { passwordFileOperation } from '~/api/utils/passwords/files';
import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { withVaultRequest } from '~/api/utils/auth/vaultRequest';
import { ownerVaultConfigured } from '~/api/utils/auth/vaultCipher';
import { confirmCurrentPassword } from '~/api/utils/auth/passwordConfirmation';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { StorageMutationError } from '~/api/utils/storage/storageCore';
import { PASSWORD_STORAGE_DOCUMENT_BYTES, PasswordManagerError, listPasswords, readPassword, savePassword, deletePassword, passwordCatalog, exportPasswordPage } from '~/api/utils/passwords/passwords';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization', 'Referrer-Policy': 'no-referrer' };
const defaults = { getCurrentUser, getAuthToken, ownerVaultConfigured, confirmCurrentPassword, enforceRateLimit, listPasswords, readPassword, savePassword, deletePassword, passwordCatalog, exportPasswordPage, passwordFileOperation };
// A per-ceremony public comparison value, never an authentication credential.
// Domain separation and the request nonce prevent stable session tracking. The
// high-entropy bearer token remains server-only and its revocation is checked by
// the canonical getCurrentUser resolver on every dependent request.
const passkeySessionBinding = (origin: string, ownerId: string, requestId: string, token: string) =>
  createHash('sha256').update(JSON.stringify(['thingtime-browser-passkey-session-v1', origin, ownerId, requestId, token])).digest('base64url');
const passkeyRequestId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function createPasswordHandler(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  return async ({ request }: { request: Request }) => withVaultRequest(request, async () => {
    // Internal Action identities, scoped app/PAT credentials and temporary users
    // are not browser vault sessions. Never fall back to a different API origin.
    const token = internalRequestActor(request) ? null : await deps.getAuthToken(request);
    const user = token ? await deps.getCurrentUser(request) : null;
    if (!user || user.temporary || user.accountKind === 'service') return json({ ok: false, error: 'Sign in to your Thingtime account.' }, { status: 401, headers });
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
    const limit = await deps.enforceRateLimit(request, request.method === 'GET' ? 'passwords.read' : 'passwords.write', `user:${user.id}`, { failClosed: true });
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit), privateHeaders = new Headers(init.headers);
      Object.entries(headers).forEach(([key, value]) => privateHeaders.set(key, value));
      return json({ ok: false, error: 'Please wait before trying again.' }, { ...init, headers: privateHeaders });
    }
    try {
      if (request.method === 'GET') {
        const result = await deps.listPasswords(user.id, new URL(request.url).searchParams.get('cursor'), new URL(request.url).searchParams.get('q') || '');
        // Icon presentation is decrypted separately; recheck the live session
        // before returning it, just as for explicit field and file reads.
        if ((await deps.getCurrentUser(request))?.id !== user.id) return json({ ok: false, error: 'Your session ended.' }, { status: 401, headers });
        return json({ ok: true, ownerId: user.id, configured: deps.ownerVaultConfigured(), ...result }, { headers });
      }
      const origin = request.headers.get('Origin');
      if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== resolvePublicOrigin(request).origin)) return json({ ok: false, error: 'Use the same Thingtime origin.' }, { status: 403, headers });
      const invalidType = requireJsonContentType(request);
      if (invalidType) return json({ ok: false, error: 'Use application/json.' }, { status: 415, headers });
      const body = await readJsonBody(request, PASSWORD_STORAGE_DOCUMENT_BYTES);
      if (body?.expectedOwnerId !== user.id) throw new PasswordManagerError(409, 'Your active account changed. Reopen the password manager.');
      if (!deps.ownerVaultConfigured()) throw new PasswordManagerError(503, 'Password manager encryption is not configured.');
      const binding = body.passkeySession;
      if (binding !== undefined && (!binding || !passkeyRequestId(binding.requestId) || typeof binding.binding !== 'string' ||
        binding.binding !== passkeySessionBinding(resolvePublicOrigin(request).origin, user.id, binding.requestId, token!)))
        throw new PasswordManagerError(401, 'Your passkey session changed. Start the website request again.');
      const checkPasskeySession = async () => {
        if (binding !== undefined && (await deps.getAuthToken(request) !== token || (await deps.getCurrentUser(request))?.id !== user.id))
          throw new PasswordManagerError(401, 'Your passkey session ended. Start the website request again.');
      };
      await checkPasskeySession();
      if (body.operation === 'verify-passkey') {
        // One fresh knowledge-factor check per browser ceremony. This is not a
        // reusable bearer grant and never creates or switches a login session.
        const confirmationLimit = await deps.enforceRateLimit(request, 'auth.passkeyManage', user.id, { failClosed: true });
        if (!confirmationLimit.allowed) {
          const init = rateLimitedResponseInit(confirmationLimit), privateHeaders = new Headers(init.headers);
          Object.entries(headers).forEach(([key, value]) => privateHeaders.set(key, value));
          return json({ ok: false, error: 'Please wait before verifying again.' }, { ...init, headers: privateHeaders });
        }
        if (!passkeyRequestId(body.requestId)) throw new PasswordManagerError(400, 'A current passkey request is required.');
        if (binding !== undefined && binding.requestId !== body.requestId) throw new PasswordManagerError(401, 'The passkey request changed. Start again.');
        const confirmation = await deps.confirmCurrentPassword(user.id, body.password);
        if (confirmation !== 'confirmed') throw new PasswordManagerError(403, confirmation === 'unavailable'
          ? 'Set a Thingtime account password before using the browser passkey provider.' : 'Your account password could not be verified.');
        if (await deps.getAuthToken(request) !== token || (await deps.getCurrentUser(request))?.id !== user.id) return json({ ok: false, error: 'Your session changed. Start again.' }, { status: 401, headers });
        return json({ ok: true, ownerId: user.id, requestId: body.requestId, verified: true,
          sessionBinding: passkeySessionBinding(resolvePublicOrigin(request).origin, user.id, body.requestId, token!) }, { headers });
      }
      if (body.operation === 'read' || body.operation === 'catalog' || body.operation === 'export') {
        const result = body.operation === 'export' ? await deps.exportPasswordPage(user.id, body.cursor) : body.operation === 'catalog' ? await deps.passwordCatalog(user.id, body.cursor) : await deps.readPassword(user.id, body.id);
        // Revalidate immediately before returning any decrypted fields.
        if ((await deps.getCurrentUser(request))?.id !== user.id) return json({ ok: false, error: 'Your session ended.' }, { status: 401, headers });
        await checkPasskeySession();
        return json({ ok: true, ownerId: user.id, ...result }, { headers });
      }
      if (typeof body.operation === 'string' && body.operation.startsWith('file-')) {
        const result = await deps.passwordFileOperation(user.id, body, user.privateUploadsEnabled === true);
        if ((await deps.getCurrentUser(request))?.id !== user.id) return json({ ok: false, error: 'Your session ended.' }, { status: 401, headers });
        await checkPasskeySession();
        return json({ ...result, ok: true, ownerId: user.id }, { headers });
      }
      if (body.operation === 'save') { const record = await deps.savePassword(user.id, body); await checkPasskeySession(); return json({ ok: true, ownerId: user.id, record }, { headers }); }
      if (body.operation === 'delete') { await deps.deletePassword(user.id, body); await checkPasskeySession(); return json({ ok: true, ownerId: user.id }, { headers }); }
      throw new PasswordManagerError(400, 'Unknown password manager operation.');
    } catch (error) {
      if (error instanceof PasswordManagerError || error instanceof StorageMutationError) return json({ ok: false, error: error.message }, { status: error.status, headers });
      if (error instanceof Response) return json({ ok: false, error: 'Invalid request body.' }, { status: error.status, headers });
      if ((error as any)?.code === 11000) return json({ ok: false, error: 'This entry changed. Retry the same save.' }, { status: 409, headers });
      // Do not log request bodies, decrypted values, exception messages or DB
      // documents. A bounded error class/code still makes failures diagnosable.
      console.warn('[password-manager] unavailable', { name: error instanceof Error ? error.name : 'Unknown', code: typeof (error as any)?.code === 'number' ? (error as any).code : undefined });
      return json({ ok: false, error: 'Password manager is unavailable. Please try again.' }, { status: 503, headers });
    }
  });
}
export const loader = createPasswordHandler();
export const action = loader;
