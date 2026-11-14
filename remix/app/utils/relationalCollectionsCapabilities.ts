import { requireActiveThingtimeCapability, requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';

export const SUBSPACE_COLLECTION_REQUIREMENTS = {
  create: { feature: 'api.subspaces', minimum: '1.8.0' },
  update: { feature: 'api.subspaces-update', minimum: '1.7.0' },
  feed: { feature: 'api.subspaces-feed', minimum: '1.5.0' },
  members: { feature: 'api.subspaces-members', minimum: '1.5.0' },
  transfer: { feature: 'api.subspaces-transfer', minimum: '1.4.0' }
} as const;
export const OAUTH_SHARING_READ_REQUIREMENTS = {
  'api.oauth-shared': '1.1.0',
  'api.oauth-userinfo': '1.1.0'
} as const;
export async function requireSubspaceCollectionCapability(operation: keyof typeof SUBSPACE_COLLECTION_REQUIREMENTS) {
  const { feature, minimum } = SUBSPACE_COLLECTION_REQUIREMENTS[operation];
  await requireActiveThingtimeCapability(feature, minimum);
}
export async function requireOAuthSharingCapabilities(desktop: boolean, signal?: AbortSignal) {
  const origin = window.location.origin;
  const requirements = { ...OAUTH_SHARING_READ_REQUIREMENTS,
    [desktop ? 'api.oauth-desktop-authorize' : 'api.oauth-authorize']: desktop ? '1.3.0' : '1.1.0' };
  await Promise.all(Object.entries(requirements).map(([feature, minimum]) => requireThingtimeCapability(feature, minimum, origin,
    { fetch, currentOrigin: () => window.location.origin, signal })));
}

/** Only the collection contracts used by account settings and learned feeds. */
export const ACCOUNT_COLLECTION_REQUIREMENTS = {
  'api.mongodb-endpoint': '1.2.0',
  'api.mongodb-endpoints': '1.1.0',
  'api.deployment-links': '1.1.0',
  'api.deployment-links-sync': '1.1.0',
  'api.algorithms': '1.2.0',
  'api.algorithms-update': '1.2.0',
  'api.algorithms-delete': '1.1.0',
  'api.algorithms-track': '1.1.0'
} as const;
export async function requireAccountCollectionCapability(feature: keyof typeof ACCOUNT_COLLECTION_REQUIREMENTS) {
  await requireThingtimeCapability(feature, ACCOUNT_COLLECTION_REQUIREMENTS[feature]);
}
