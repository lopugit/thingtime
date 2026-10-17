import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { LocalDrafts } from './drafts';
import { localPostInput, localPostProjection } from './posts';
const scope = { kind: 'anonymous' as const }, lease = { assertCurrent() {}, onInvalidate: () => () => {} };

test('post commits independently of draft saving and retains files after draft retirement', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease), drafts = new LocalDrafts(db, scope, lease);
 try {
  const file = await things.saveFile({ requestId: 'post-media-selection-001', name: 'card.png', contentType: 'image/png', bytes: new Uint8Array([1,2,3]), purpose: 'post' });
  const input = localPostInput({ type: 'image', text: 'My local card', attachmentIds: [file.id], shareId: 'local-post-example' });
  const saved = await things.savePost(input); // no saved account/local draft prerequisite
  assert.equal(saved.id, 'local-post-example'); assert.deepEqual(await things.savePost(input), saved);
  const projected = localPostProjection(saved, await things.snapshot(), 'local-workspace');
  assert.equal(projected.attachments[0].id, file.id); assert.equal(projected.visibility, 'private');
  await assert.rejects(things.savePost({ ...input, crystal: { type: 'text', text: 'Changed retry' } }), /already used/);
  const second = await things.saveFile({ requestId: 'post-media-selection-002', name: 'notes.txt', contentType: 'text/plain', bytes: new Uint8Array([4,5]), purpose: 'post' });
  const content = { surface: 'post', context: 'post:new:', name: 'Draft', snapshot: JSON.stringify({ attachments: [{ id: second.id }] }), attachmentIds: [second.id] };
  await drafts.request({ operation: 'save', id: 'working', writeId: 'one', revision: 0, content });
  const post = await things.savePost(localPostInput({ type: 'text', text: 'Posted from a local draft', attachmentIds: [second.id], shareId: 'local-post-draft' }));
  await drafts.request({ operation: 'delete', id: 'working', revision: 1 });
  assert.deepEqual((await things.readFile(second.id)).bytes, new Uint8Array([4,5]));
  assert.equal((await things.get(second.id)).targetId, post.id);
  const template = await drafts.request({ operation: 'from-post', id: 'template', postId: post.id });
  assert.notEqual(template.draft.attachmentIds[0], second.id);
  const working = await drafts.request({ operation: 'instantiate', id: 'copy', sourceId: 'template' });
  await things.remove([post.id]);
  assert.deepEqual((await things.readFile(working.draft.attachmentIds[0])).bytes, new Uint8Array([4,5]));
  await assert.rejects(things.savePost(localPostInput({ type: 'text', text: 'Borrow template file', attachmentIds: template.draft.attachmentIds })), /working drafts/);
  const exported = await things.export([saved.id]);
  assert.equal(exported.manifest.files.length, 1); assert.equal(JSON.stringify(exported.manifest).includes('localSubmission'), false);
  const imported = await things.import(exported.manifest, null, exported.files);
  assert.notEqual(imported.roots[0], saved.id);
  await things.remove([saved.id]);
  const roundTrip = await things.export(imported.roots);
  assert.deepEqual([...roundTrip.files.values()][0], new Uint8Array([1,2,3]));
  assert.equal(roundTrip.manifest.things[0].crystal.text, 'My local card');
 } finally { await db.close(); }
});

test('post binding failure rolls back all files and cannot select account or subspace authority', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease);
 try {
  const first = await things.saveFile({ requestId: 'post-binding-selection-1', name: 'a.txt', contentType: 'text/plain', bytes: new Uint8Array([1]), purpose: 'post' });
  const wrong = await things.saveFile({ requestId: 'post-binding-selection-2', name: 'b.txt', contentType: 'text/plain', bytes: new Uint8Array([2]), purpose: 'comment' });
  await assert.rejects(things.savePost(localPostInput({ type: 'text', text: 'No partial save', attachmentIds: [first.id, wrong.id] })), /another Thing/);
  assert.equal((await things.get(first.id)).targetId, undefined);
  assert.equal((await things.list()).things.length, 0);
  await assert.rejects(things.savePost(localPostInput({ type: 'text', text: 'Remote destination', subspaceId: 'server-subspace' })), /subspace/);
  const account = new LocalThings(db, { kind: 'account', origin: 'https://example.test', ownerId: 'owner', dataPlane: 'home' }, lease);
  await assert.rejects(account.savePost(localPostInput({ type: 'text', text: 'No local bypass' })), /sync adapter/);
 } finally { await db.close(); }
});


test('local post reads restore relational comments and edits preserve omitted canonical fields', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease);
 try {
  const post = await things.savePost(localPostInput({ type: 'text', text: 'Parent', tags: ['kept'] }));
  const file = await things.saveFile({ requestId: 'comment-roundtrip-file', name: 'comment.png', contentType: 'image/png', bytes: new Uint8Array([7,8]), purpose: 'comment' });
  const comment = await things.savePost({ ...localPostInput({ type: 'image', text: 'Child', attachmentIds: [file.id] }), thingtime: ['post', 'comment'], targetId: post.id });
  const reply = await things.savePost({ ...localPostInput({ type: 'text', text: 'Reply' }), thingtime: ['post', 'comment'], targetId: comment.id });
  const all = await things.snapshot(), projected = localPostProjection(post, all, 'local-workspace', true);
  assert.equal(projected.commentCount, 1); assert.equal(projected.comments[0].id, comment.id);
  assert.equal(projected.comments[0].commentCount, 1); assert.equal(projected.comments[0].repliesLoaded, false);
  assert.equal(localPostProjection(comment, all, 'local-workspace', true).comments[0].id, reply.id);
  const edited = await things.savePost({ id: post.id, crystal: { text: 'Edited' } }, true);
  assert.deepEqual(edited.tags, ['kept']); assert.equal(edited.crystal.type, 'text');
  const bundle = await things.export([post.id, comment.id]);
  const imported = await things.import(bundle.manifest, null, bundle.files);
  const importedFile = (await things.snapshot()).find(row => row.targetId === imported.idMap[comment.id] && row.thingtime.includes('attachment'))!;
  assert.equal((await things.readFile(importedFile.id)).row.localAttachment.purpose, 'comment');
  await things.savePost({ id: imported.idMap[comment.id], crystal: { text: 'Edited imported image comment' } }, true);
  await assert.rejects(things.import({ ...bundle.manifest, things: bundle.manifest.things.map(row => row.id === post.id ? { ...row, crystal: { ...row.crystal, subspaceId: 'remote-subspace' } } : row) }, null, bundle.files), /remote subspace/);
  await things.remove([post.id, imported.idMap[post.id]]); assert.equal((await things.snapshot()).length, 0);
 } finally { await db.close(); }
});
