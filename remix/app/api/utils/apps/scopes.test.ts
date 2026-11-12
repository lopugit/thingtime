import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  APP_SCOPE_CATALOG,
  LEGACY_APP_SCOPES,
  isKnownScope,
  parseScopeParam,
  scopeCovers,
  sessionScopes
} from './scopes.ts';

test('profile.birthday is a known exact field scope', () => {
  const entry = APP_SCOPE_CATALOG.find((s) => s.id === 'profile.birthday');
  assert.ok(entry, 'catalog entry exists');
  assert.equal(entry?.kind, 'field');
  assert.equal(entry?.exact, true);
  assert.ok(isKnownScope('profile.birthday'));
});

test('a plain profile grant never covers the birthday (privacy-expanding leaf)', () => {
  assert.equal(scopeCovers(['profile'], 'profile.birthday'), false);
  assert.equal(scopeCovers(['profile', 'app-data'], 'profile.birthday'), false);
  // ...while ordinary profile leaves stay ancestor-covered
  assert.equal(scopeCovers(['profile'], 'profile.avatar'), true);
});

test('legacy tokens (pre-scopes) never gain the birthday', () => {
  assert.equal(scopeCovers(LEGACY_APP_SCOPES, 'profile.birthday'), false);
  assert.equal(scopeCovers(sessionScopes(undefined), 'profile.birthday'), false);
  assert.equal(scopeCovers(sessionScopes({}), 'profile.birthday'), false);
});

test('only the literal grant covers the birthday', () => {
  assert.equal(scopeCovers(['profile.birthday'], 'profile.birthday'), true);
  assert.equal(scopeCovers(['profile', 'profile.birthday'], 'profile.birthday'), true);
});

test('parseScopeParam accepts profile.birthday as an optional scope', () => {
  const parsed = parseScopeParam('profile.birthday', [], false);
  assert.deepEqual(parsed, { ok: true, scopes: ['profile.birthday'] });
});
