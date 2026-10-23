import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  verify as verifySignatureWithKey
} from 'node:crypto';

import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';

import { PublicError, safeErrorText } from '../errors/safeError';

export type CryptoStandard = 'ES256' | 'ES384' | 'RS256' | 'EdDSA';
export type KeyEncoding = 'auto' | 'pem' | 'escaped-pem' | 'base64-pem' | 'base64url-pem' | 'jwk-json';
export type TextEncoding = 'utf8' | 'base64' | 'base64url' | 'hex';

type StandardConfig = {
  label: string;
  jwtAlg: CryptoStandard;
  hash: 'sha256' | 'sha384' | null;
  keyId: string;
  generate: () => ReturnType<typeof generateKeyPairSync>;
};

type KeyInput = {
  publicKey?: string;
  privateKey?: string;
  keyEncoding?: KeyEncoding;
  publicKeyEncoding?: KeyEncoding;
  privateKeyEncoding?: KeyEncoding;
};

const DEFAULT_ISSUER = 'https://thingtime.com';

export const CRYPTO_STANDARDS: Record<CryptoStandard, StandardConfig> = {
  ES256: {
    label: 'ES256 / P-256',
    jwtAlg: 'ES256',
    hash: 'sha256',
    keyId: 'thingtime-es256-1',
    generate: () => generateKeyPairSync('ec', { namedCurve: 'P-256' })
  },
  ES384: {
    label: 'ES384 / P-384',
    jwtAlg: 'ES384',
    hash: 'sha384',
    keyId: 'thingtime-es384-1',
    generate: () => generateKeyPairSync('ec', { namedCurve: 'P-384' })
  },
  RS256: {
    label: 'RS256 / RSA 3072',
    jwtAlg: 'RS256',
    hash: 'sha256',
    keyId: 'thingtime-rs256-1',
    generate: () => generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 0x10001 })
  },
  EdDSA: {
    label: 'EdDSA / Ed25519',
    jwtAlg: 'EdDSA',
    hash: null,
    keyId: 'thingtime-eddsa-1',
    generate: () => generateKeyPairSync('ed25519')
  }
};

type GenerateInput = {
  standard?: CryptoStandard;
  issuer?: string;
  keyId?: string;
};

type VerifyJwtInput = KeyInput & {
  token?: string;
  secret?: string;
  issuer?: string;
};

type VerifySignatureInput = KeyInput & {
  standard?: CryptoStandard;
  message?: string;
  messageEncoding?: TextEncoding;
  signature?: string;
  signatureEncoding?: 'base64' | 'base64url' | 'hex';
};

type MatchKeyPairInput = KeyInput;

const base64UrlToBase64 = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
};

const decodeBase64UrlText = (value: string) => Buffer.from(base64UrlToBase64(value), 'base64').toString('utf8');

const decodeText = (value = '', encoding: TextEncoding = 'utf8') => {
  if (encoding === 'hex') return Buffer.from(value.trim(), 'hex');
  if (encoding === 'base64') return Buffer.from(value.trim(), 'base64');
  if (encoding === 'base64url') return Buffer.from(base64UrlToBase64(value.trim()), 'base64');
  return Buffer.from(value, 'utf8');
};

const decodeKeyMaterial = (value?: string, encoding: KeyEncoding = 'auto') => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const parseJwk = (raw: string) => ({ key: JSON.parse(raw), format: 'jwk' });

  if (encoding === 'jwk-json') return parseJwk(trimmed);
  if (encoding === 'base64-pem') return Buffer.from(trimmed, 'base64').toString('utf8').trim();
  if (encoding === 'base64url-pem') return decodeBase64UrlText(trimmed).trim();
  if (encoding === 'escaped-pem') return trimmed.replace(/\\n/g, '\n');
  if (encoding === 'pem') return trimmed;

  const expanded = trimmed.replace(/\\n/g, '\n');
  if (expanded.includes('-----BEGIN')) return expanded;
  if (expanded.startsWith('{')) return parseJwk(expanded);

  for (const decode of [
    () => Buffer.from(trimmed, 'base64').toString('utf8').trim(),
    () => decodeBase64UrlText(trimmed).trim()
  ]) {
    try {
      const decoded = decode();
      if (decoded.includes('-----BEGIN')) return decoded;
      if (decoded.startsWith('{')) return parseJwk(decoded);
    } catch {
      // Keep trying supported auto-detection formats.
    }
  }

  return expanded;
};

