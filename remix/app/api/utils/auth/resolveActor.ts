import { json } from '~/api/http';

import { getCurrentUser } from './getCurrentUser';
import type { PublicUser } from './users';
import { resolveAppToken } from '../apps/appTokens';
import type { AppTokenContext } from '../apps/appTokens';
import { appCorsHeaders } from '../apps/cors';
import { appScopeOf } from '../apps/namespace';
import type { AppNamespaceScope } from '../apps/namespace';
import { scopeCovers } from '../apps/scopes';

// Who is calling a things route? A tagged union so no call site can forget
// the question (the danger of handing back a bare PublicUser for both paths
// is that viewerOf(user) would let an app token see everything the user
// sees). Routes that never opted in keep calling getCurrentUser and keep
// rejecting app tokens — this resolver is additive.
//
//   user       first-party session — httpOnly cookie or the user's own Bearer
//              JWT. Full first-party behaviour, byte-for-byte unchanged.
//   app        an app-scoped token ("Login with Thingtime", purpose 'app' or
//              'app-sandbox'): Bearer-only, origin-bound, scope-checked, and
//              carrying the namespace scope every query/write MUST thread
//              through apps/namespace.ts. cors headers ride along so even
//              error responses stay readable cross-origin; rateIdentity is
//              per-(user, app) so an app never shares the user's own buckets.
//   anonymous  nobody — same as getCurrentUser returning null.

export type Actor =
  | { kind: 'user'; user: PublicUser }
  | {
      kind: 'app';
      ctx: AppTokenContext;
      scope: AppNamespaceScope;
      cors: Record<string, string>;
      rateIdentity: string;
    }
  | { kind: 'anonymous' };

export const actorUser = (actor: Actor): PublicUser | null => (actor.kind === 'anonymous' ? null : actor.kind === 'user' ? actor.user : actor.ctx.user);

export const actorCors = (actor: Actor): Record<string, string> => (actor.kind === 'app' ? actor.cors : {});

// Resolve the acting credential, or a ready CORS-carrying error Response.
// The app path requires the app-data scope by default — the namespace
// capability the user consented to; pass requiredAppScope to demand another.
export const resolveActor = async (
  request: Request,
  opts: { requiredAppScope?: string } = {}
): Promise<Actor | Response> => {
  // App tokens are Bearer-only (never a cookie), so this probe is free for
  // cookie sessions; a user's own Bearer JWT fails the purpose check inside
  // resolveAppToken and falls through to the first-party path below.
  const ctx = await resolveAppToken(request);
  if (ctx) {
    const requestOrigin = request.headers.get('Origin');
    const cors = appCorsHeaders(requestOrigin);

    // Same origin binding as every embed route (apps/appRequest.ts): browser
    // calls carry Origin and it must equal the origin the token was granted
    // to; server-to-server calls (no Origin) pass.
    if (requestOrigin && requestOrigin !== ctx.origin) {
      return json({ ok: false, error: 'Origin does not match this token' }, { status: 403, headers: cors });
    }

    const requiredScope = opts.requiredAppScope ?? 'app-data';
    if (!scopeCovers(ctx.scopes, requiredScope)) {
      return json(
        { ok: false, error: `This token was not granted the ${requiredScope} scope` },
        { status: 403, headers: cors }
      );
    }

    return {
      kind: 'app',
      ctx,
      scope: appScopeOf(ctx),
      cors,
      rateIdentity: `user:${ctx.user.id}:app:${ctx.clientId}`
    };
  }

  const user = await getCurrentUser(request);
  if (user) return { kind: 'user', user };
  return { kind: 'anonymous' };
};
