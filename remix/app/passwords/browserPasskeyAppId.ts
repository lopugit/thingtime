import { getDomain } from 'tldts';

/** Fixed diagnostic codes; never return request values. WebAuthn 10.1.1's
 * documented same-site browser compatibility rule. No AppID URL is fetched.
 * This does not authorize an RP or allow a legacy U2F/AppID-bound signature. */
export function browserPasskeyAppIdReason(value: unknown, origin: string): 0 | 13 | 14 {
  if (typeof value !== 'string') return 13;
  // FIDO AppID/facets 3.1.2 step 2 defaults an empty AppID to this facet.
  if (value === '') return 0;
  if (value.trim() !== value || value.includes('\\')) return 13;
  let app: URL, caller: URL;
  try { app = new URL(value); caller = new URL(origin); } catch { return 13; }
  if (app.protocol !== 'https:' || caller.protocol !== 'https:' || app.username || app.password || app.hash) return 13;
  // Same-host is the original FIDO no-network rule (ports are not significant).
  if (app.hostname === caller.hostname) return 0;
  // Private suffixes keep different tenants separate (e.g. github.io, s3).
  const site = getDomain(caller.hostname, { allowPrivateDomains: true });
  return site && site === getDomain(app.hostname, { allowPrivateDomains: true }) ? 0 : 14;
}
