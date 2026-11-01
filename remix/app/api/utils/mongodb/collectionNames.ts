// Physical collection naming — the single source of truth for how a logical
// Thingtime collection name ("things") maps to the physical MongoDB collection
// the code actually touches ("things_v2").
//
// Every collection is registered in COLLECTION_SCHEMA_VERSIONS (schemas/
// registry.ts); its value is both the schemaVersion new docs are stamped with
// AND the _v<N> suffix of the physical collection. Old generations are never
// written again once the version bumps — they stay behind as frozen snapshots
// until the admin drops them via the drop-stale-collection-generations
// migration, which is what makes "run the migration, verify, then delete every
// <v<current> collection" safe.
//
// This module is intentionally PURE (no mongo/node imports) so colocated
// node --test unit tests can load it without a bundler — the registry.ts
// pattern.

// @ts-ignore Node executes TypeScript directly and requires the extension.
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';

// Canonical logical collection list (FUNDAMENTALS §3) — derived, never copied.
export const COLLECTIONS: string[] = Object.keys(COLLECTION_SCHEMA_VERSIONS);

const knownCollections = new Set(COLLECTIONS);

export const isKnownCollection = (logical: string): boolean => knownCollections.has(logical);

export const collectionVersion = (logical: string): number => {
  const version = COLLECTION_SCHEMA_VERSIONS[logical];
  // an unregistered name is a code bug (typo or a collection missing from the
  // registry), never a runtime condition — fail loudly at the call site
  if (!version) throw new Error(`Unknown Thingtime collection: ${logical}`);
  return version;
};

export const versionedCollectionName = (logical: string, version: number): string => `${logical}_v${version}`;

// The physical collection the code reads and writes TODAY for a logical name.
export const physicalCollectionName = (logical: string): string =>
  versionedCollectionName(logical, collectionVersion(logical));

export type PhysicalCollectionInfo = {
  // the physical MongoDB collection name as listed by the server
  physical: string;
  // the logical collection it belongs to
  collection: string;
  // parsed _v<N> suffix; null = a pre-versioning unversioned legacy name
  version: number | null;
  // this is the generation the code currently targets
  current: boolean;
  // superseded generation (unversioned legacy, or _v<N> below current) —
  // droppable once every migration reading from it reports zero pending
  stale: boolean;
};

// Classify the collection names reported by listCollections against the
// registry. Deterministic exact matching per known logical name (never a
// heuristic split on "_v": logical names may themselves contain underscores).
// Unknown names — system collections, anything not in the registry — are left
// out entirely and are never touched by adoption or cleanup.
export const classifyPhysicalCollections = (names: string[]): PhysicalCollectionInfo[] => {
  const rows: PhysicalCollectionInfo[] = [];
  for (const name of names) {
    for (const logical of COLLECTIONS) {
      let version: number | null | undefined;
      if (name === logical) version = null;
      else if (name.startsWith(`${logical}_v`)) {
        const suffix = name.slice(logical.length + 2);
        if (/^[1-9][0-9]*$/.test(suffix)) version = Number(suffix);
      }
      if (version === undefined) continue;
      const current = collectionVersion(logical);
      rows.push({
        physical: name,
        collection: logical,
        version,
        current: version === current,
        // a version ABOVE current (a rolled-back deploy's future generation)
        // is neither current nor stale — cleanup must leave it alone
        stale: version === null || version < current
      });
      break;
    }
  }
  return rows;
};
