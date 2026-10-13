import { encryptOwnerValue, decryptOwnerValue, ownerVaultConfigured } from '../auth/vaultCipher';
import { fromBin, toBin } from '../auth/users';
import type { OAuthTokens } from './providers';
const NAMESPACE = 'thingtime-connections:v1:';
export { ownerVaultConfigured as connectionVaultConfigured };
export const packConnectionTokens = (ownerId: string, accountId: string, tokens: OAuthTokens) =>
  toBin(JSON.stringify({ version: 1, ...encryptOwnerValue(NAMESPACE, ownerId, accountId, JSON.stringify(tokens)) }));
export const unpackConnectionTokens = (doc: any): OAuthTokens | null => {
  // Legacy shared credentials do not establish this user's private grant. Reconnect.
  if (!doc?.secure || !doc.ownerId || doc.ownerId === 'system') return null;
  try {
    const raw = JSON.parse(fromBin(doc.secure) || '{}');
    if (raw.version !== 1) return null;
    const tokens = JSON.parse(decryptOwnerValue(NAMESPACE, String(doc.ownerId), String(doc.shareId), raw));
    return typeof tokens?.accessToken === 'string' && (tokens.accessToken || (typeof tokens.idToken === 'string' && tokens.idToken)) ? tokens : null;
  } catch {
    return null;
  }
};
