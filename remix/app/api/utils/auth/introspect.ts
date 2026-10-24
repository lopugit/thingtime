import { getJwtIssuer, verifyJwtClaims } from './jwt';
import { getLiveSession } from './sessions';

// RFC 7662-style token introspection. `/api/v1/auth/jwks` lets an external
// platform verify a Thingtime bearer token's signature/issuer/expiry OFFLINE,
// but offline verification cannot see a server-side revocation (logout, session
// deletion). This resolves the LIVE status by checking the Mongo `sessions`
// record the token's jti points at.
//
// The response mirrors the standard introspection shape: `active` is the single
// source of truth; identifying claims are echoed only when active. We never
// return user PII (email/username) here — this endpoint answers "is this token
// still good", not "who is it".

export type IntrospectionResult =
  | { active: false }
  | {
      active: true;
      sub: string;
      jti: string;
      iss: string;
      token_type: 'Bearer';
      purpose: 'browser' | 'service';
      exp?: number;
      iat?: number;
    };

const INACTIVE: IntrospectionResult = { active: false };

export const introspectToken = async (token: string | null | undefined): Promise<IntrospectionResult> => {
  if (!token) return INACTIVE;

  // Signature + expiry (offline). A bad signature / expired token is inactive.
  const claims = await verifyJwtClaims(token);
  if (!claims) return INACTIVE;

  // Live revocation: the jti must map to a session that still exists, isn't
  // revoked, and hasn't expired — and that belongs to the token's subject, so a
  // live jti can't be reported active under a different user (mirrors
  // resolveSessionUser's binding).
  const session = await getLiveSession(claims.jti);
  if (!session) return INACTIVE;
  if (String(session.userId) !== claims.sub) return INACTIVE;

  // App-scoped tokens (third-party "Login with Thingtime" grants) are a
  // different credential class resolved through the app-token path; they are not
  // introspectable as first-party account tokens here.
  if (session.purpose === 'app') return INACTIVE;

  return {
    active: true,
    sub: claims.sub,
    jti: claims.jti,
    iss: claims.iss ?? getJwtIssuer(),
    token_type: 'Bearer',
    purpose: session.purpose === 'service' ? 'service' : 'browser',
    exp: claims.exp,
    iat: claims.iat
  };
};
