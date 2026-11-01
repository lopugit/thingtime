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
export const encryptOwnerValue = (namespace: string, ownerId: string, id: string, value: string): EncryptedVaultValue => {
  const key = keyFor(namespace);
  if (!key) throw new Error('Secure Vault is unavailable. Configure a 32-byte Thingtime vault key.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${namespace}${ownerId}:${id}`));
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { cipherText: bytes.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
};
export const decryptOwnerValue = (namespace: string, ownerId: string, id: string, value: EncryptedVaultValue): string => {
  const key = keyFor(namespace);
  if (!key) throw new Error('Secure Vault is unavailable.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${namespace}${ownerId}:${id}`));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(value.cipherText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored credential cannot be decrypted with this account and vault key.');
  }
};
