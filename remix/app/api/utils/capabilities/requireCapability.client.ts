import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';

type CapabilityManifest = {
  schemaVersion?: number;
  origin?: string;
  features?: Record<string, { version?: string }>;
};

export const createThingtimeCapabilityChecker = () => {
  let manifestPromise: Promise<CapabilityManifest> | null = null;

  return async (feature: string, minimumVersion: string) => {
    const request = manifestPromise ??= fetch(THINGTIME_CAPABILITY_MANIFEST_PATH, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      // A retry after deployment must not replay the browser's older manifest.
      // Successful checks still share this checker's in-memory request.
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    }).then(async (response) => {
      if (!response.ok) throw new Error('Thingtime capability manifest is unavailable');
      return response.json() as Promise<CapabilityManifest>;
    });
    try {
      const manifest = await request;
      const expectedOrigin = window.location.origin;
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
