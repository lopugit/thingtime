import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export type EncryptedVaultValue = { cipherText: string; iv: string; tag: string };

// Shared owner-bound vault encryption. Existing user-vault bytes keep their key/AAD.
const keyFor = (namespace: string): Buffer | null => {
  const source = (process.env.THINGTIME_USER_VAULT_KEY || process.env.THINGTIME_ADMIN_VAULT_KEY || '').trim();
  if (!source) return null;
  const key = Buffer.from(source, 'base64url');
  return key.length === 32 ? createHmac('sha256', key).update(namespace).digest() : null;
};
export const ownerVaultConfigured = () => keyFor('thingtime-user-vault:v1:') !== null;
const encryptWithDerivedKey = (namespace: string, ownerId: string, id: string, value: string, key: Buffer): EncryptedVaultValue => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${namespace}${ownerId}:${id}`));
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { cipherText: bytes.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
};
const decryptWithDerivedKey = (namespace: string, ownerId: string, id: string, value: EncryptedVaultValue, key: Buffer): string => {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${namespace}${ownerId}:${id}`));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(value.cipherText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored credential cannot be decrypted with this account and vault key.');
  }
};

// Explicit protected-key path. No environment lookup or label-derived key.
// Existing env-backed callers above retain their exact derivation and AAD.
const explicitKey = (namespace: string, key: Uint8Array): Buffer => {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw new Error('Secure Vault is unavailable. A protected 32-byte key is required.');
  return createHmac('sha256', key).update(namespace).digest();
};
export const encryptOwnerValueWithKey = (namespace: string, ownerId: string, id: string, value: string, key: Uint8Array): EncryptedVaultValue => {
  const derived = explicitKey(namespace, key);
  try { return encryptWithDerivedKey(namespace, ownerId, id, value, derived); }
  finally { derived.fill(0); }
};
export const decryptOwnerValueWithKey = (namespace: string, ownerId: string, id: string, value: EncryptedVaultValue, key: Uint8Array): string => {
  const derived = explicitKey(namespace, key);
  try { return decryptWithDerivedKey(namespace, ownerId, id, value, derived); }
  finally { derived.fill(0); }
};
export const encryptOwnerValue = (namespace: string, ownerId: string, id: string, value: string): EncryptedVaultValue => {
  const key = keyFor(namespace);
  if (!key) throw new Error('Secure Vault is unavailable. Configure a 32-byte Thingtime vault key.');
  return encryptWithDerivedKey(namespace, ownerId, id, value, key);
};
export const decryptOwnerValue = (namespace: string, ownerId: string, id: string, value: EncryptedVaultValue): string => {
  const key = keyFor(namespace);
  if (!key) throw new Error('Secure Vault is unavailable.');
  return decryptWithDerivedKey(namespace, ownerId, id, value, key);
};
