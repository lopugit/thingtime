import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalDrafts } from './drafts';
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
const content = { name: 'Local draft', surface: 'thing' as const, context: 'editor', snapshot: '{"text":"original"}', attachmentIds: [] };
test('local drafts preserve retry identity, conflict checks and discard tombstones', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	const drafts = new LocalDrafts(db, { kind: 'anonymous' }, { assertCurrent() {}, onInvalidate: () => () => {} });
	const save = { operation: 'save', id: 'draft', writeId: 'write', revision: 0, content };
	const created = await drafts.request(save); assert.equal(created.draft.revision, 1);
	assert.deepEqual(await drafts.request(save), created);
	await assert.rejects(drafts.request({ ...save, writeId: 'second' }), /changed elsewhere/);
	await drafts.request({ operation: 'delete', id: 'draft', revision: 1 });
	await assert.rejects(drafts.request(save), /already discarded/);
	assert.deepEqual((await drafts.request()).drafts, []); await db.close();
});
test('template copies and conflict recovery stay independent and are idempotent', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	const drafts = new LocalDrafts(db, { kind: 'anonymous' }, { assertCurrent() {}, onInvalidate: () => () => {} });
	await drafts.createTemplate('template', content);
	const request = { operation: 'instantiate', sourceId: 'template', id: 'working' };
	const working = await drafts.request(request); assert.equal(working.draft.mode, 'draft');
	assert.deepEqual(await drafts.request(request), working);
	await drafts.request({ operation: 'save', id: 'working', writeId: 'edit', revision: 1, content: { ...content, snapshot: '{"text":"edited"}' } });
	assert.equal((await drafts.request(undefined, { id: 'template' })).draft.snapshot, content.snapshot);
	await drafts.request({ operation: 'delete', id: 'working', revision: 2 });
	const recovered = await drafts.request({ operation: 'recover', id: 'recovered', sourceId: 'working', content });
	assert.equal(recovered.draft.snapshot, content.snapshot);
	await assert.rejects(drafts.request({ operation: 'save', id: 'template', writeId: 'mutate-template', revision: 1, content }), /Templates are reusable/);
	await db.close();
});
test('draft attachments cannot borrow IDs from another workspace', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	const drafts = new LocalDrafts(db, { kind: 'anonymous' }, { assertCurrent() {}, onInvalidate: () => () => {} });
	await assert.rejects(drafts.request({ operation: 'save', id: 'draft', writeId: 'write', revision: 0, content: { ...content, attachmentIds: ['remote-attachment'] } }), /not in this workspace/);
	assert.deepEqual((await drafts.request()).drafts, []); await db.close();
});


