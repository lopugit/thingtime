import assert from 'node:assert/strict';
import test from 'node:test';
import { accountContentSnapshot, accountContentValue, ACCOUNT_CONTENT_BYTES } from './accountContent';

const base = { ownerId: 'owner', profile: { username: 'owner', ttid: 'owner' }, recentReactions: [] };
const reference = { formatVersion: 1, attemptId: '2bb54c8b-3a7e-4d98-9ac0-75f56f79018f', partCount: 1024, digest: 'a'.repeat(64) };

test('account snapshots retain immutable instruction references without materializing the checklist', () => {
  const snapshot = accountContentSnapshot({ ...base, preferences: { lopuInstructions: { revision: 'revision', reference } } });
  assert.equal(snapshot.version, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < ACCOUNT_CONTENT_BYTES);
  assert.deepEqual(accountContentValue(snapshot).preferences.lopuInstructions, { revision: 'revision', reference });
  assert.throws(() => accountContentValue({ ...snapshot, version: 1 }), 'old versions cannot claim reference support');
  assert.throws(() => accountContentSnapshot({ ...base, preferences: { lopuInstructions: { revision: 'revision', reference, instructions: [] } } }));
});

test('legacy inline instruction snapshots remain version one and preserve exact historical content', () => {
  const instructions = [{ id: 'off', text: 'Historical disabled preference', enabled: false }];
  const snapshot = accountContentSnapshot({ ...base, preferences: { lopuInstructions: { revision: null, instructions } } });
  assert.equal(snapshot.version, 1);
  assert.deepEqual(accountContentValue(snapshot).preferences.lopuInstructions, { revision: null, instructions });
  assert.throws(() => accountContentValue({ ...snapshot, version: 2 }));
  assert.throws(() => accountContentSnapshot({ ...base, preferences: { lopuInstructions: { revision: null, instructions: [{ ...instructions[0], text: ' changed ' }] } } }));
});
