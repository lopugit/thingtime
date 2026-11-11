import { createHash, randomBytes } from 'node:crypto';
import { createCookie } from '../../cookies';
import { THING_STORAGE_POLICY_PATH, type ThingStorageDevice } from '../../../utils/thingStoragePolicy';
import { signPurposeToken, verifyPurposeToken } from '../auth/jwt';
import { isStorageBrowserId } from './thingStoragePolicyCore';

const PURPOSE = 'thing-storage-browser-installation';
const cookieFor = (ownerId: string, origin: string) => createCookie(
  `tt_storage_${createHash('sha256').update(ownerId).digest('hex').slice(0, 24)}`,
  { httpOnly: true, secure: new URL(origin).protocol === 'https:', sameSite: 'strict', path: THING_STORAGE_POLICY_PATH, maxAge: 365 * 86400 }
);
type BrowserInstallation = ThingStorageDevice & { kind: 'browser' };

export async function readStorageBrowser(request: Request, ownerId: string): Promise<BrowserInstallation | null> {
  const origin = new URL(request.url).origin;
  try {
    const value = await cookieFor(ownerId, origin).parse(request.headers.get('Cookie'));
    if (typeof value !== 'string' || value.length > 2048) return null;
    const claims = await verifyPurposeToken(value, PURPOSE);
    return claims?.ownerId === ownerId && claims.origin === origin && isStorageBrowserId(claims.installationId)
      ? { id: claims.installationId, kind: 'browser' } : null;
  } catch { return null; }
}

export async function registerStorageBrowser(request: Request, ownerId: string) {
  const origin = new URL(request.url).origin;
  const installation: BrowserInstallation = await readStorageBrowser(request, ownerId) ??
    { id: `storage-browser-${randomBytes(16).toString('hex')}`, kind: 'browser' };
  const credential = await signPurposeToken(PURPOSE, { ownerId, origin, installationId: installation.id }, '365d');
  return { installation, cookie: await cookieFor(ownerId, origin).serialize(credential) };
}
