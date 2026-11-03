import { browseStandards, componentForFeature } from '~/webPlatform/catalogue';
import type { ActionPack } from '../types';
export const WEB_STANDARDS_PACK_ARITIES = { 'webstandards.browse': { min: 0, max: 1 }, 'webstandards.component': { min: 1, max: 1 } };
export const webStandardsPack: ActionPack = {
	'webstandards.browse': ([filters]) => browseStandards(filters),
	'webstandards.component': ([id]) => componentForFeature(String(id))
};
