import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';

type CapabilityManifest = {
  schemaVersion?: number;
  origin?: string;
  features?: Record<string, { version?: string }>;
};

export type CapabilityTransport = {
  fetch: typeof fetch;
  currentOrigin: () => string;
  signal?: AbortSignal;
};

export const createThingtimeCapabilityChecker = () => {
  let manifestPromise: Promise<CapabilityManifest> | null = null;
  let manifestOrigin: string | null = null;
  let manifestFetcher: typeof fetch | undefined;

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
      manifestOrigin = expectedOrigin;
      manifestFetcher = transport?.fetch;
    }
    // Native UI and selected API origins can differ. Public discovery must
    // reach the selected API, with no account cookies or redirect authority.
    // The existing scoped transport retains its identity/generation fences.
    const scoped = Boolean(transport) || expectedOrigin !== window.location.origin;
    const load = () => {
      const deadline = AbortSignal.timeout(20_000);
      return (transport?.fetch ?? fetch)(scoped ? new URL(THINGTIME_CAPABILITY_MANIFEST_PATH, origin).href : THINGTIME_CAPABILITY_MANIFEST_PATH, {
        headers: { Accept: 'application/json' },
        credentials: scoped ? 'omit' : 'same-origin',
        ...(scoped ? { redirect: 'error' as const } : {}),
        // A retry after deployment must not replay the browser's older manifest.
        // Successful checks still share this checker's in-memory request.
        cache: 'no-store',
        signal: transport?.signal ? AbortSignal.any([deadline, transport.signal]) : deadline
      }).then(async response => {
        if (!response.ok) throw new Error('Thingtime capability manifest is unavailable');
        return response.json() as Promise<CapabilityManifest>;
      });
    };
    const request = manifestPromise ??= load();
    try {
      const manifest = await request;
      assertCurrent();
      const version = manifest?.features?.[feature]?.version;
      if (
        manifest?.schemaVersion !== 1 || manifest.origin !== expectedOrigin ||
        typeof version !== 'string' || !capabilitySatisfies(version, minimumVersion)
      ) {
        throw new Error(`Thingtime capability ${feature} is incompatible`);
      }
    } catch (error) {
      // An older caller must not evict a newer retry that is already in flight.
      if (manifestPromise === request) manifestPromise = null;
      throw error;
    }
  };
};

export const requireThingtimeCapability = createThingtimeCapabilityChecker();
