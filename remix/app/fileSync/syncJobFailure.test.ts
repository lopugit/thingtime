import test from 'node:test';
import assert from 'node:assert/strict';
import { syncJobFailure, syncJobFailureMessage, isSyncJobFailure, syncJobAttentionMessage, SyncJobConfigurationChanged } from './syncJobFailure';
test('unknown failures never assert settings changed or disclose native details', () => {
 for (const cause of [Error('token=secret /Users/private/file https://private.invalid'), Error('different settings /private'), { message: 'secret' }, undefined]) {
  assert.equal(syncJobFailure(cause), 'unknown');
  assert.match(syncJobFailureMessage(syncJobFailure(cause)), /reason is unavailable/);
  assert.doesNotMatch(syncJobFailureMessage(syncJobFailure(cause)), /secret|\/Users|https:|different settings|Diagnostic:/);
 }
 assert.equal(isSyncJobFailure('__proto__'), false);
});
test('only the actual configuration admission refusal explains changed settings', () => {
 assert.equal(syncJobFailure(new SyncJobConfigurationChanged()), 'configuration-changed');
 assert.equal(syncJobFailure(Error('An unfinished sync job belongs to different settings. Restore its settings before retrying.')), 'unknown');
 assert.match(syncJobFailureMessage('configuration-changed'), /Pause sync before/);
 assert.equal(syncJobFailure(Error('Cloud sync request failed (403); retain this run for retry or reconciliation.')), 'cloud-authorization');
 assert.equal(syncJobFailure(Error('Cloud sync request failed (403); token=secret')), 'unknown');
 assert.equal(syncJobFailure(Error('Cloud sync request failed (403; read; ACCESS_DENIED); retain this run for retry or reconciliation.')), 'cloud-authorization');
 assert.equal(syncJobFailure(Error('Cloud sync request failed (409; write; STALE_REVISION); retain this run for retry or reconciliation.')), 'cloud-conflict');
 assert.doesNotMatch(syncJobFailureMessage(syncJobFailure(Error('Cloud sync request failed (403; secret; token=private); retain this run for retry or reconciliation.'))), /secret|private/);
});

test('actual cloud request formatter produces actionable codes without retaining private response details', async () => {
 const { cloudRequests } = await import('./cloudTransport');
 const scope = { origin: 'https://sync.example', ownerId: 'owner', dataPlane: 'home' as const, deviceId: 'device', rootId: 'connection' };
 for (const [status, reason] of [[403, 'cloud-authorization'], [409, 'cloud-conflict']] as const) {
  const transport = cloudRequests({ currentScope: () => scope, origin: () => scope.origin,
   requireCapability: async () => {}, fetch: async () => Response.json({ ok: false, error: 'private-token /Users/private/path' }, { status }) }, scope);
  await assert.rejects(transport.json('/api/v1/files'), cause => {
   assert.equal(syncJobFailure(cause), reason);
   assert.doesNotMatch(syncJobFailureMessage(syncJobFailure(cause)), /private|token|\/Users/);
   return true;
  });
 }
});

test('local and remote legacy attention share unknown copy without asserting policy changes', () => {
 assert.match(syncJobAttentionMessage({ intervalMs: 300_000 }), /^Automatic sync needs attention.*reason is unavailable/);
 assert.match(syncJobAttentionMessage({}), /^An earlier transfer needs attention/);
 assert.doesNotMatch(syncJobAttentionMessage({}), /changed settings|different settings/);
});
