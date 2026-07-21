import { decodeJwt } from 'jose';

import { resolveSessionUser } from './getCurrentUser';
import { verifyJwt } from './jwt';
import { getLiveSession } from './sessions';

export type IntrospectionResult =
  | { active: false }
  | {
      active: true;
      sub: string;
      jti: string;
      purpose: 'session' | 'app';
      username?: string;
      client_id?: string;
      exp?: number;
      iat?: number;
      iss?: string;
    };

// RFC 7662-flavoured introspection: signature/expiry through the shared
// verifier, then LIVE revocation status from the Mongo sessions collection —
// the one thing offline JWKS verification (/api/v1/auth/jwks) cannot answer.
// Every invalid/expired/revoked shape returns the same { active: false } so
// the endpoint is not an oracle for WHY a token stopped working.
export const introspectToken = async (token: string): Promise<IntrospectionResult> => {
  const claims = await verifyJwt(token);
  if (!claims) return { active: false };

  const session = await getLiveSession(claims.jti);
  if (!session) return { active: false };
  if (String(session.userId) !== claims.sub) return { active: false };

  // decodeJwt without verification is safe here: the signature passed above
  const payload = decodeJwt(token);
  const base = {
    active: true as const,
    sub: claims.sub,
    jti: claims.jti,
    ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
    ...(typeof payload.iat === 'number' ? { iat: payload.iat } : {}),
    ...(typeof payload.iss === 'string' ? { iss: payload.iss } : {})
  };

  // third-party "Login with Thingtime" grants are live revocable sessions the
  // general auth path rejects on purpose (getCurrentUser refuses purpose
  // 'app') — report them as active app tokens so integrations can poll
  // revocation without holding full account credentials
  if (session.purpose === 'app') {
    const clientId = session.meta?.clientId;
    return { ...base, purpose: 'app', ...(typeof clientId === 'string' ? { client_id: clientId } : {}) };
  }

  // full account sessions go through THE session→user path so introspection
  // can never disagree with getCurrentUser
  const user = await resolveSessionUser(claims.jti, claims.sub);
  if (!user) return { active: false };

  return { ...base, purpose: 'session', username: user.username };
};
