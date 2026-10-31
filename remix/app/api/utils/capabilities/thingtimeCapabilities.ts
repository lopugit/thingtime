import { apiEndpointDocs, apiSharedFeatureVersions } from '../../../docs/apiDocs';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';
import { gatewayAuthority, gatewayDescriptor, GatewayUnavailable } from '../deployment/environmentGateway';
import { gatewaySupportsOperation, isGatewayDataPath } from '../deployment/gatewayOperations';

export { THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

// Root-path (non-/api/v1) endpoints whose `-docs` twin is also routed to the
// API catch-all in nitro.config.ts, so the manifest must list that twin too.
export const ROOT_DOCS_TWIN_IDS: ReadonlySet<string> = new Set(['apple-app-association', 'seo-robots', 'seo-sitemap', 'social-card', 'environment-gateway']);

export const thingtimeCapabilityManifest = (origin: string) => {
  const normalizedOrigin = new URL(origin).origin;
  const features: Record<string, { version: string }> = Object.fromEntries([
    ['api.capabilities', { version: '1.0.0' }],
    ...Object.entries(apiSharedFeatureVersions).map(([feature, version]) => [feature, { version }]),
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
      ...(doc.endpoint.startsWith('/api/v1/') || ROOT_DOCS_TWIN_IDS.has(doc.id)
        ? [{ feature: `api.${doc.id}`, methods: ['apple-app-association', 'social-card', 'environment-gateway'].includes(doc.id) ? ['GET', 'POST'] : ['GET'], path: doc.docsEndpoint }]
        : [])
    ])
  ];
  return {
    schemaVersion: 1,
    origin: normalizedOrigin,
    gateway: gatewayDescriptor(),
    features,
    operations
  };
};

export { capabilitySatisfies };

/** A proxy origin promises only whole semantic contracts its current owner can execute. */
export const effectiveThingtimeCapabilityManifest = async (
  origin: string,
  resolveAuthority = gatewayAuthority.current
) => {
  const local = thingtimeCapabilityManifest(origin);
  // The canonical alias is the authority's bootstrap discovery endpoint. Fetching
  // it from itself would recurse. Standalone/dedicated builds execute locally.
  if (!local.gateway || local.origin === local.gateway.origin) return local;
  const authority = await resolveAuthority();
  if (!authority || authority.settings.origin !== local.gateway.origin ||
      authority.settings.environment !== local.gateway.environment ||
      authority.settings.deploymentId !== local.gateway.deploymentId) throw new GatewayUnavailable();
  if (authority.owner) return local;
  const unavailable = new Set<string>();
  for (const operation of local.operations) {
    if (isGatewayDataPath(operation.path) && !operation.methods.every(method =>
      gatewaySupportsOperation(authority.manifest, operation.feature, local.features[operation.feature].version, operation.path, method))) {
      unavailable.add(operation.feature);
    }
  }
  // Do not downgrade a feature to the owner's older contract: this branch's
  // runtime requires its local version and would refuse the same operation.
  return {
    ...local,
    features: Object.fromEntries(Object.entries(local.features).filter(([feature]) => !unavailable.has(feature))),
    operations: local.operations.filter(operation => !unavailable.has(operation.feature))
  };
};
