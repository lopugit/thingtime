import { scryptAsync } from '@noble/hashes/scrypt.js';
import { assertVaultIdentity, vaultFailure, vaultValueContext, vaultPasswordContext, VAULT_MAX_VALUE_BYTES, VAULT_MAX_PASSWORD_BYTES,
  type VaultSealed, type VaultEnvelope, type PasswordKeyEnvelope } from './vaultEnvelopeContract';

export type DeviceVaultKey = { id: string; bytes: Uint8Array };
const encoder = new TextEncoder();
const bytes = (value: Uint8Array): ArrayBuffer => Uint8Array.from(value).buffer;
const base64 = (value: Uint8Array) => {
  let text = ''; for (let offset = 0; offset < value.length; offset += 4096) text += String.fromCharCode(...value.subarray(offset, offset + 4096));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const decode = (value: string, max: number, exact?: number) => {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[\w-]*$/.test(value)) throw vaultFailure();
  const decoded = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  if (decoded.length > max || (exact !== undefined && decoded.length !== exact) || base64(decoded) !== value) throw vaultFailure();
  return decoded;
};
const importKey = (key: Uint8Array) => {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw vaultFailure();
  return crypto.subtle.importKey('raw', bytes(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
};
const seal = async (key: Uint8Array, context: string[], value: Uint8Array): Promise<VaultSealed> => {
  if (value.length > VAULT_MAX_VALUE_BYTES) throw vaultFailure();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const output = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(JSON.stringify(context)), tagLength: 128 }, await importKey(key), bytes(value)));
  return { cipherText: base64(output.subarray(0, -16)), tag: base64(output.subarray(-16)), iv: base64(iv) };
};
const open = async (key: Uint8Array, context: string[], envelope: VaultSealed) => {
  try {
    const iv = decode(envelope.iv, 12, 12), tag = decode(envelope.tag, 16, 16), cipherText = decode(envelope.cipherText, VAULT_MAX_VALUE_BYTES);
    const combined = new Uint8Array(cipherText.length + tag.length); combined.set(cipherText); combined.set(tag, cipherText.length);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(JSON.stringify(context)), tagLength: 128 }, await importKey(key), combined));
  } catch { throw vaultFailure(); }
};
export const createDeviceVaultKey = (): DeviceVaultKey => ({ id: `vault-key-${crypto.randomUUID()}`, bytes: crypto.getRandomValues(new Uint8Array(32)) });
export async function sealDeviceVaultValue(ownerId: string, key: DeviceVaultKey, recordId: string, value: string): Promise<VaultEnvelope> {
  if (typeof value !== 'string' || value.length > VAULT_MAX_VALUE_BYTES) throw vaultFailure();
  const plain = encoder.encode(value);
  try { return { version: 2, keyId: key.id, ...await seal(key.bytes, vaultValueContext(ownerId, key.id, recordId, 'secret'), plain) }; }
  finally { plain.fill(0); }
}
export async function openDeviceVaultValue(ownerId: string, key: DeviceVaultKey, recordId: string, envelope: VaultEnvelope): Promise<string> {
  if (envelope?.version !== 2 || envelope.keyId !== key.id) throw vaultFailure();
  const plain = await open(key.bytes, vaultValueContext(ownerId, key.id, recordId, 'secret'), envelope);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(plain); } finally { plain.fill(0); }
}
let deriving = false;
const passwordKey = async (password: string, salt: Uint8Array, check: () => void) => {
  if (typeof password !== 'string' || !password || password.length > VAULT_MAX_PASSWORD_BYTES) throw vaultFailure();
  if (deriving) throw new Error('Another device vault is unlocking. Try again shortly.');
  deriving = true; const input = encoder.encode(password);
  try {
    if (input.length > VAULT_MAX_PASSWORD_BYTES) throw vaultFailure(); check();
    return await scryptAsync(input, salt, { N: 32768, r: 8, p: 3, dkLen: 32, maxmem: 64 * 1024 * 1024, asyncTick: 8, onProgress: check });
  } finally { input.fill(0); deriving = false; }
};
export async function wrapDeviceVaultKey(ownerId: string, key: DeviceVaultKey, password: string, check = () => {}): Promise<PasswordKeyEnvelope> {
  assertVaultIdentity({ ownerId, keyId: key.id });
  const salt = crypto.getRandomValues(new Uint8Array(16)), wrappingKey = await passwordKey(password, salt, check);
  try {
    check(); return { version: 1, keyId: key.id, kdf: 'scrypt-32768-8-3', salt: base64(salt), ...await seal(wrappingKey, vaultPasswordContext(ownerId, key.id), key.bytes) };
  } finally { wrappingKey.fill(0); }
}
export async function unwrapDeviceVaultKey(ownerId: string, password: string, envelope: PasswordKeyEnvelope, check = () => {}): Promise<DeviceVaultKey> {
  if (envelope?.version !== 1 || envelope.kdf !== 'scrypt-32768-8-3') throw vaultFailure();
  assertVaultIdentity({ ownerId, keyId: envelope.keyId });
  const wrappingKey = await passwordKey(password, decode(envelope.salt, 16, 16), check);
  let key: Uint8Array | undefined;
  try {
    key = await open(wrappingKey, vaultPasswordContext(ownerId, envelope.keyId), envelope); check();
    if (key.length !== 32) throw vaultFailure(); return { id: envelope.keyId, bytes: key };
  } catch (error) { key?.fill(0); throw error; } finally { wrappingKey.fill(0); }
}

/** Keyed retry identity, matching the server writer without exposing a plain
 * password/content hash in local metadata. */
export async function deviceVaultWriteDigest(key: DeviceVaultKey, id: string, plain: string) {
  const value = encoder.encode(id + plain);
  try {
    const signingKey = await crypto.subtle.importKey('raw', bytes(key.bytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return base64(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, value)));
  } finally { value.fill(0); }
}
