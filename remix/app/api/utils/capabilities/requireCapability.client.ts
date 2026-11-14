import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';
import { ThingtimeApiError } from '../../../hooks/apiFailure';

type CapabilityManifest = {
  schemaVersion?: number;
  origin?: string;
  features?: Record<string, { version?: string }>;
};

export class IncompatibleThingtimeCapabilityError extends Error {
  constructor(public readonly feature: string, public readonly actual: string | null) {
    super(`Thingtime capability ${feature} is incompatible`);
    this.name = 'IncompatibleThingtimeCapabilityError';
  }
}

export type CapabilityTransport = {
  fetch: typeof fetch;
  currentOrigin: () => string;
  signal?: AbortSignal;
};

export const ACTIVE_API_CAPABILITY_MANIFEST_PATH = '/api/v1/capabilities';
export const CAPABILITY_MANIFEST_TTL_MS = 60_000;

/** The active API source traverses the same selected-origin gateway as API
 * calls. It never follows authority URLs supplied inside a manifest. */
export const createThingtimeCapabilityChecker = (options: { source?: 'origin' | 'active-api'; now?: () => number } = {}) => {
  const activeApi = options.source === 'active-api';
  const manifestPath = activeApi ? ACTIVE_API_CAPABILITY_MANIFEST_PATH : THINGTIME_CAPABILITY_MANIFEST_PATH;
  let manifestPromise: Promise<CapabilityManifest> | null = null;
  let manifestOrigin: string | null = null;
  let manifestFetcher: typeof fetch | undefined;
  let manifestSignal: AbortSignal | undefined;
  let manifestExpires = 0;
  let cachedManifest: CapabilityManifest | null = null;
  let cachedEtag: string | null = null;
  const now = options.now ?? Date.now;

  return async (feature: string, minimumVersion: string, expectedOrigin = window.location.origin, transport?: CapabilityTransport) => {
    const origin = new URL(expectedOrigin);
    if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== expectedOrigin || origin.username || origin.password) {
      throw new Error('Invalid Thingtime API origin');
    }
    const assertCurrent = () => {
      transport?.signal?.throwIfAborted();
      if (transport && transport.currentOrigin() !== expectedOrigin) throw new Error('The selected API server changed.');
    };
    assertCurrent();
    if (manifestOrigin !== expectedOrigin || manifestFetcher !== transport?.fetch) {
      manifestPromise = null;
      cachedManifest = null;
      cachedEtag = null;
      manifestSignal = undefined;
      manifestExpires = 0;
      manifestOrigin = expectedOrigin;
      manifestFetcher = transport?.fetch;
    }
    // Native/scoped discovery reaches the selected API without account cookies.
    // Same-origin web requests retain the browser's platform-protection cookie;
    // the manifest itself contains no account data. Active API discovery still
    // uses its fixed endpoint and refuses redirects in either case.

    const omitCredentials = Boolean(transport) || expectedOrigin !== window.location.origin;
    const scoped = activeApi || omitCredentials;
    const load = () => {
      const previousManifest = cachedManifest;
      const previousEtag = cachedEtag;
      const deadline = AbortSignal.timeout(20_000);
      const signal = transport?.signal ? AbortSignal.any([deadline, transport.signal]) : deadline;
      manifestSignal = signal;
      const transportFailure = (failure: unknown): never => {
        if (transport?.signal?.aborted) throw failure;
        throw new ThingtimeApiError(failure instanceof Error ? failure.message : 'Thingtime capability discovery failed', { status: null, method: 'GET', action: 'check server capabilities' });
      };
      return (transport?.fetch ?? fetch)(scoped ? new URL(manifestPath, origin).href : manifestPath, {
        headers: { Accept: 'application/json', ...(!activeApi && previousManifest && previousEtag ? { 'If-None-Match': previousEtag } : {}) },

        credentials: omitCredentials ? 'omit' : 'same-origin',
        ...(scoped ? { redirect: 'error' as const } : {}),
        // A retry after deployment must not replay the browser's older manifest.
        // Successful checks still share this checker's in-memory request.
        cache: 'no-store',
        signal
      }).catch(failure => {
        // Preserve the shared distinction between retryable transport failure
        // and refused/invalid authority. Explicit caller cancellation stays an
        // abort; a deadline or network interruption is a retryable read error.
        return transportFailure(failure);
      }).then(async response => {
        if (!activeApi && response.url && response.url !== new URL(manifestPath, origin).href) {
          await response.body?.cancel().catch(() => {});
          throw new Error('The capability response changed origin or endpoint.');
        }
        if (response.status === 304 && !activeApi && previousManifest && previousEtag) return { manifest: previousManifest, etag: previousEtag };
        if (!response.ok) throw new ThingtimeApiError('Thingtime capability manifest is unavailable', { status: response.status, method: 'GET', action: 'check server capabilities' });
        if (activeApi && response.url && response.url !== new URL(manifestPath, origin).href) {
          await response.body?.cancel().catch(() => {});
          throw new Error('The active API capability response changed origin or endpoint.');
        }
        // Headers can arrive before a deadline or connection failure. Classify
        // body transport separately; malformed JSON is still invalid authority.
        const body = await response.text().catch(transportFailure);
        const parsed = JSON.parse(body);
        if (!activeApi) return { manifest: parsed as CapabilityManifest, etag: response.headers.get('ETag') };
        // api.capabilities 1.0 is a registered flat feature-version contract.
        // Its legacy shape has no origin field: bind it to this fixed HTTP
        // endpoint/transport, and reject a contradictory explicit origin.
        if (parsed?.ok !== true || parsed.schemaVersion !== 1 || !parsed.features ||
            Array.isArray(parsed.features) || typeof parsed.features !== 'object' ||
            (parsed.origin !== undefined && parsed.origin !== expectedOrigin))
          throw new Error('The active API capability response is incompatible.');
        return { manifest: { schemaVersion: 1, origin: expectedOrigin, features: Object.fromEntries(
          Object.entries(parsed.features).filter(([, version]) => typeof version === 'string')
            .map(([feature, version]) => [feature, { version }])
        ) } as CapabilityManifest, etag: null };
      }).then(result => {
        if (result.manifest?.schemaVersion !== 1 || result.manifest.origin !== expectedOrigin)
          throw new Error(`Thingtime capability ${feature} is incompatible`);
        // A deadline belongs only to the in-flight request. It must never
        // invalidate a completed manifest or replace a newer origin's cache.
        if (manifestSignal === signal) {
          cachedManifest = result.manifest;
          cachedEtag = result.etag;
          manifestExpires = now() + CAPABILITY_MANIFEST_TTL_MS;
          manifestSignal = undefined;
        }
        return result.manifest;
      });
    };
    // StrictMode cleanup or a cancelled view may abort before the previous
    // promise rejection clears the cache. A new scope must not inherit it.
    if (manifestSignal?.aborted || (!manifestSignal && manifestExpires <= now())) manifestPromise = null;
    const request = manifestPromise ??= load();
    try {
      const manifest = await request;
      const version = manifest?.features?.[feature]?.version;
      if (manifest?.schemaVersion !== 1 || manifest.origin !== expectedOrigin)
        throw new Error(`Thingtime capability ${feature} is incompatible`);
      if (typeof version !== 'string' || !capabilitySatisfies(version, minimumVersion))
        throw new IncompatibleThingtimeCapabilityError(feature, typeof version === 'string' ? version : null);
    } catch (error) {
      // An older caller must not evict a newer retry that is already in flight.
      if (manifestPromise === request) {
        manifestPromise = null;
        manifestSignal = undefined;
        cachedManifest = null;
        cachedEtag = null;
        manifestExpires = 0;
      }
      throw error;
    }
    // A cancelled consumer must not invalidate a successful public manifest.
    assertCurrent();
  };
};

export const requireThingtimeCapability = createThingtimeCapabilityChecker();

export const requireActiveThingtimeCapability = createThingtimeCapabilityChecker({ source: 'active-api' });
