import { apiEndpointDocs } from '../../../docs/apiDocs';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';
import type { GatewayManifest } from './environmentGateway';

// Shared by request admission and effective discovery: these predicates must agree.
export const isGatewayDataPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/') ||
  pathname === '/social-card' || pathname === '/sitemap.xml' || apiEndpointDocs.some(doc => doc.endpoint === pathname &&
    pathname !== THINGTIME_CAPABILITY_MANIFEST_PATH);

export const gatewaySupportsOperation = (manifest: GatewayManifest, feature: string, required: string, path: string, method: string) => {
  const version = manifest.features?.[feature]?.version;
  return typeof version === 'string' && capabilitySatisfies(version, required) &&
    Array.isArray(manifest.operations) && manifest.operations.some(operation => operation &&
      operation.feature === feature && operation.path === path && Array.isArray(operation.methods) && operation.methods.includes(method));
};
