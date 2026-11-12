import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { json, readJsonBody } from '~/api/http';
import { characterPrincipal } from '~/api/utils/auth/characterSession';
import { characterIdentity } from '~/api/utils/auth/characterCore';
import { canManageCharacters, createCharacter, listCharacters, selectSessionCharacter, updateCharacter } from '~/api/utils/auth/characters';
import { findUserById, toPublicUserWithStorage } from '~/api/utils/auth/users';
import { isAdminDoc } from '~/api/utils/auth/admin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, X-Thingtime-Character' };
const respond = (result: any) => json(result, { status: result.ok === false ? result.status : 200, headers });

export async function loader({ request }: { request: Request }) {
  const principal = await characterPrincipal(request);
  if (!principal) return respond({ ok: false, status: 401, error: 'Sign in to use Characters' });
  const params = new URL(request.url).searchParams;
  // The ownership disclosure is deliberately isolated and admin-gated.
  if (params.has('inspect')) {
    if (!isAdminDoc(principal.user)) return respond({ ok: false, status: 403, error: 'Administrator access required' });
    const target = await findUserById(params.get('inspect') || '');
    const identity = characterIdentity(target);
    if (!identity) return respond({ ok: false, status: 404, error: 'Character not found' });
    return respond({ ok: true, characterId: String(target._id), ownerId: identity.ownerId, disabled: identity.disabled });
  }
  const manageable = canManageCharacters(principal.user);
  const page = manageable ? await listCharacters(String(principal.user._id), params.get('cursor')) : { ok: true, characters: [], nextCursor: null };
  return respond({ ...page, canManage: manageable, principal: await toPublicUserWithStorage(principal.user), activeCharacterId: principal.session.meta?.activeCharacterId ?? null });
}

export async function action({ request }: { request: Request }) {
  const origin = request.headers.get('Origin');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== resolvePublicOrigin(request).origin)) return respond({ ok: false, status: 403, error: 'Same-origin request required' });
  const principal = await characterPrincipal(request);
  if (!principal) return respond({ ok: false, status: 401, error: 'Sign in to use Characters' });
  const limited = await enforceRateLimit(request, 'auth.login', `user:${principal.user._id}`, { failClosed: true });
  if (!limited.allowed) {
    const init = rateLimitedResponseInit(limited);
    const responseHeaders = new Headers(init.headers);
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
    return json({ ok: false, error: 'Too many Character changes; try again shortly' }, { ...init, headers: responseHeaders });
  }
  const input = await readJsonBody(request, 64 * 1024);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return respond({ ok: false, status: 400, error: 'Expected a Character operation' });
  if (input.operation === 'select') return respond(await selectSessionCharacter(principal.user, principal.session, input.characterId));
  if (input.operation === 'create') return respond(await createCharacter(principal.user, input));
  return respond(await updateCharacter(principal.user, input));
}
