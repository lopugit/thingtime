import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract.ts';

export const MAC_FIXTURE_API_REQUIREMENTS = Object.freeze({
  'api.files': '1.10.0',
  'api.attachment-content': '1.17.2',
  'api.file-sync-batches': '1.3.0'
});

export function validateMacFixtureCapabilities(manifest, origin) {
  if (!manifest || manifest.origin !== origin) throw Error('Fixture capability manifest origin mismatch');
  for (const [feature, minimum] of Object.entries(MAC_FIXTURE_API_REQUIREMENTS)) {
    const version = manifest.features?.[feature]?.version;
    if (typeof version !== 'string' || !capabilitySatisfies(version, minimum))
      throw Error(`Fixture requires ${feature} ${minimum} or a compatible version`);
  }
  return manifest;
}
