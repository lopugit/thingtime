import { SignJWT, jwtVerify } from 'jose';

// HS256 signing secret. Set JWT_SECRET in every real environment; the dev
// fallback exists only so local work isn't blocked (and warns loudly).
const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn('[auth] JWT_SECRET is not set — using an insecure dev secret. Set JWT_SECRET before production.');
    return new TextEncoder().encode('dev-insecure-secret-change-me');
  }
  return new TextEncoder().encode(secret);
};

export type JwtClaims = { sub: string; jti: string };

// Sign a JWT carrying the user id (sub) + session id (jti) so the session can
// be revoked server-side (see sessions.ts).
export const signJwt = async ({ sub, jti, expiresIn = '30d' }: { sub: string; jti: string; expiresIn?: string }) => {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());
};

export const verifyJwt = async (token: string): Promise<JwtClaims | null> => {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || !payload.jti) return null;
    return { sub: String(payload.sub), jti: String(payload.jti) };
  } catch {
    return null;
  }
};
