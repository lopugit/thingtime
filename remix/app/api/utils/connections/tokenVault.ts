import { decryptUserVaultValue, encryptUserVaultValue } from '../auth/vaultKeys';
import { decryptOwnerValue, ownerVaultConfigured } from '../auth/vaultCipher';
import { fromBin, toBin } from '../auth/users';
import type { OAuthTokens } from './providers';
const NAMESPACE = 'thingtime-connections:v1:';
export { ownerVaultConfigured as connectionVaultConfigured };
export const packConnectionTokens = async (ownerId: string, accountId: string, tokens: OAuthTokens) =>
  toBin(JSON.stringify(await encryptUserVaultValue(ownerId, accountId, 'oauth', JSON.stringify(tokens))));
export const unpackConnectionTokens = async (doc: any): Promise<OAuthTokens | null> => {
  // Legacy shared credentials do not establish this user's private grant. Reconnect.
  if (!doc?.secure || !doc.ownerId || doc.ownerId === 'system') return null;
  try {
    const raw = JSON.parse(fromBin(doc.secure) || '{}');
    if (![1, 2].includes(raw.version)) return null;
    const tokens = JSON.parse(
      raw.version === 2
        ? await decryptUserVaultValue(String(doc.ownerId), String(doc.shareId), 'oauth', raw)
        : decryptOwnerValue(NAMESPACE, String(doc.ownerId), String(doc.shareId), raw)
    );
    return typeof tokens?.accessToken === 'string' && (tokens.accessToken || (typeof tokens.idToken === 'string' && tokens.idToken)) ? tokens : null;
  } catch {
    return null;
  }
};

// Metadata projection does not decrypt every account or perform N+1 key reads.
export const hasConnectionTokenEnvelope = (doc: any): boolean => {
  if (!doc?.secure || !doc.ownerId || doc.ownerId === 'system') return false;
  try {
    const raw = JSON.parse(fromBin(doc.secure));
    return [1, 2].includes(raw.version) && ['cipherText', 'iv', 'tag'].every((k) => typeof raw[k] === 'string' && raw[k]);
  } catch {
    return false;
  }
};
