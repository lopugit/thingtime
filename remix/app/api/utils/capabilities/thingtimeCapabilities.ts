import { apiEndpointDocs } from '../../../docs/apiDocs';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';

export { THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export const thingtimeCapabilityManifest = (origin: string) => {
  const normalizedOrigin = new URL(origin).origin;
  const features: Record<string, { version: string }> = Object.fromEntries([
    ['api.capabilities', { version: '1.0.0' }],
    ...apiEndpointDocs.map((doc) => [`api.${doc.id}`, { version: doc.featureVersion ?? '1.0.0' }])
  ]);
  for (const feature of Object.values(features)) {
    if (!SEMVER.test(feature.version)) throw new Error('Invalid API capability version');
  }
  const operations = [
    {
      feature: 'api.capabilities',
      methods: ['GET'],
      path: THINGTIME_CAPABILITY_MANIFEST_PATH
    },
    ...apiEndpointDocs.flatMap((doc) => [
      { feature: `api.${doc.id}`, methods: doc.methods, path: doc.endpoint },
      ...(doc.endpoint.startsWith('/api/v1/') || doc.id === 'apple-app-association'
        ? [{ feature: `api.${doc.id}`, methods: doc.id === 'apple-app-association' ? ['GET', 'POST'] : ['GET'], path: doc.docsEndpoint }]
        : [])
    ])
  ];
  return {
    schemaVersion: 1,
    origin: normalizedOrigin,
    features,
    operations
  };
};

export { capabilitySatisfies };
