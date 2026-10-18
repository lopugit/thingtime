import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountDraftSync, type AccountDraftTransport } from './accountDrafts';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { WorkspaceDatabase } from './storage';
import { forgetAccountConversation } from './accountReadRevocation';
import type { AccountDraft, DraftContent } from '../drafts/draftCore';

const scope = { kind: 'account', ownerId: 'owner', origin: 'https://draft.test', dataPlane: 'home' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const content = (id: string): DraftContent => ({ name: 'Private image draft', surface: 'post', context: 'post:new:', attachmentIds: [id], snapshot: JSON.stringify({ text: 'Editable draft', attachments: [{ id, name: 'draft.txt', contentType: 'text/plain' }], layoutSpans: { [id]: { columns: 1, rows: 1 } } }) });
const setup = () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), files = new AccountFileSync(db, scope, lease);
 const drafts = new AccountDraftSync(db, scope, lease, files.draftHooks), bytes = new TextEncoder().encode('Private draft original');
 const calls: string[] = [], requests: string[] = [];
 let last = '';
 const fileTransport: AccountFileTransport = {
  start: async input => { calls.push('upload'); requests.push(input.requestId); last = 'account-' + input.requestId; return { id: last, partSizeBytes: bytes.length, partCount: 1 }; },
  parts: async (_id, parts) => parts.map(part => ({ ...part, url: 'https://storage.test/part', headers: {}, expiresAt: '2026-10-18' })), put: async (_part, actual) => { assert.deepEqual(actual instanceof Blob ? new Uint8Array(await actual.arrayBuffer()) : actual, bytes); },
  complete: async id => ({ id, name: 'draft.txt', contentType: 'text/plain', mediaKind: 'file', size: bytes.length })
 };
 const writes: any[] = [];
 const transport: AccountDraftTransport = {
  read: async () => { throw { status: 404 }; },
  write: async command => { calls.push('draft'); writes.push(structuredClone(command)); return { ok: true, ...(command.operation === 'save' ? { draft: { ...command.content, id: command.id, mode: command.mode, revision: command.revision + 1, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' } } : {}) }; }
 };
 return { db, files, drafts, bytes, calls, requests, writes, fileTransport, transport };
};

test('private draft originals above 64 MiB retain as exact native Blobs without upload intent', async context => {
 const f = setup(), block = new Uint8Array(1024 * 1024).fill(53), hash = createHash('sha256');
 const blob = new Blob(Array.from({length: 33}, () => {hash.update(block); return block;})), expected = hash.digest('hex');
 const original = Blob.prototype.arrayBuffer;
 context.mock.method(Blob.prototype, 'arrayBuffer', function(this: Blob) {assert.ok(this.size <= 1024 * 1024); return original.call(this);});
 const remote: AccountDraft = {...content('one'), attachmentIds: ['one','two'], id: 'large-draft', mode: 'draft', revision: 7, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z'};
 const transport = {retention: async (id: string) => ({size: blob.size, cacheKey: 'a'.repeat(64) + ':original', file: {
  purpose: 'post', targetId: remote.id, ownerId: scope.ownerId, updatedAt: remote.updatedAt, folderId: null,
  attachment: {id, name: id + '.bin', contentType: 'application/octet-stream', size: blob.size, mediaKind: 'file'}
 }}), bytes: async () => blob};
 try {
  await f.files.retainDraft(transport, remote, (content, admit) => f.drafts.remember(remote, Date.now(), content, admit));
  await f.db.close();
  const local = await f.drafts.drafts.request(undefined, {id: remote.id});
  assert.equal(local.draft.attachmentIds.length, 2);
  for (const id of local.draft.attachmentIds) {
   const file = await f.files.readFileBlob(id);
   assert.ok(file.snapshot.value instanceof Blob); assert.equal(file.blob.size, blob.size);
   assert.equal(file.row.localAttachment.sha256, expected); assert.equal(file.row.localAttachment.requestId, undefined);
  }
  assert.deepEqual((await f.files.library(true)).things, []);
  assert.equal((await f.files.sync(f.fileTransport)).completed, 0);
 } finally {await f.db.close();}
});

test('private draft media commits locally, then synchronizes only confirmed originals without changing editor references', async () => {
 const f = setup(); try {
  const file = await f.files.things.saveFile({ requestId: crypto.randomUUID(), name: 'draft.txt', contentType: 'text/plain', purpose: 'post', bytes: f.bytes });
  assert.equal((await f.files.sync(f.fileTransport)).completed, 0, 'Unsubmitted selections alone never upload');
  const saved = await f.drafts.drafts.request({ operation: 'save', id: 'draft', writeId: 'write', revision: 0, content: content(file.id) });
  assert.equal(saved.draft.revision, 1); assert.deepEqual(f.calls, []);
  assert.equal((await f.drafts.sync(f.transport)).completed, 0, 'Local completion is independent of pending file receipts');
  assert.equal((await f.files.sync(f.fileTransport)).completed, 1);
  assert.equal((await f.drafts.sync(f.transport)).completed, 1);
  assert.deepEqual(f.calls, ['upload','draft']);
  assert.deepEqual(f.writes[0].content.attachmentIds, [await f.files.remoteId(file.id)]);
  assert.deepEqual(JSON.parse(f.writes[0].content.snapshot).attachments.map((row: any) => row.id), f.writes[0].content.attachmentIds);
  const local = await f.drafts.drafts.request(undefined, { id: 'draft' });
  assert.deepEqual(local.draft.attachmentIds, [file.id]); assert.deepEqual((await f.files.readFile(file.id)).bytes, f.bytes);
  assert.equal((await f.files.library()).things.length, 0);
 } finally { await f.db.close(); }
});

test('account template and working copies own independent bytes and upload intents; deleting a working copy keeps its template', async () => {
 const f = setup(); try {
  const file = await f.files.things.saveFile({ requestId: crypto.randomUUID(), name: 'draft.txt', contentType: 'text/plain', purpose: 'post', bytes: f.bytes });
  const template = await f.drafts.drafts.createTemplate('template', content(file.id), { kind: 'post', id: 'source-post' });
  const first = await f.drafts.drafts.request({ operation: 'instantiate', sourceId: 'template', id: 'first' });
  const second = await f.drafts.drafts.request({ operation: 'instantiate', sourceId: 'template', id: 'second' });
  const ids = [file.id, ...template.attachmentIds, ...first.draft.attachmentIds, ...second.draft.attachmentIds];
  assert.equal(new Set(ids).size, 4);
  for (const id of ids) assert.deepEqual((await f.files.readFile(id)).bytes, f.bytes);
  await f.drafts.drafts.request({ operation: 'delete', id: 'first', revision: first.draft.revision });
  assert.equal((await f.files.sync(f.fileTransport)).completed, 2, 'Only the active template and second draft upload');
  await f.drafts.sync(f.transport);
  assert.deepEqual(new Set(f.writes.map(row => row.id)), new Set(['template','second']));
  assert.equal(new Set(f.requests).size, 2);
  assert.equal((await f.drafts.drafts.request(undefined, { id: 'template' })).draft.mode, 'template');
 } finally { await f.db.close(); }
});

test('remote private draft files retain atomically and remain excluded from the ordinary library', async () => {
 const f = setup(); try {
  const remote: AccountDraft = { ...content('remote-file'), id: 'existing', mode: 'draft', revision: 7, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' };
  const transport = { retention: async () => ({ ok: true, size: f.bytes.length, cacheKey: 'a'.repeat(64) + ':original', file: {
   purpose: 'post', targetId: remote.id, ownerId: scope.ownerId, updatedAt: remote.updatedAt, folderId: null,
   attachment: { id: 'remote-file', name: 'draft.txt', contentType: 'text/plain', size: f.bytes.length, mediaKind: 'file' }
  } }), bytes: async () => f.bytes };
  await f.files.retainDraft(transport, remote, (content, admit) => f.drafts.remember(remote, Date.now(), content, admit));
  const local = await f.drafts.drafts.request(undefined, { id: remote.id }), id = local.draft.attachmentIds[0];
  assert.notEqual(id, 'remote-file'); assert.equal(local.draft.revision, 1);
  assert.deepEqual((await f.files.readFile(id)).bytes, f.bytes);
  assert.deepEqual((await f.files.library()).things, []); assert.deepEqual((await f.files.library(true)).things, []);
  assert.equal((await f.files.sync(f.fileTransport)).completed, 0, 'Retained originals never reupload');
  await f.drafts.drafts.request({ operation: 'save', id: remote.id, revision: 1, writeId: 'edit', content: { ...local.draft, name: 'Local edit' } });
  await f.drafts.sync(f.transport); assert.equal(f.writes[0].revision, 7); assert.deepEqual(f.writes[0].content.attachmentIds, ['remote-file']);
 } finally { await f.db.close(); }
});


test('draft media refuses late copying and sync after canonical access refusal, including released files', async () => {
 const f = setup(); try {
  const remote: AccountDraft = { ...content('remote-file'), id: 'private-draft', mode: 'template', revision: 1, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' };
  const transport = { retention: async () => ({ ok: true, size: f.bytes.length, cacheKey: 'b'.repeat(64) + ':original', file: {
   purpose: 'post', targetId: remote.id, ownerId: scope.ownerId, updatedAt: remote.updatedAt, folderId: null,
   attachment: { id: 'remote-file', name: 'draft.txt', contentType: 'text/plain', size: f.bytes.length, mediaKind: 'file' }
  } }), bytes: async () => f.bytes };
  await f.files.retainDraft(transport, remote, (content, admit) => f.drafts.remember(remote, Date.now(), content, admit));
  const local = await f.drafts.drafts.request(undefined, { id: remote.id }), id = local.draft.attachmentIds[0];
  const read = f.files.readFileBlob.bind(f.files);
  f.files.readFileBlob = async (...args) => {
   const result = await read(...args);
   await f.db.transaction(scope, 'readwrite', lease, tx => forgetAccountConversation(tx, remote.id, Date.now() + 1));
   return result;
  };
  const before = await f.db.transaction(scope, 'readonly', lease, tx => tx.usage());
  await assert.rejects(f.drafts.drafts.request({ operation: 'instantiate', sourceId: remote.id, id: 'late-copy' }), /access to this retained file/);
  await assert.rejects(f.drafts.drafts.request(undefined, { id: 'late-copy' }), /Draft not found/);
  f.files.readFileBlob = read;
  await f.db.transaction(scope, 'readonly', lease, tx => assert.rejects(f.files.draftHooks.prepare(tx, local.draft), /access to this retained file/));
  // Releasing the local binding must not erase the original access boundary.
  await f.drafts.drafts.request({ operation: 'delete', id: remote.id, revision: local.draft.revision });
  await assert.rejects(f.files.readFile(id), /access to this retained file/);
  const recovery = await f.db.transaction(scope, 'readonly', lease, async tx => {
   assert.equal((await tx.list('things')).length, 1, 'No independent copy escaped the refusal');
   assert.ok((await tx.usage()).bytes < before.bytes + 4096);
   return (await tx.getBinary(id))?.value;
  });
  assert.ok(recovery instanceof Blob);
  assert.deepEqual(new Uint8Array(await recovery.arrayBuffer()), f.bytes, 'Recovery bytes remain intact');
 } finally { await f.db.close(); }
});
