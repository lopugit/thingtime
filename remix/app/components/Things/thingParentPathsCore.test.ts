import test from 'node:test';
import assert from 'node:assert/strict';
import { indexParentReferences, parentPathPage, scanParentReferenceBatch, type ParentIndex, type ParentPathThing, type ParentPathWork } from './thingParentPathsCore';
const blob: ParentPathThing = { id: 'att_blob000', thingtime: ['attachment'], crystal: { name: 'search.svg' } };
const rows: ParentPathThing[] = [blob,
 { id: 'file-a', thingtime: ['file'], folderId: 'folder-a', crystal: { name: 'search.svg', content: { attachmentId: blob.id } } },
 { id: 'file-b', thingtime: ['file'], folderId: 'folder-b', crystal: { name: 'copied.svg', content: { attachmentId: blob.id } } },
 { id: 'folder-a', thingtime: ['folder'], crystal: { title: 'Assets' } },
 { id: 'folder-b', thingtime: ['folder'], crystal: { title: 'Archive' } },
 { id: 'post', thingtime: ['post'], crystal: { title: 'Collection', thing: { kind: 'thing-collection', items: [{ id: blob.id, mode: 'data' }] } } },
 { id: 'page', thingtime: ['webpage'], crystal: { title: 'Preview', blocks: [{ src: `/api/v1/attachments/content?id=${blob.id}` }] } },
 { id: 'prose', thingtime: ['data'], crystal: { text: blob.id, name: 'search.svg' } }
];
const byId = new Map(rows.map(row => [row.id, row]));
const build = () => { const index: ParentIndex = new Map(); rows.forEach(row => indexParentReferences(index, row)); return index; };
test('one attachment generates every distinct typed parent path with clickable folder ancestry', async () => {
 const result = await parentPathPage(blob.id, build(), async id => byId.get(id) ?? null);
 assert.equal(result.paths.length, 4);
 const paths = result.paths.map(path => path.map(x => x.name).join('/')).sort();
 assert.deepEqual(paths, ['Archive/copied.svg', 'Assets/search.svg', 'Collection', 'Preview']);
 assert.equal(result.paths.flat().find(x => x.id === 'folder-a')!.href, '/things?folder=folder-a');
 assert.equal(result.paths.flat().some(x => x.id === 'prose'), false);
});
test('exact ACL reads redact private parents and never fabricate partial ancestral paths', async () => {
 const result = await parentPathPage(blob.id, build(), async id => ['file-b', 'page'].includes(id) ? null : byId.get(id) ?? null);
 assert.equal(result.paths.length, 2); assert.equal(result.unavailable, 2);
 assert.equal(JSON.stringify(result.paths).includes('Archive'), false);
 assert.equal(JSON.stringify(result.paths).includes('Preview'), false);
});
test('cycles terminate and path paging resumes without duplicate results', async () => {
 const index = build();
 let pending: ParentPathWork | undefined, found: string[] = [], cycles = 0;
 do {
  const result = await parentPathPage(blob.id, index, async id => id === 'folder-a' ? { ...byId.get(id)!, folderId: 'file-a' } : byId.get(id) ?? null, pending, 1, 3);
  found.push(...result.paths.map(path => path.map(x => x.id).join('/'))); pending = result.pending; cycles += result.cycles;
 } while (pending.length);
 assert.equal(cycles, 1); assert.equal(found.length, 3); assert.equal(new Set(found).size, found.length);
});
test('scan batches retain cursor/index, include empty pages and reject a repeated cursor', async () => {
 const index: ParentIndex = new Map(); let calls = 0;
 const list = async (cursor?: string) => { calls++; return cursor === 'second' ? { things: [rows[2]], nextCursor: null } : { things: [rows[1]], nextCursor: 'second' }; };
 const first = await scanParentReferenceBatch(list, index, undefined, 1);
 assert.equal(first.complete, false); assert.equal(first.cursor, 'second'); assert.equal(calls, 1);
 const last = await scanParentReferenceBatch(list, index, first.cursor, 1);
 assert.equal(last.complete, true); assert.equal(index.get(blob.id)!.size, 2);
 await assert.rejects(scanParentReferenceBatch(async () => ({ things: [], nextCursor: 'same' }), new Map()), /repeated/);
 const empty = await scanParentReferenceBatch(async cursor => ({ things: cursor ? [rows[1]] : [], nextCursor: cursor ? null : 'next' }), new Map());
 assert.equal(empty.scanned, 1); assert.equal(empty.complete, true);
});
test('parentId lineage follows explicit stored identities without indexing original upload provenance', async () => {
 const child: ParentPathThing = { id: 'data', thingtime: ['data'], crystal: { parentId: 'parent', fileSyncOrigin: { fileId: blob.id } } };
 const parent: ParentPathThing = { id: 'parent', thingtime: ['data'], folderId: 'folder-a', crystal: { name: 'Task' } };
 const index: ParentIndex = new Map(); indexParentReferences(index, child);
 assert.equal(index.has(blob.id), false);
 const result = await parentPathPage(child.id, index, async id => id === child.id ? child : id === parent.id ? parent : byId.get(id) ?? null);
 assert.deepEqual(result.paths[0].map(x => x.name), ['Assets', 'Task']);
});

test('stale inverse scan rows cannot retain removed content references or old folder locations', async () => {
 const index = build();
 const result = await parentPathPage(blob.id, index, async id => id === 'file-a' ? { ...rows[1], crystal: { name: 'unrelated', content: { attachmentId: 'other' } } } : id === 'file-b' ? { ...rows[2], folderId: null } : byId.get(id) ?? null);
 assert.equal(result.paths.length, 3);
 assert.equal(result.paths.flat().some(x => x.id === 'folder-a' || x.id === 'folder-b'), false);
});

test('a heavily referenced Thing never exceeds the actual ACL-read budget per page', async () => {
 const index: ParentIndex = new Map([[blob.id, new Set(Array.from({ length: 600 }, (_, n) => `file-${n}`))]]);
 let reads = 0;
 const read = async (id: string) => { reads++; return id === blob.id ? blob : { id, thingtime: ['file'], crystal: { content: { attachmentId: blob.id } } }; };
 const first = await parentPathPage(blob.id, index, read, undefined, 1000, 200);
 assert.equal(reads, 200); assert.equal(first.paths.length, 199); assert.equal(first.pending.length, 401);
 reads = 0;
 const next = await parentPathPage(blob.id, index, read, first.pending, 1000, 200);
 assert.equal(reads, 200); assert.equal(next.paths.length, 200);
});

test('a cancelled scan keeps the last successful page checkpoint and its inverse references', async () => {
 const index: ParentIndex = new Map(); let checkpoint: string | undefined, scanned = 0;
 await assert.rejects(scanParentReferenceBatch(async cursor => {
  if (cursor) throw new DOMException('Cancelled', 'AbortError');
  return { things: [rows[1]], nextCursor: 'retained-cursor' };
 }, index, undefined, 10, (count, cursor) => { scanned += count; checkpoint = cursor; }), { name: 'AbortError' });
 assert.equal(scanned, 1); assert.equal(checkpoint, 'retained-cursor'); assert.equal(index.get(blob.id)!.has('file-a'), true);
});
