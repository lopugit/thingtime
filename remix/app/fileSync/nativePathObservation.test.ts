import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePathObserver } from './nativePathObservation';
import { saved } from './foregroundSync.fixture';
import type { FolderHost } from './desktopFolders.client';

test('compound observer negotiates independent platform/version and retains exact root policy binding', async () => {
 let calls = 0;
 const host = { capabilities: { platform: 'macos', fileAccessVersion: '1.21.0' }, request: async (_owner, request) => {
  calls++; assert.equal(request.action, 'observe-path');
  if (request.action !== 'observe-path') throw Error('Unexpected request');
  assert.equal(request.observation.configurationId, saved.id); assert.equal(request.observation.configurationRevision, saved.updatedAt);
  assert.equal(request.rootId, saved.configuration.localRootId);
  return { roots: [{ id: saved.configuration.localRootId, name: 'Synthetic' }], conditions: { network: 'wifi', charging: true }, observedEntries: [null, null] };
 } } satisfies Pick<FolderHost, 'capabilities' | 'request'>;
 const controller = new AbortController(), observe = nativePathObserver(host, 'owner', controller.signal)!;
 assert.deepEqual((await observe('nested/file', 'nested', saved)).entries, [null, null]);
 assert.equal(calls, 1);
 await assert.rejects(observe('nested/file', 'other', saved)); assert.equal(calls, 1);
 controller.abort(); await assert.rejects(observe('nested/file', 'nested', saved)); assert.equal(calls, 1);
 for (const [platform, version] of [['macos', '1.20.0'], ['macos', '2.0.0'], ['ios', '1.21.0']] as const)
  assert.equal(nativePathObserver({ ...host, capabilities: { platform, fileAccessVersion: version } }, 'owner', new AbortController().signal), undefined);
});
