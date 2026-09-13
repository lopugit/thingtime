import assert from 'node:assert/strict';
import test from 'node:test';
import { importTransfer } from './importTransfer';
import { readManagedContentFolder } from './managedPlacement';
import { TRANSFER_FORMAT } from '../../../utils/thingTransfer/format';

test('managed placement metadata is owner/home scoped and never reads anonymous sources', async () => {
  let reads = 0;
  const deps: any = { customEndpoint: () => false, collection: async () => ({ findOne: async (query: any, options: any) => {
    reads++; assert.equal(query.ownerId, 'owner'); assert.equal(query.shareId, 'source');
    assert.deepEqual(options.projection, { folderId: 1 }); return { folderId: 'parent' };
  } }) };
  assert.equal(await readManagedContentFolder(undefined, 'source', deps), undefined);
  assert.equal(reads, 0);
  assert.equal(await readManagedContentFolder('owner', 'source', deps), 'parent');
  assert.equal(await readManagedContentFolder('owner', 'source', { ...deps, customEndpoint: () => true }), undefined);
  assert.equal(reads, 1);
});

for (const kind of ['theme', 'feed-algorithm']) test(`${kind} import remaps folders after creation, preserving dedicated cleanup`, async () => {
  const crystal = kind === 'theme' ? { name: 'Palette', theme: { colors: { ink: '#123456' } } } :
    { name: 'Interests', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null };
  const manifest = { format: TRANSFER_FORMAT, version: 1, roots: ['folder'], files: [], things: [
    { id: 'folder', thingtime: ['folder'], crystal: { name: 'Imported' } },
    { id: 'source', thingtime: [kind], crystal, folderId: 'folder' }
  ] };
  let folder: string | undefined;
  let removed = 0;
  const deps: any = {
    createTheme: async () => ({ ok: true, theme: { id: 'fresh' } }),
    createAlgorithm: async () => ({ ok: true, algorithm: { id: 'fresh' } }),
    create: async (_owner: string, input: any) => { folder = input.shareId; return { ok: true, doc: { shareId: input.shareId } }; },
    moveContent: async (owner: string, id: string, parent: string) => { assert.ok(folder); assert.deepEqual([owner, id, parent], ['owner', 'fresh', folder]); },
    removeTheme: async () => { removed++; return { ok: true }; }, removeAlgorithm: async () => { removed++; return { ok: true }; },
    remove: async () => ({ ok: true })
  };
  const result = await importTransfer({ id: 'owner' }, { manifest }, undefined, deps);
  assert.equal(result.ok, true);
  let placed = false;
  const standalone = { ...manifest, roots: ['source'], things: [{ id: 'source', thingtime: [kind], crystal }] };
  const selected = await importTransfer({ id: 'owner' }, { manifest: standalone, folderId: 'chosen-folder' }, undefined, {
    ...deps,
    create: async () => { throw new Error('Standalone managed content must use its dedicated creator'); },
    moveContent: async (owner: string, id: string, parent: string) => {
      placed = true;
      assert.deepEqual([owner, id, parent], ['owner', 'fresh', 'chosen-folder']);
    }
  });
  assert.equal(selected.ok, true);
  assert.equal(placed, true);
  const failure = await importTransfer({ id: 'owner' }, { manifest }, undefined, { ...deps, moveContent: async () => { throw new Error('folder conflict'); } });
  assert.equal(failure.ok, false); assert.equal(removed, 1);
});
