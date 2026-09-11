import assert from 'node:assert/strict';
import test from 'node:test';
import { appAccountAllows, appAccountThingScopes } from './accountScopes';
import { scopeCovers, parseScopeParam, sanitizeGrantedScopes } from './scopes';

test('legacy picker and namespace grants never imply account access or action execution', () => {
  for (const grant of [['things'], ['app-data'], ['profile', 'things', 'app-data']]) {
    assert.equal(appAccountAllows(grant, 'things.read'), false);
    assert.deepEqual(appAccountThingScopes(grant), []);
    assert.equal(scopeCovers(grant, 'actions.run'), false);
    assert.equal(scopeCovers(grant, 'lopu.voice'), false);
  }
});

test('all Things and individual permissions enforce every requested operation', () => {
  assert.equal(appAccountAllows(['account.things'], ['things.read', 'things.create', 'things.delete']), true);
  assert.equal(appAccountAllows(['account.things.read'], 'things.read'), true);
  assert.equal(appAccountAllows(['account.things.read'], 'things.create'), false);
  assert.equal(appAccountAllows(['account.things.create'], ['things.create', 'things.update']), false);
  assert.deepEqual(appAccountThingScopes(['account.things.read', 'actions.run']), ['things.read']);
});

test('expanded permissions parse and stay absent when the user declines optional access', () => {
  const requested = ['account.things', 'actions.run', 'lopu.chat', 'lopu.voice', 'lopu.recordings'];
  assert.equal(parseScopeParam(requested.join(' ')).ok, true);
  const result = sanitizeGrantedScopes(['profile.username'], ['profile.username'], requested, true);
  assert.equal(result.ok, true);
  if (result.ok) for (const scope of requested) assert.equal(scopeCovers(result.scopes, scope), false);
  assert.equal(scopeCovers(['lopu.chat'], 'actions.run'), false);
  assert.equal(scopeCovers(['actions.run'], 'lopu.voice'), false);
});
