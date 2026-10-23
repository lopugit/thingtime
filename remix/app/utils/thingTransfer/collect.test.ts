import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTransfer, type TransferSource } from './collect';
import type { TransferThing } from './format';

const make = (id: string, kind = 'data', folderId?: string): TransferThing => ({ id, thingtime: [kind], crystal: { name: id }, ...(folderId ? { folderId } : {}) });
const provider = (docs: TransferThing[]): TransferSource => ({
  read: async (id) => { const doc = docs.find((entry) => entry.id === id); if (!doc) throw new Error('Not authorized'); return doc; },
  children: async () => ({ ids: [] }), dependencies: async () => [],
  files: async function* () { /* no attached media */ }
});

test('exports every folder page and nested folder, not only 50 visible items', async () => {
  const docs = [make('folder', 'folder'), make('nested', 'folder', 'folder'), ...Array.from({ length: 125 }, (_, i) => make(`item-${i}`, 'data', 'folder')), make('inside', 'data', 'nested')];
  const source = provider(docs);
  source.children = async (folder, cursor) => {
    const all = docs.filter((doc) => doc.folderId === folder).map((doc) => doc.id);
    const offset = Number(cursor || 0);
    return { ids: all.slice(offset, offset + 50), cursor: offset + 50 < all.length ? String(offset + 50) : null };
  };
  const result = await collectTransfer(['folder'], source);
  assert.equal(result.manifest.things.length, 128);
  assert.equal(result.manifest.things.find((doc) => doc.id === 'inside')?.folderId, 'nested');
});

test('dependency cycles terminate and preserve IDs without touching arbitrary text', async () => {
  const source = provider([make('a', 'action'), make('b', 'action')]);
  source.dependencies = async (doc) => [doc.id === 'a' ? 'b' : 'a'];
  const result = await collectTransfer(['a'], source);
  assert.deepEqual(result.manifest.things.map((doc) => doc.id), ['a', 'b']);
  assert.equal(result.manifest.things[0].crystal.name, 'a');
});

test('a forbidden dependency or a looping cursor fails the whole export', async () => {
  const source = provider([make('folder', 'folder')]);
  source.dependencies = async () => ['private'];
  await assert.rejects(collectTransfer(['folder'], source), /Not authorized/);
  source.dependencies = async () => [];
  source.children = async () => ({ ids: [], cursor: 'same' });
  await assert.rejects(collectTransfer(['folder'], source), /repeated a cursor/);
});

test('shared file bytes are deduplicated and detached from caller state', async () => {
  const source = provider([make('a'), make('b')]);
  const data = new TextEncoder().encode('file');
  source.files = async function* () { yield { id: 'file', name: 'test.txt', mime: 'text/plain', data }; };
  const bundle = await collectTransfer(['a', 'b'], source);
  assert.equal(bundle.files.size, 1);
  assert.equal(bundle.manifest.files[0].targetId, 'a');
  data.fill(0);
  assert.equal(new TextDecoder().decode(bundle.files.get('file')), 'file');
});

test('export options are honored, external folder placement is detached, source is unchanged', async () => {
  const doc = make('selected', 'folder', 'outside');
  const source = provider([doc]);
  source.children = source.dependencies = async () => { throw new Error('must not read'); };
  source.files = () => { throw new Error('must not read'); };
  const bundle = await collectTransfer(['selected'], source, { includeChildren: false, includeDependencies: false, includeFiles: false });
  assert.equal(bundle.manifest.things[0].folderId, undefined);
  assert.equal(doc.folderId, 'outside');
});
