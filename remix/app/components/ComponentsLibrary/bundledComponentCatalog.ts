import { ALL_SUITES } from '~/schemas/appSuites/index';
import { materializeSuite, type BehaviourSuite, type MaterializedSuite } from '~/schemas/behaviourSuites';
import { catalogEntryFrom, RESERVED_COMPONENT_ID_PREFIX } from './componentBrowseTypes';

// These are the existing bundled suite definitions, not persisted user Things.
// A preview never assigns their system provenance to the current workspace.
const materialized = new Map<string, MaterializedSuite>();
export function materializedSuite(suite: BehaviourSuite) {
 let value = materialized.get(suite.key);
 if (!value) { value = materializeSuite(suite, 'system'); materialized.set(suite.key, value); }
 return value;
}
export const bundledComponentEntries = () => ALL_SUITES.flatMap(suite => materializedSuite(suite).components.map(part => catalogEntryFrom(part.shareId, part.crystal)));
export function catalogEntriesFor(key: string) {
 const slug = key.startsWith(RESERVED_COMPONENT_ID_PREFIX) ? key.slice(RESERVED_COMPONENT_ID_PREFIX.length) : key;
 return bundledComponentEntries().filter(entry => entry.id === key || entry.crystal.componentKey === slug || entry.crystal.familyKey === slug);
}
