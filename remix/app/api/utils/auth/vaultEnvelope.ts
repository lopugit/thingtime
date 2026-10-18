import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { assertVaultIdentity as identity, vaultValueContext as valueContext, vaultPasswordContext as passwordContext, vaultFailure as failure,
  VAULT_MAX_VALUE_BYTES as MAX_VALUE_BYTES, VAULT_MAX_PASSWORD_BYTES, type VaultSealed as Sealed, type VaultEnvelope, type PasswordKeyEnvelope, type SessionKeyEnvelope } from '../../../passwords/vaultEnvelopeContract';
export type { VaultEnvelope, PasswordKeyEnvelope, SessionKeyEnvelope } from '../../../passwords/vaultEnvelopeContract';

// Cryptographic primitives for the password/session vault migration. These do
// not authenticate a caller or choose a recovery/background-access policy.
// Integration must verify the password or live session before using a wrapper.
// A stable random data key allows password/session rotation without rewriting
// every provider credential. Never derive a data key from a stored password hash.
export type VaultDataKey = { id: string; bytes: Buffer };
type Session = { id: string; token: string; expiresAt: number };
const keyBytes = (key: Buffer) => {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw failure();
  return key;
};
const decode = (value: string, max: number, exact?: number) => {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[\w-]*$/.test(value)) throw failure();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length > max || (exact !== undefined && bytes.length !== exact) || bytes.toString('base64url') !== value) throw failure();
  return bytes;
};
const seal = (key: Buffer, aad: string[], value: Buffer, maxBytes = MAX_VALUE_BYTES): Sealed => {
  if (value.length > maxBytes) throw failure();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(aad)));
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return { cipherText: encrypted.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
};
const open = (key: Buffer, aad: string[], value: Sealed, maxBytes = MAX_VALUE_BYTES) => {
  let partial: Buffer | undefined;
  try {
    const iv = decode(value.iv, 12, 12), tag = decode(value.tag, 16, 16), cipherText = decode(value.cipherText, maxBytes);
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(JSON.stringify(aad)));
    decipher.setAuthTag(tag);
    partial = decipher.update(cipherText);
    return Buffer.concat([partial, decipher.final()]);
  } catch { throw failure(); }
  finally { partial?.fill(0); }
};
export const createVaultDataKey = (): VaultDataKey => ({ id: `vault-key-${randomUUID()}`, bytes: randomBytes(32) });
export const sealVaultValue = (ownerId: string, key: VaultDataKey, recordId: string, purpose: 'oauth' | 'secret', value: string, maxBytes = MAX_VALUE_BYTES): VaultEnvelope => {
  if (typeof value !== 'string' || Buffer.byteLength(value) > maxBytes) throw failure();
  const plain = Buffer.from(value);
  try { return { version: 2, keyId: key.id, ...seal(key.bytes, valueContext(ownerId, key.id, recordId, purpose), plain, maxBytes) }; }
  finally { plain.fill(0); }
};
export const openVaultValue = (ownerId: string, key: VaultDataKey, recordId: string, purpose: 'oauth' | 'secret', value: VaultEnvelope, maxBytes = MAX_VALUE_BYTES): string => {
  if (value?.version !== 2 || value.keyId !== key.id) throw failure();
  const plain = open(key.bytes, valueContext(ownerId, key.id, recordId, purpose), value, maxBytes);
  try { return plain.toString('utf8'); } finally { plain.fill(0); }
};

// OWASP's 32-MiB scrypt configuration; fixed parameters prevent stored data
// from selecting a cheap KDF or forcing unbounded allocations. Password input
// is exact (no trimming, normalization, or bcrypt-style truncation).
const passwordKey = async (password: string, salt: Buffer) => {
  if (typeof password !== 'string' || !password || Buffer.byteLength(password) > VAULT_MAX_PASSWORD_BYTES) throw failure();
  const bytes = Buffer.from(password);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(bytes, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(failure()) : resolve(key));
    });
  } finally { bytes.fill(0); }
};
const openKey = (wrappingKey: Buffer, context: string[], envelope: Sealed & { keyId: string }): VaultDataKey => {
  const bytes = open(wrappingKey, context, envelope);
  if (bytes.length !== 32) { bytes.fill(0); throw failure(); }
  return { id: envelope.keyId, bytes };
};
export const wrapVaultKeyWithPassword = async (ownerId: string, key: VaultDataKey, password: string): Promise<PasswordKeyEnvelope> => {
  identity({ ownerId, keyId: key.id });
  const salt = randomBytes(16), wrappingKey = await passwordKey(password, salt);
  try {
    return { version: 1, keyId: key.id, kdf: 'scrypt-32768-8-3', salt: salt.toString('base64url'), ...seal(wrappingKey, passwordContext(ownerId, key.id), keyBytes(key.bytes)) };
  } finally { wrappingKey.fill(0); }
};
export const unwrapVaultKeyWithPassword = async (ownerId: string, password: string, envelope: PasswordKeyEnvelope): Promise<VaultDataKey> => {
  if (envelope?.version !== 1 || envelope.kdf !== 'scrypt-32768-8-3') throw failure();
  identity({ ownerId, keyId: envelope.keyId });
  const wrappingKey = await passwordKey(password, decode(envelope.salt, 16, 16));
  try { return openKey(wrappingKey, passwordContext(ownerId, envelope.keyId), envelope); }
  finally { wrappingKey.fill(0); }
};

const sessionContext = (ownerId: string, keyId: string, session: Session, now: number) => {
  identity({ ownerId, keyId });
  if (typeof session.id !== 'string' || !session.id || session.id.length > 200 ||
      typeof session.token !== 'string' || !session.token || Buffer.byteLength(session.token) > 16384 ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now) throw failure();
  return ['thingtime-vault-session:v1', ownerId, keyId, session.id, String(session.expiresAt)];
};
export const wrapVaultKeyWithSession = (ownerId: string, key: VaultDataKey, session: Session, now = Date.now()): SessionKeyEnvelope => {
  const context = sessionContext(ownerId, key.id, session, now), salt = randomBytes(16);
  const wrappingKey = Buffer.from(hkdfSync('sha256', session.token, salt, JSON.stringify(context), 32));
  try {
    return { version: 1, keyId: key.id, kdf: 'hkdf-sha256', salt: salt.toString('base64url'), sessionId: session.id,
      expiresAt: session.expiresAt, ...seal(wrappingKey, context, keyBytes(key.bytes)) };
  } finally { wrappingKey.fill(0); }
};
export const unwrapVaultKeyWithSession = (ownerId: string, session: Session, envelope: SessionKeyEnvelope, now = Date.now()): VaultDataKey => {
  if (envelope?.version !== 1 || envelope.kdf !== 'hkdf-sha256' || envelope.sessionId !== session.id || envelope.expiresAt !== session.expiresAt) throw failure();
  const context = sessionContext(ownerId, envelope.keyId, session, now);
  const wrappingKey = Buffer.from(hkdfSync('sha256', session.token, decode(envelope.salt, 16, 16), JSON.stringify(context), 32));
  try { return openKey(wrappingKey, context, envelope); }
  finally { wrappingKey.fill(0); }
};
