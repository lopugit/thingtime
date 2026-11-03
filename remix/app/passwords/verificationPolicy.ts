/** Closed account-password confirmation policy. Never is durable device trust,
 * never a stored password, an anonymous session, or a substitute for OS presence. */
export const VERIFICATION_WINDOWS = [
  ['always', 'Ask every time', 0], ['5m', '5 minutes', 300], ['1h', '1 hour', 3600],
  ['6h', '6 hours', 21600], ['12h', '12 hours', 43200], ['1d', '1 day', 86400],
  ['2d', '2 days', 172800], ['3d', '3 days', 259200], ['14d', '14 days', 1209600],
  ['30d', '30 days', 2592000], ['60d', '60 days', 5184000], ['90d', '90 days', 7776000],
  ['1y', '1 year', 31536000], ['never', 'Never on this device', null],
] as const;
export type VerificationWindow = typeof VERIFICATION_WINDOWS[number][0];
export type EntryVerificationWindow = VerificationWindow | 'global';
export function verificationWindow(value: unknown): VerificationWindow {
  if (!VERIFICATION_WINDOWS.some(([id]) => id === value)) throw new Error('Choose a password confirmation interval.');
  return value as VerificationWindow;
}
export function entryVerificationWindow(value: unknown): EntryVerificationWindow {
  return value === 'global' ? 'global' : verificationWindow(value);
}
export const verificationSeconds = (value: VerificationWindow): number => VERIFICATION_WINDOWS.find(([id]) => id === value)![2] ?? Infinity;
export type VerificationContext = { purpose: 'create' | 'get' | 'fill' | 'account-create'; rp: string; entryId?: string; origin?: string; requestHash?: string };
export function verificationContext(value: any): VerificationContext {
  if (!value || !['create', 'get', 'fill', 'account-create'].includes(value.purpose) || typeof value.rp !== 'string' || value.rp !== value.rp.toLowerCase() ||
      !/^[a-z0-9.-]+$/.test(value.rp) || value.rp.startsWith('.') || value.rp.endsWith('.') || value.rp.includes('..') ||
      (!['create', 'account-create'].includes(value.purpose) && (typeof value.entryId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.entryId))) ||
      (value.purpose === 'account-create' && value.entryId !== undefined) || (value.purpose === 'create' && value.entryId !== undefined && !/^[a-f0-9-]{36}$/i.test(value.entryId))) throw new Error('A current passkey website and selected entry are required.');
  if (value.purpose === 'fill') { let url: URL; try { url = new URL(value.origin); } catch { throw new Error('An exact website origin is required.'); } if (url.origin !== value.origin || url.protocol !== 'https:' || url.hostname !== value.rp) throw new Error('An exact HTTPS website origin is required.'); }
  return { purpose: value.purpose, rp: value.rp, ...(!['create', 'account-create'].includes(value.purpose) ? { entryId: value.entryId } : {}), ...(value.purpose === 'create' && value.entryId ? {entryId: value.entryId} : {}), ...(value.purpose === 'fill' ? {origin: value.origin} : {}), ...(typeof value.requestHash === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.requestHash) ? {requestHash: value.requestHash} : {}) };
}
export type RememberedVerification = { verifiedAt: number; duration: VerificationWindow; session: string; passwordVersion: string; revoked?: boolean };
export function rememberedVerificationValid(grant: RememberedVerification | null, policy: VerificationWindow, session: string, passwordVersion: string, now: number): boolean {
  if (!grant || grant.revoked || grant.passwordVersion !== passwordVersion || policy === 'always' || grant.verifiedAt > now) return false;
  // Changing a preference never extends an older approval. Timed approvals are
  // session-bound; only explicit Never enrollment survives a future sign-in.
  const duration = Math.min(verificationSeconds(policy), verificationSeconds(grant.duration));
  return duration > 0 && (grant.duration === 'never' || grant.session === session) && now - grant.verifiedAt < duration * 1000;
}
