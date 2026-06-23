import { exportJWK, importJWK, importPKCS8, importSPKI, SignJWT, jwtVerify } from 'jose';

const LEGACY_DEV_SECRET = 'dev-insecure-secret-change-me';
const DEFAULT_KEY_ID = 'thingtime-es256-1';
const DEFAULT_ISSUER = 'https://thingtime.com';

let es256PrivateKeyPromise: ReturnType<typeof importPKCS8> | null = null;
let es256PublicKeyPromise: ReturnType<typeof importSPKI> | ReturnType<typeof importJWK> | null = null;
let publicJwkPromise: Promise<Record<string, unknown> | null> | null = null;

const normalizePem = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const expanded = trimmed.replace(/\\n/g, '\n');
  if (expanded.includes('-----BEGIN')) return expanded;

  return Buffer.from(expanded, 'base64').toString('utf8').trim();
};

const getPrivateKeyPem = () => normalizePem(process.env.JWT_PRIVATE_KEY);

const getPublicKeyPem = () => {
  const configuredPublicKey = normalizePem(process.env.JWT_PUBLIC_KEY);
  if (configuredPublicKey) return configuredPublicKey;

  return null;
};

const getJwtKeyId = () => process.env.JWT_KEY_ID?.trim() || DEFAULT_KEY_ID;

export const getJwtIssuer = () => process.env.JWT_ISSUER?.trim() || process.env.APP_URL?.trim() || DEFAULT_ISSUER;

export const hasAsymmetricJwtKeys = () => Boolean(getPrivateKeyPem() || getPublicKeyPem());

const getEs256SigningKey = () => {
  const privateKey = getPrivateKeyPem();
  if (!privateKey) return null;

  es256PrivateKeyPromise ??= importPKCS8(privateKey, 'ES256');
  return es256PrivateKeyPromise;
};

const getPublicJwk = async () => {
  const publicKey = getPublicKeyPem();
  if (publicKey) {
    const key = await importSPKI(publicKey, 'ES256');
    return exportJWK(key);
  }

  const signingKey = getEs256SigningKey();
  if (!signingKey) return null;

  const privateJwk = await exportJWK(await signingKey);
  const { d: _d, ...publicJwk } = privateJwk;
  return publicJwk;
};

const getEs256VerifyKey = () => {
  const publicKey = getPublicKeyPem();
  if (publicKey) {
    es256PublicKeyPromise ??= importSPKI(publicKey, 'ES256');
    return es256PublicKeyPromise;
  }

  if (!getPrivateKeyPem()) return null;

  publicJwkPromise ??= getPublicJwk();
  es256PublicKeyPromise ??= publicJwkPromise.then((jwk) => (jwk ? importJWK(jwk, 'ES256') : null));
  return es256PublicKeyPromise;
};

// HS256 is kept only as a migration path for deployments that already minted
// cookies with JWT_SECRET before Thingtime moved to public-key verification.
const getLegacySecret = ({ allowDevFallback }: { allowDevFallback: boolean }) => {
  const secret = process.env.JWT_SECRET;
  if (secret) return new TextEncoder().encode(secret);

  if (!allowDevFallback) return null;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('[auth] JWT_PRIVATE_KEY or JWT_SECRET must be set before auth can run in production.');
  }

  console.warn('[auth] JWT key material is not set; using an insecure local-dev secret.');
  return new TextEncoder().encode(LEGACY_DEV_SECRET);
};

export type JwtClaims = { sub: string; jti: string };
export type PublicJwks = { keys: Array<Record<string, unknown>> };

// Sign a JWT carrying the user id (sub) + session id (jti) so the session can
// be revoked server-side (see sessions.ts).
export const signJwt = async ({ sub, jti, expiresIn = '30d' }: { sub: string; jti: string; expiresIn?: string }) => {
  const es256Key = getEs256SigningKey();
  if (es256Key) {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: getJwtKeyId(), typ: 'JWT' })
      .setIssuer(getJwtIssuer())
      .setSubject(sub)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(await es256Key);
  }

  const legacySecret = getLegacySecret({ allowDevFallback: true });
  if (!legacySecret) {
    throw new Error('[auth] JWT_PRIVATE_KEY or JWT_SECRET must be set before auth can run.');
  }

  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(legacySecret);
};

export const verifyJwt = async (token: string): Promise<JwtClaims | null> => {
  const es256Key = getEs256VerifyKey();
  if (es256Key) {
    try {
      const { payload } = await jwtVerify(token, await es256Key, { algorithms: ['ES256'] });
      if (!payload.sub || !payload.jti) return null;
      return { sub: String(payload.sub), jti: String(payload.jti) };
    } catch {
      // Try the legacy HS256 verifier below for sessions minted before ES256.
    }
  }

  const legacySecret = getLegacySecret({ allowDevFallback: process.env.NODE_ENV !== 'production' });
  if (!legacySecret) return null;

  try {
    const { payload } = await jwtVerify(token, legacySecret, { algorithms: ['HS256'] });
    if (!payload.sub || !payload.jti) return null;
    return { sub: String(payload.sub), jti: String(payload.jti) };
  } catch {
    return null;
  }
};

export const getPublicJwks = async (): Promise<PublicJwks> => {
  publicJwkPromise ??= getPublicJwk();
  const jwk = await publicJwkPromise;
  if (!jwk) return { keys: [] };

  return {
    keys: [
      {
        ...jwk,
        alg: 'ES256',
        kid: getJwtKeyId(),
        use: 'sig',
      },
    ],
  };
};
