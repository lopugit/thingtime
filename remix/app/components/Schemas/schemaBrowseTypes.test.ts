import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
  builtinSchemaForKey,
  parseSchemaDetailKey,
  schemaDetailKeyFor,
  schemaDetailPath,
  schemaSearchPath,
  seededBuiltinShareIds
} from './schemaBrowseTypes.ts';

// The ONE key a schema is addressed by outside the browse list — cards, the
// /schemas/:key page, and /search's ?schema= deep link all derive from
// schemaDetailKeyFor, so the rule is pinned here: a builtin registry schema is
// `builtin:<id>`, a community schema thing is its shareId.

test('schemaDetailKeyFor: builtin registry schema → builtin:<id>', () => {
  assert.equal(schemaDetailKeyFor({ origin: 'builtin', id: 'post' }), 'builtin:post');
  assert.equal(schemaDetailKeyFor({ origin: 'builtin', id: 'thing' }), 'builtin:thing');
});

test('schemaDetailKeyFor: community schema thing → its shareId, untouched', () => {
  assert.equal(schemaDetailKeyFor({ origin: 'community', id: 'abc123XYZ' }), 'abc123XYZ');
  assert.equal(schemaDetailKeyFor({ origin: 'community', id: 'schema-app-pokeworld-trainer' }), 'schema-app-pokeworld-trainer');
});

test('detail page and /search deep link speak the same encoded key', () => {
  const builtin = { origin: 'builtin', id: 'post' } as const;
  assert.equal(schemaDetailPath(builtin), '/schemas/builtin%3Apost');
  assert.equal(schemaSearchPath(builtin), '/search?schema=builtin%3Apost');
  const community = { origin: 'community', id: 'shareId-1' } as const;
  assert.equal(schemaDetailPath(community), '/schemas/shareId-1');
  assert.equal(schemaSearchPath(community), '/search?schema=shareId-1');
  // the path segment round-trips through the router's param decoding back to
  // the key the page resolves
  const param = decodeURIComponent(schemaDetailPath(builtin).slice('/schemas/'.length));
  assert.equal(param, schemaDetailKeyFor(builtin));
});

test('parseSchemaDetailKey resolves builtins first: builtin:<id>, the bare id, and the seeded mirror', () => {
  assert.deepEqual(parseSchemaDetailKey('builtin:post'), { origin: 'builtin', id: 'post' });
  assert.deepEqual(parseSchemaDetailKey('post'), { origin: 'builtin', id: 'post' });
  // the seed-builtin-schemas migration mirrors every builtin crystal schema
  // as a system-owned schema thing with shareId schema-<id>; that key shows
  // the registry entry, never a second copy
  assert.ok(seededBuiltinShareIds.has('schema-post'));
  assert.deepEqual(parseSchemaDetailKey('schema-post'), { origin: 'builtin', id: 'post' });
  assert.equal(builtinSchemaForKey('schema-post')?.id, 'post');
  // the root Thing schema is a builtin page too
  assert.deepEqual(parseSchemaDetailKey('builtin:thing'), { origin: 'builtin', id: 'thing' });
});

test('parseSchemaDetailKey: an unknown builtin names nothing, anything else is a community shareId', () => {
  assert.equal(parseSchemaDetailKey('builtin:definitely-not-a-schema'), null);
  assert.equal(parseSchemaDetailKey(''), null);
  assert.equal(parseSchemaDetailKey(undefined), null);
  assert.equal(parseSchemaDetailKey('   '), null);
  assert.deepEqual(parseSchemaDetailKey('schema-app-pokeworld-trainer'), { origin: 'community', id: 'schema-app-pokeworld-trainer' });
  assert.deepEqual(parseSchemaDetailKey('a1b2c3'), { origin: 'community', id: 'a1b2c3' });
  assert.equal(builtinSchemaForKey('a1b2c3'), null);
});