test('draft media bind atomically; templates and recovery own independent bytes and remapped layouts', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), scope = { kind: 'anonymous' as const }, lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const things = new LocalThings(db, scope, lease), drafts = new LocalDrafts(db, scope, lease);
 const bytes = new Uint8Array([1,2,3]);
 try {
  const file = await things.saveFile({ requestId: 'draft-media-selection-001', name: 'card.png', contentType: 'image/png', bytes, purpose: 'post' });
  assert.equal((await things.list()).things.length, 0);
  const mediaContent = { ...content, surface: 'post' as const, attachmentIds: [file.id], snapshot: JSON.stringify({ attachments: [{ id: file.id, name: 'card.png' }], layoutSpans: { [file.id]: 'wide' } }) };
  const saved = await drafts.request({ operation: 'save', id: 'working', writeId: 'first', revision: 0, content: mediaContent });
  assert.equal((await drafts.request(undefined, { id: 'working' })).attachments[0].id, file.id);
  await assert.rejects(drafts.request({ operation: 'save', id: 'steal', writeId: 'first', revision: 0, content: mediaContent }), /another Thing or draft/);
  const template = await drafts.createTemplate('template', mediaContent);
  assert.notEqual(template.attachmentIds[0], file.id);
  const instantiated = await drafts.request({ operation: 'instantiate', id: 'copy', sourceId: 'template' });
  const copyId = instantiated.draft.attachmentIds[0];
  assert.notEqual(copyId, template.attachmentIds[0]);
  assert.deepEqual(JSON.parse(instantiated.draft.snapshot).layoutSpans, { [copyId]: 'wide' });
  assert.deepEqual(await drafts.request({ operation: 'instantiate', id: 'copy', sourceId: 'template' }), instantiated);
  await drafts.request({ operation: 'delete', id: 'working', revision: saved.draft.revision });
  await things.remove([file.id]);
  assert.deepEqual((await things.readFile(copyId)).bytes, bytes);
  assert.deepEqual((await things.readFile(template.attachmentIds[0])).bytes, bytes);
  const recovery = await drafts.request({ operation: 'recover', id: 'recovered', sourceId: 'copy', content: instantiated.draft });
  assert.notEqual(recovery.draft.attachmentIds[0], copyId);
  await drafts.request({ operation: 'delete', id: 'copy', revision: 1 });
  await assert.rejects(drafts.request({ operation: 'instantiate', id: 'copy', sourceId: 'template' }), /discarded or published/);
  assert.deepEqual((await things.readFile(recovery.draft.attachmentIds[0])).bytes, bytes);
 } finally { await db.close(); }
});
test('corrupt media and identity retirement cannot commit a draft or a partial template copy', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), scope = { kind: 'anonymous' as const }; let active = true;
 const lease = { assertCurrent() { if (!active) throw new Error('retired'); }, onInvalidate: () => () => {} };
 const things = new LocalThings(db, scope, lease), drafts = new LocalDrafts(db, scope, lease);
 try {
  const file = await things.saveFile({ requestId: 'draft-corruption-selection', name: 'file.txt', contentType: 'text/plain', bytes: new Uint8Array([1]), purpose: 'post' });
  const c = { ...content, attachmentIds: [file.id] };
  await db.transaction(scope, 'readwrite', lease, tx => tx.putBytes(file.id, new Uint8Array([2])));
  await assert.rejects(drafts.createTemplate('template', c), /bytes are unavailable/);
  assert.deepEqual((await drafts.request()).drafts, []);
  assert.equal((await things.snapshot()).length, 1);
  active = false; await assert.rejects(drafts.request({ operation: 'save', id: 'draft', writeId: 'write', revision: 0, content }), /retired/);
 } finally { await db.close(); }
});
test('draft expiry reaps only released selections and never bound working files', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), scope = { kind: 'anonymous' as const }, lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const things = new LocalThings(db, scope, lease), drafts = new LocalDrafts(db, scope, lease);
 try {
  const file = await things.saveFile({ requestId: 'draft-expiry-selection-001', name: 'file.txt', contentType: 'text/plain', bytes: new Uint8Array([1]), purpose: 'post' });
  await drafts.request({ operation: 'save', id: 'kept', writeId: 'write', revision: 0, content: { ...content, attachmentIds: [file.id] } });
  const future = new LocalThings(db, scope, lease, [], () => new Date(Date.now() + 3 * 86400000).toISOString());
  await future.saveFile({ requestId: 'draft-expiry-trigger-0001', name: 'other.txt', contentType: 'text/plain', bytes: new Uint8Array([2]) });
  assert.deepEqual((await future.readFile(file.id)).bytes, new Uint8Array([1]));
  await drafts.request({ operation: 'delete', id: 'kept', revision: 1 });
  await future.saveFile({ requestId: 'draft-expiry-trigger-0002', name: 'other.txt', contentType: 'text/plain', bytes: new Uint8Array([3]) });
  await assert.rejects(things.readFile(file.id), /not stored/);
 } finally { await db.close(); }
});


test('template selection copies into the destination context without replaying pending submissions', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), scope = { kind: 'anonymous' as const }, lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const drafts = new LocalDrafts(db, scope, lease), things = new LocalThings(db, scope, lease);
 try {
  const file = await things.saveFile({ requestId: 'template-context-file', name: 'note.txt', contentType: 'text/plain', bytes: new Uint8Array([1, 2]), purpose: 'post' });
  const source = await drafts.createTemplate('template', { ...content, surface: 'post', context: 'post:new:', attachmentIds: [file.id], snapshot: JSON.stringify({ attachments: [{ id: file.id }], postEditorValue: { kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: '<b>Rich template</b>' } }] } }) });
  const request = { operation: 'instantiate', sourceId: 'template', id: 'working', context: 'post:new:workspace:current' };
  const copied = await drafts.request(request);
  assert.equal(copied.draft.context, request.context);
  assert.equal(JSON.parse(copied.draft.snapshot).postEditorValue.blocks[0].data.text, '<b>Rich template</b>');
  assert.notEqual(copied.draft.attachmentIds[0], source.attachmentIds[0]);
  assert.deepEqual((await things.readFile(copied.draft.attachmentIds[0])).bytes, new Uint8Array([1, 2]));
  assert.deepEqual(await drafts.request(request), copied);
  await assert.rejects(drafts.request({ ...request, context: 'other' }), /another editor context/);
  assert.deepEqual((await drafts.request(undefined, { id: 'template' })).draft, source);
  const race = await Promise.allSettled(['first', 'second'].map(context => drafts.request({ ...request, id: 'racing-copy', context })));
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter(result => result.status === 'rejected').length, 1);
  await assert.rejects(drafts.request({ ...request, id: 'invalid', context: 'x'.repeat(301) }), /Invalid draft/);
  await drafts.createTemplate('pending', { ...content, snapshot: JSON.stringify({ pendingSubmission: { shareId: 'old-operation', payload: { text: 'Not a template' } } }) });
  await assert.rejects(drafts.request({ ...request, id: 'never-created', sourceId: 'pending' }), /unfinished submission/);
  await assert.rejects(drafts.request(undefined, { id: 'never-created' }), /not found/);
 } finally { await db.close(); }
});
