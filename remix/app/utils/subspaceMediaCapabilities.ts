import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';

export const SUBSPACE_MEDIA_REQUIREMENTS = {
  'api.attachment-uploads': '1.4.0',
  'api.subspaces-update': '1.4.0',
  'api.attachment-content': '1.7.0'
} as const;

export const requireSubspaceMediaCapabilities = async () => {
  for (const [feature, version] of Object.entries(SUBSPACE_MEDIA_REQUIREMENTS)) await requireThingtimeCapability(feature, version);
};
