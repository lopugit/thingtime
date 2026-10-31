import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  COLLECTIONS,
  classifyPhysicalCollections,
  collectionVersion,
  isKnownCollection,
  physicalCollectionName,
  versionedCollectionName
} from './collectionNames.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { resolvePipelineCollections } from './querySafety.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';

test('every registry collection resolves to <name>_v<version>', () => {
  assert.ok(COLLECTIONS.length >= 20, `registry should cover every collection (got ${COLLECTIONS.length})`);
  for (const logical of COLLECTIONS) {
    const version = COLLECTION_SCHEMA_VERSIONS[logical];
    assert.equal(collectionVersion(logical), version);
    assert.equal(physicalCollectionName(logical), `${logical}_v${version}`);
    assert.ok(isKnownCollection(logical));
  }
  assert.equal(physicalCollectionName('things'), `things_v${COLLECTION_SCHEMA_VERSIONS.things}`);
  assert.equal(versionedCollectionName('things', 7), 'things_v7');
});

test('unknown collection names fail loudly instead of minting a physical name', () => {
  assert.throws(() => physicalCollectionName('nope'), /Unknown Thingtime collection/);
  assert.throws(() => collectionVersion('thing'), /Unknown Thingtime collection/);
  assert.equal(isKnownCollection('nope'), false);
});

test('no logical name is ambiguous against another logical physical name', () => {
  // classifyPhysicalCollections matches per-logical by exact prefix; if one
  // logical's versioned name could parse as another logical, classification
  // (and therefore cleanup) would be nondeterministic
  for (const a of COLLECTIONS) {
    for (const b of COLLECTIONS) {
      if (a === b) continue;
      assert.ok(
        !new RegExp(`^${b}_v[1-9][0-9]*$`).test(a),
        `logical collection ${a} parses as a version of ${b}`
      );
    }
  }
});

test('classifyPhysicalCollections labels current, stale, ahead, and unknown', () => {
  const current = COLLECTION_SCHEMA_VERSIONS.things;
  const rows = classifyPhysicalCollections([
    `things_v${current}`, // current generation
    'things', // unversioned legacy — stale
    'things_v1', // below current — stale (current is >= 2)
    `things_v${current + 1}`, // ahead (rolled-back deploy) — NOT stale
    'things_v0', // invalid suffix — unknown, untouched
    'things_vX', // invalid suffix — unknown, untouched
    'system.views', // never ours
    'somethingelse' // not in the registry
  ]);
  const byPhysical = new Map(rows.map((row) => [row.physical, row]));

  assert.deepEqual(byPhysical.get(`things_v${current}`), {
    physical: `things_v${current}`,
    collection: 'things',
    version: current,
    current: true,
    stale: false
  });
  assert.deepEqual(byPhysical.get('things'), {
    physical: 'things',
    collection: 'things',
    version: null,
    current: false,
    stale: true
  });
  assert.equal(byPhysical.get('things_v1')?.stale, true);
  assert.deepEqual(byPhysical.get(`things_v${current + 1}`), {
    physical: `things_v${current + 1}`,
    collection: 'things',
    version: current + 1,
    current: false,
    stale: false
  });
  assert.equal(byPhysical.has('things_v0'), false);
  assert.equal(byPhysical.has('things_vX'), false);
  assert.equal(byPhysical.has('system.views'), false);
  assert.equal(byPhysical.has('somethingelse'), false);
});

test('resolvePipelineCollections rewrites every join target to its physical name', () => {
  const things = physicalCollectionName('things');
  const themes = physicalCollectionName('themes');
  const sessions = physicalCollectionName('sessions');
  const resolved = resolvePipelineCollections([
    { $match: { a: 1 } },
    {
      $lookup: {
        from: 'things',
        as: 'joined',
        pipeline: [{ $lookup: { from: 'themes', as: 'inner', pipeline: [] } }]
      }
    },
    { $graphLookup: { from: 'sessions', startWith: '$x' } },
    { $unionWith: 'themes' },
    { $unionWith: { coll: 'things', pipeline: [{ $unionWith: { coll: 'sessions' } }] } },
    { $facet: { branch: [{ $lookup: { from: 'things', as: 'j' } }] } }
  ]);

  assert.deepEqual(resolved[0], { $match: { a: 1 } });
  assert.equal((resolved[1] as any).$lookup.from, things);
  assert.equal((resolved[1] as any).$lookup.pipeline[0].$lookup.from, themes);
  assert.equal((resolved[2] as any).$graphLookup.from, sessions);
  assert.equal(resolved[3].$unionWith, themes);
  assert.equal((resolved[4] as any).$unionWith.coll, things);
  assert.equal((resolved[4] as any).$unionWith.pipeline[0].$unionWith.coll, sessions);
  assert.equal((resolved[5] as any).$facet.branch[0].$lookup.from, things);
  // never invents a collection: unknown strings pass through untouched
  const untouched = resolvePipelineCollections([{ $lookup: { from: 'not-a-collection', as: 'x' } }]);
  assert.equal((untouched[0] as any).$lookup.from, 'not-a-collection');
});
