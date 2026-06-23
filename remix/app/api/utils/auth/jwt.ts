import { SignJWT, jwtVerify } from 'jose';

// HS256 signing secret. Set JWT_SECRET in every real environment. Local dev can
// use the fallback, but production must fail closed instead of minting tokens
// with a public, guessable secret.
const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return new TextEncoder().encode(secret);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('[auth] JWT_SECRET must be set before auth can run in production.');
  }

  console.warn('[auth] JWT_SECRET is not set — using an insecure local-dev secret.');
  return new TextEncoder().encode('dev-insecure-secret-change-me');
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
