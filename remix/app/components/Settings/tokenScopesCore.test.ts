import assert from 'node:assert/strict';
import test from 'node:test';
import { mintSelectedPatScopes } from './tokenScopesCore';

test('Things master selection preserves independent AI and reporting permissions', () => {
  assert.deepEqual(mintSelectedPatScopes(['things']), ['things']);
  assert.deepEqual(mintSelectedPatScopes(['ai.complete']), ['ai.complete']);
  assert.deepEqual(mintSelectedPatScopes(['things', 'ai.complete', 'agents.report']), ['things', 'ai.complete', 'agents.report']);
  assert.deepEqual(mintSelectedPatScopes(['things', 'things.read', 'ai.complete']), ['things', 'ai.complete']);
});
