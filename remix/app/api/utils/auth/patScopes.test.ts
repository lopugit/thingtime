import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  PAT_SCOPE_CATALOG,
  PAT_SCOPE_IDS,
  PAT_VISIBILITY_CATALOG,
  isKnownPatScope,
  isKnownPatVisibility,
  patScopeCovers
} from './patScopes.ts';

// patScopes.ts is the single source of truth shared by the server enforcement
// path (auth/patTokens.ts) and the Settings token-minter selector, so a widened
// validator here silently widens every token minted afterwards. These are the
// pure guards; the acl-level fence they feed lives in things.ts.

test('the visibility catalog is exactly the four known modes, in selector order', () => {
  assert.deepEqual(
    PAT_VISIBILITY_CATALOG.map((mode) => mode.id),
    ['all', 'public', 'private', 'hidden']
  );
  // every descriptor is renderable by the selector
  for (const mode of PAT_VISIBILITY_CATALOG) {
    assert.ok(mode.title, `${mode.id} has a title`);
    assert.ok(mode.description, `${mode.id} has a description`);
    assert.ok(mode.emoji, `${mode.id} has an emoji`);
  }
});

test('isKnownPatVisibility accepts only the three modes', () => {
  for (const mode of ['all', 'public', 'private']) assert.equal(isKnownPatVisibility(mode), true, mode);
  // mintPatToken rejects anything falsy-but-present, so a typo can never widen
  // a token to the unrestricted default by accident
  for (const bad of ['ALL', 'Public', 'privates', 'none', '', ' public', 'public ', 0, 1, true, false, null, undefined, {}, [], ['public']])
    assert.equal(isKnownPatVisibility(bad), false, JSON.stringify(bad));
});

test('visibility modes are NOT scopes and never leak into the scope catalog', () => {
  // the fence is orthogonal to the verb scopes — a token asking for
  // `visibility: 'public'` must not be satisfiable by granting a scope
  for (const mode of ['all', 'public', 'private']) assert.equal(isKnownPatScope(mode), false, mode);
  assert.equal(PAT_SCOPE_IDS.includes('public'), false);
  assert.equal(PAT_SCOPE_IDS.includes('visibility'), false);
});

test('scope ids are unique and every catalog leaf is a known scope', () => {
  assert.equal(new Set(PAT_SCOPE_IDS).size, PAT_SCOPE_IDS.length, 'no duplicate scope ids');
  for (const scope of PAT_SCOPE_CATALOG) assert.equal(isKnownPatScope(scope.id), true, scope.id);
});

test('isKnownPatScope rejects unknown paths and non-strings', () => {
  assert.equal(isKnownPatScope('things'), true);
  assert.equal(isKnownPatScope('things.nope'), false);
  assert.equal(isKnownPatScope('THINGS'), false);
  for (const bad of [null, undefined, 42, {}, ['things']]) assert.equal(isKnownPatScope(bad), false, JSON.stringify(bad));
});

test('an ancestor scope covers its descendants but never a sibling prefix', () => {
  assert.equal(patScopeCovers(['things'], 'things.create'), true);
  assert.equal(patScopeCovers(['things'], 'things'), true);
  assert.equal(patScopeCovers(['things.read'], 'things.read'), true);
  // a descendant must not cover its ancestor
  assert.equal(patScopeCovers(['things.read'], 'things'), false);
  assert.equal(patScopeCovers(['things.read'], 'things.create'), false);
  // prefix-without-dot is a different scope, not a child ('things' must not
  // cover a hypothetical 'thingsomething')
  assert.equal(patScopeCovers(['things'], 'thingsomething'), false);
  assert.equal(patScopeCovers([], 'things.read'), false);
});