const encodePemBase64 = (pem: string) => Buffer.from(pem).toString('base64');
const encodePemBase64Url = (pem: string) =>
  encodePemBase64(pem).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const escapePem = (pem: string) => pem.replace(/\n/g, '\\n');

const getStandard = (standard?: string) => {
  const key = standard && standard in CRYPTO_STANDARDS ? (standard as CryptoStandard) : 'ES256';
  return CRYPTO_STANDARDS[key];
};

const exportPrivatePem = (key: ReturnType<typeof createPrivateKey>) =>
  key.export({ type: 'pkcs8', format: 'pem' }).toString();

const exportPublicPem = (key: ReturnType<typeof createPublicKey>) =>
  key.export({ type: 'spki', format: 'pem' }).toString();

const normalizePrivatePem = (value?: string, encoding?: KeyEncoding) => {
  const material = decodeKeyMaterial(value, encoding || 'auto');
  if (!material) return null;
  return exportPrivatePem(createPrivateKey(material as any));
};

const normalizePublicPem = (value?: string, encoding?: KeyEncoding) => {
  const material = decodeKeyMaterial(value, encoding || 'auto');
  if (!material) return null;
  return exportPublicPem(createPublicKey(material as any));
};

const publicPemFromPrivatePem = (privatePem: string) => exportPublicPem(createPublicKey(createPrivateKey(privatePem)));

const configuredPublicPem = () => {
  const publicPem = normalizePublicPem(process.env.JWT_PUBLIC_KEY);
  if (publicPem) return publicPem;

  const privatePem = normalizePrivatePem(process.env.JWT_PRIVATE_KEY);
  return privatePem ? publicPemFromPrivatePem(privatePem) : null;
};

const resolvePublicPem = (input: KeyInput) => {
  const publicPem = normalizePublicPem(input.publicKey, input.publicKeyEncoding || input.keyEncoding);
  if (publicPem) return publicPem;

  const privatePem = normalizePrivatePem(input.privateKey, input.privateKeyEncoding || input.keyEncoding);
  if (privatePem) return publicPemFromPrivatePem(privatePem);

  return configuredPublicPem();
};

const decodeSignature = (signature?: string, encoding: VerifySignatureInput['signatureEncoding'] = 'base64') => {
  const trimmed = signature?.trim();
  if (!trimmed) throw new PublicError('Signature is required.');

  if (encoding === 'hex') return Buffer.from(trimmed, 'hex');
  if (encoding === 'base64url') return Buffer.from(base64UrlToBase64(trimmed), 'base64');

  return Buffer.from(trimmed, 'base64');
};

export const generateCryptoKeyPair = (input: GenerateInput = {}) => {
  const standard = getStandard(input.standard);
  const { privateKey, publicKey } = standard.generate();
  const privateKeyPem = exportPrivatePem(privateKey);
  const publicKeyPem = exportPublicPem(publicKey);
  const privateKeyEscapedPem = escapePem(privateKeyPem);
  const publicKeyEscapedPem = escapePem(publicKeyPem);
  const issuer = input.issuer?.trim() || process.env.JWT_ISSUER?.trim() || process.env.APP_URL?.trim() || DEFAULT_ISSUER;
  const keyId = input.keyId?.trim() || standard.keyId;
  const privateKeyBase64 = encodePemBase64(privateKeyPem);
  const publicKeyBase64 = encodePemBase64(publicKeyPem);
  const privateKeyBase64Url = encodePemBase64Url(privateKeyPem);
  const publicKeyBase64Url = encodePemBase64Url(publicKeyPem);
  const privateKeyJwk = privateKey.export({ format: 'jwk' } as any);
  const publicKeyJwk = publicKey.export({ format: 'jwk' } as any);
  const privateKeyJwkJson = JSON.stringify(privateKeyJwk);
  const publicKeyJwkJson = JSON.stringify(publicKeyJwk);
  const envBase64 = [
    `JWT_PRIVATE_KEY=${privateKeyBase64}`,
    `JWT_PUBLIC_KEY=${publicKeyBase64}`,
    `JWT_KEY_ID=${keyId}`,
    `JWT_ISSUER=${issuer}`
  ].join('\n');

  return {
    standard: standard.jwtAlg,
    label: standard.label,
    privateKeyPem,
    publicKeyPem,
    privateKeyEscapedPem,
    publicKeyEscapedPem,
    privateKeyBase64,
    publicKeyBase64,
    privateKeyBase64Url,
    publicKeyBase64Url,
    privateKeyJwk,
    publicKeyJwk,
    privateKeyJwkJson,
    publicKeyJwkJson,
    keyId,
    issuer,
    thingtimeAuthCompatible: standard.jwtAlg === 'ES256',
    envBase64,
    envEscapedPem: [
      `JWT_PRIVATE_KEY=${privateKeyEscapedPem}`,
      `JWT_PUBLIC_KEY=${publicKeyEscapedPem}`,
      `JWT_KEY_ID=${keyId}`,
      `JWT_ISSUER=${issuer}`
    ].join('\n'),
    envBase64Url: [
      `JWT_PRIVATE_KEY=${privateKeyBase64Url}`,
      `JWT_PUBLIC_KEY=${publicKeyBase64Url}`,
      `JWT_KEY_ID=${keyId}`,
      `JWT_ISSUER=${issuer}`
    ].join('\n'),
    envPem: [
      `JWT_PRIVATE_KEY=${privateKeyPem}`,
      `JWT_PUBLIC_KEY=${publicKeyPem}`,
      `JWT_KEY_ID=${keyId}`,
      `JWT_ISSUER=${issuer}`
    ].join('\n'),
    envJwkJson: [
      `JWT_PRIVATE_KEY=${privateKeyJwkJson}`,
      `JWT_PUBLIC_KEY=${publicKeyJwkJson}`,
      `JWT_KEY_ID=${keyId}`,
      `JWT_ISSUER=${issuer}`
    ].join('\n'),
    env: envBase64
  };
};

