import { ensureHomeRelationshipKeys } from './collections';
import { isCustomMongoEndpointActive } from './endpoint';
import { thingUniqueKeyFilter, thingUniqueKeysFilter } from './uniqueKeys';

type RelationshipField = 'friendKey' | 'followKey' | 'memberKey' | 'dmKey' | 'inviteCode';

// Custom data planes retain their legacy indexed lookup and are never
// migrated by a home-only read. Identity/control-plane callers explicitly pin
// home even while a request carries a custom endpoint override.
export const createRelationshipLookup = (dependencies: { customActive: () => boolean; prepareHome: () => Promise<boolean> }) => {
	const ready = async ({ home = false }: { home?: boolean } = {}) => {
		if (!home && dependencies.customActive()) return false;
		return dependencies.prepareHome();
	};
	const filter = async (field: RelationshipField, value: string | readonly string[], options: { home?: boolean } = {}): Promise<Record<string, unknown>> => {
		const identity = { [`crystal.${field}`]: typeof value === 'string' ? value : { $in: [...value] } };
		if (!await ready(options)) return identity;
		// The shared key provides the selective seek; the original identity is a
		// cheap residual guard against stale keys after a relationship changes
		// (for example an imported DM becomes a group). Never return another slot.
		return { ...(typeof value === 'string' ? thingUniqueKeyFilter(field, value) : thingUniqueKeysFilter(field, value)), ...identity };
	};
	return { ready, filter };
};

const lookup = createRelationshipLookup({ customActive: isCustomMongoEndpointActive, prepareHome: ensureHomeRelationshipKeys });
export const ensureRelationshipLookupReady = lookup.ready;
export const relationshipLookupFilter = lookup.filter;
