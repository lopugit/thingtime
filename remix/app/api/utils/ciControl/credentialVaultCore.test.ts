import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCredentialName,
  normalizeCredentialPlatform,
  normalizeBootstrapCredentials,
  normalizeCredentialOrder,
  parseLopuCredentialFetchRequest
} from './credentialVaultCore.ts';

const now = Date.parse('2026-08-31T05:00:00.000Z');
const valid = {
  repository: 'lopugit/thingtime',
  workflowRef: 'lopugit/thingtime/.github/workflows/resolve-pr-conflicts.yml@refs/heads/github-actions',
  runId: '123456',
  runAttempt: '1',
  nonce: 'abcdefghijklmnopqrstuvwxyz012345',
  requestedAt: new Date(now).toISOString()
};

test('normalizes names and exact unique order arrays', () => {
  assert.equal(normalizeCredentialName('  Thingtime Claude  '), 'Thingtime Claude');
  assert.equal(normalizeCredentialName(''), null);
  assert.equal(normalizeCredentialPlatform('  OpenAI  '), 'OpenAI');
  assert.equal(normalizeCredentialPlatform('bad\nplatform'), null);
  assert.deepEqual(normalizeCredentialOrder(['a', 'b']), ['a', 'b']);
  assert.equal(normalizeCredentialOrder(['a', 'a']), null);
  assert.equal(normalizeCredentialOrder(new Array(9).fill(0).map((_, index) => `id-${index}`)), null);
});

test('accepts only bounded unique bootstrap rows', () => {
  assert.deepEqual(normalizeBootstrapCredentials([{ name: ' Thingtime ', value: ' token ' }]), [{ name: 'Thingtime', value: 'token' }]);
  assert.equal(normalizeBootstrapCredentials([{ name: 'same', value: 'one' }, { name: 'same', value: 'two' }]), null);
  assert.equal(normalizeBootstrapCredentials([{ name: '', value: 'token' }]), null);
});

test('accepts only fresh protected-controller workflow requests', () => {
  assert.ok(parseLopuCredentialFetchRequest(valid, { repository: 'lopugit/thingtime', now }));
  assert.equal(parseLopuCredentialFetchRequest({ ...valid, repository: 'other/repo' }, { repository: 'lopugit/thingtime', now }), null);
  assert.equal(parseLopuCredentialFetchRequest({ ...valid, workflowRef: valid.workflowRef.replace('github-actions', 'develop') }, { repository: 'lopugit/thingtime', now }), null);
  assert.ok(parseLopuCredentialFetchRequest({ ...valid, workflowRef: valid.workflowRef.replace('github-actions', 'develop') }, { repository: 'lopugit/thingtime', allowedRefs: ['github-actions', 'develop', 'main'], now }));
  assert.equal(parseLopuCredentialFetchRequest({ ...valid, workflowRef: valid.workflowRef.replace('resolve-pr-conflicts.yml', 'untrusted.yml') }, { repository: 'lopugit/thingtime', allowedRefs: ['github-actions', 'develop', 'main'], now }), null);
  assert.equal(parseLopuCredentialFetchRequest({ ...valid, requestedAt: new Date(now - 6 * 60 * 1000).toISOString() }, { repository: 'lopugit/thingtime', now }), null);
  assert.equal(parseLopuCredentialFetchRequest({ ...valid, nonce: 'too-short' }, { repository: 'lopugit/thingtime', now }), null);
});