export const verifyJwtInput = async (input: VerifyJwtInput) => {
  const token = input.token?.trim();
  if (!token) throw new PublicError('JWT is required.');

  try {
    const protectedHeader = decodeProtectedHeader(token);
    const alg = String(protectedHeader.alg || '');
    if (!alg) throw new PublicError('JWT alg header is missing.');

    const verifyOptions = {
      algorithms: [alg],
      ...(input.issuer?.trim() ? { issuer: input.issuer.trim() } : {})
    };

    if (alg.startsWith('HS') && !(input.secret?.trim() || process.env.JWT_SECRET)) {
      throw new PublicError('HS JWT verification requires a secret.');
    }

    const key = alg.startsWith('HS')
      ? new TextEncoder().encode(input.secret?.trim() || process.env.JWT_SECRET || '')
      : await importSPKI(resolvePublicPem(input) || '', alg);

    const { payload } = await jwtVerify(token, key, verifyOptions);
    return {
      valid: true,
      protectedHeader,
      payload,
      subject: payload.sub || null,
      issuer: payload.iss || null,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : null
    };
  } catch (err) {
    return { valid: false, error: safeErrorText(err, 'crypto: verify-jwt', 'JWT verification failed') };
  }
};

export const verifySignedMessageInput = (input: VerifySignatureInput) => {
  const standard = getStandard(input.standard);
  const publicPem = resolvePublicPem(input);
  if (!publicPem) throw new PublicError('A public key or private key is required.');

  const message = decodeText(input.message ?? '', input.messageEncoding || 'utf8');
  const signature = decodeSignature(input.signature, input.signatureEncoding);
  const valid = verifySignatureWithKey(standard.hash, message, publicPem, signature);

  return {
    valid,
    standard: standard.jwtAlg,
    messageEncoding: input.messageEncoding || 'utf8',
    signatureEncoding: input.signatureEncoding || 'base64'
  };
};

export const matchKeyPairInput = (input: MatchKeyPairInput) => {
  const privatePem = normalizePrivatePem(input.privateKey, input.privateKeyEncoding || input.keyEncoding);
  const publicPem = normalizePublicPem(input.publicKey, input.publicKeyEncoding || input.keyEncoding);

  if (!privatePem || !publicPem) {
    throw new PublicError('Both private and public keys are required.');
  }

  const derivedPublicDer = createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'der' });
  const suppliedPublicDer = createPublicKey(publicPem).export({ type: 'spki', format: 'der' });

  return {
    matches: Buffer.compare(Buffer.from(derivedPublicDer), Buffer.from(suppliedPublicDer)) === 0,
    derivedPublicKeyPem: publicPemFromPrivatePem(privatePem)
  };
};
