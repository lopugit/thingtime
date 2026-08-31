import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';

type CapabilityManifest = {
  schemaVersion?: number;
  origin?: string;
  features?: Record<string, { version?: string }>;
};

let manifestPromise: Promise<CapabilityManifest> | null = null;

export const requireThingtimeCapability = async (feature: string, minimumVersion: string) => {
  manifestPromise ??= fetch(THINGTIME_CAPABILITY_MANIFEST_PATH, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin'
  }).then(async (response) => {
    if (!response.ok) throw new Error('Thingtime capability manifest is unavailable');
    return response.json() as Promise<CapabilityManifest>;
  });
  try {
    const manifest = await manifestPromise;
    const expectedOrigin = window.location.origin;
    const version = manifest.features?.[feature]?.version;
    if (
      manifest.schemaVersion !== 1 || manifest.origin !== expectedOrigin ||
      typeof version !== 'string' || !capabilitySatisfies(version, minimumVersion)
    ) {
      throw new Error(`Thingtime capability ${feature} is incompatible`);
    }
  } catch (error) {
    manifestPromise = null;
    throw error;
  }
};
