/** Shared wire format and authenticated context for server and device vaults.
 * These primitives confer no authentication or permission to read a vault. */
export type VaultSealed = { cipherText: string; iv: string; tag: string };
export type VaultEnvelope = VaultSealed & { version: 2; keyId: string };
export type PasswordKeyEnvelope = VaultSealed & { version: 1; keyId: string; kdf: 'scrypt-32768-8-3'; salt: string };
export type SessionKeyEnvelope = VaultSealed & { version: 1; keyId: string; kdf: 'hkdf-sha256'; salt: string; sessionId: string; expiresAt: number };
export const VAULT_MAX_VALUE_BYTES = 64 * 1024;
export const VAULT_MAX_PASSWORD_BYTES = 4096;
export const vaultFailure = () => new Error('The saved vault key or value could not be unlocked.');
export const assertVaultIdentity = ({ ownerId, keyId }: { ownerId: string; keyId: string }) => {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 200 ||
    typeof keyId !== 'string' || !/^vault-key-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(keyId)) throw vaultFailure();
};
export const vaultValueContext = (ownerId: string, keyId: string, recordId: string, purpose: 'oauth' | 'secret') => {
  assertVaultIdentity({ ownerId, keyId });
  if (typeof recordId !== 'string' || !recordId || recordId.length > 200 || !['oauth', 'secret'].includes(purpose)) throw vaultFailure();
  return ['thingtime-vault-value:v2', ownerId, keyId, recordId, purpose];
};
export const vaultPasswordContext = (ownerId: string, keyId: string) => ['thingtime-vault-password:v1', ownerId, keyId, 'scrypt-32768-8-3'];
