import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { LocalDrafts } from './drafts';
import { LocalThings } from './things';
import { AccountFileSync } from './accountFiles';
import { AccountDraftSync } from './accountDrafts';
import { isLocalLinkedAttachment, localMediaInfo } from './attachments';
import { WorkspaceDatabase } from './storage';
import type { DraftContent } from '../drafts/draftCore';

const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const content = (ids: string[]): DraftContent => ({ name: 'Mixed draft', surface: 'post', context: 'post:new:', attachmentIds: ids,
 snapshot: JSON.stringify({ attachments: ids.map(id => ({ id })), layoutSpans: Object.fromEntries(ids.map(id => [id, 'wide'])) }) });

test('URL and byte draft media bind, copy, recover and expire independently without fetching linked content', async () => {
 const factory = new IDBFactory(), scope = { kind: 'anonymous' as const };
 let db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange), things = new LocalThings(db, scope, lease), drafts = new LocalDrafts(db, scope, lease);
 const oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error('URL metadata must not fetch external content'); };
 try {
  const linked = await things.saveLinkedFile({ requestId: 'linked-draft-selection-001', url: 'https://example.invalid/picture.png', mediaKind: 'file' });
  const bytes = await things.saveFile({ requestId: 'linked-draft-byte-selection', name: 'note.txt', contentType: 'text/plain', bytes: new Uint8Array([1,2,3]), purpose: 'post' });
  const original = content([linked.id, bytes.id]), save = { operation: 'save', id: 'working', writeId: 'first', revision: 0, content: original };
  const saved = await drafts.request(save); assert.deepEqual(await drafts.request(save), saved);
  await assert.rejects(drafts.request({ ...save, id: 'steal' }), /another Thing or draft/);
  const template = await drafts.createTemplate('template', original), copied = await drafts.request({ operation: 'instantiate', id: 'copy', sourceId: 'template' });
  const copiedLink = copied.draft.attachmentIds[0]; assert.notEqual(copiedLink, linked.id); assert.notEqual(copiedLink, template.attachmentIds[0]);
  assert.deepEqual(JSON.parse(copied.draft.snapshot).layoutSpans, Object.fromEntries(copied.draft.attachmentIds.map((id: string) => [id, 'wide'])));
  const recovered = await drafts.request({ operation: 'recover', id: 'recovered', sourceId: 'copy', content: copied.draft });
  await drafts.request({ operation: 'delete', id: 'working', revision: 1 });
  const released = await things.get(linked.id); assert.ok(isLocalLinkedAttachment(released)); assert.equal(released.localLinkedAttachment.draftId, undefined); assert.ok(released.localLinkedAttachment.expiresAt);
  const future = new LocalThings(db, scope, lease, [], () => new Date(Date.now() + 3 * 86400000).toISOString());
  await future.saveLinkedFile({ requestId: 'linked-expiry-trigger-001', url: 'https://example.invalid/new.png' });
  await assert.rejects(things.get(linked.id), /not in this workspace/);
  await db.close(); db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange); things = new LocalThings(db, scope, lease); drafts = new LocalDrafts(db, scope, lease);
  const loaded = await drafts.request(undefined, { id: 'recovered' });
  assert.equal(loaded.attachments[0].url, linked.crystal.url); assert.equal(loaded.attachments[0].mediaKind, 'file');
  assert.equal(await db.transaction(scope, 'readonly', lease, tx => tx.getBinary(recovered.draft.attachmentIds[0])), undefined);
  assert.deepEqual((await things.readFile(recovered.draft.attachmentIds[1])).bytes, new Uint8Array([1,2,3]));
 } finally { globalThis.fetch = oldFetch; await db.close(); }
});

test('account URL drafts get independent request identities and fail atomically on queue refusal', async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange);
 const scope = { kind: 'account', origin: 'https://draft-links.test', ownerId: 'owner', dataPlane: 'home' } as const;
 const files = new AccountFileSync(db, scope, lease), drafts = new AccountDraftSync(db, scope, lease, files.draftHooks).drafts;
 try {
  const linked = await files.things.saveLinkedFile({ requestId: 'account-linked-draft-selection', url: 'https://example.invalid/video.mp4' });
  await drafts.request({ operation: 'save', id: 'working', writeId: 'first', revision: 0, content: content([linked.id]) });
  const template = await drafts.createTemplate('template', content([linked.id])), copy = await drafts.request({ operation: 'instantiate', id: 'copy', sourceId: 'template' });
  const copyRow = await files.things.get(copy.draft.attachmentIds[0]); assert.ok(isLocalLinkedAttachment(copyRow));
  assert.notEqual(copyRow.localLinkedAttachment.requestId, linked.localLinkedAttachment.requestId); assert.equal(copyRow.localLinkedAttachment.draftId, 'copy');
  assert.equal((await files.status()).length, 3); assert.equal((await drafts.request(undefined, { id: 'copy' })).attachments[0].url, linked.crystal.url);
  const before = await files.things.snapshot(), statuses = await files.status();
  const failed = new LocalDrafts(db, scope, lease, undefined, { ...files.draftHooks, copiedFile: async (tx, row) => { await files.draftHooks.copiedFile(tx, row); throw Error('Synthetic queue admission failure'); } });
  await assert.rejects(failed.createTemplate('never-committed', content([linked.id])), /queue admission/);
  assert.deepEqual(await files.things.snapshot(), before); assert.deepEqual(await files.status(), statuses); await assert.rejects(drafts.request(undefined, { id: 'never-committed' }), /not found/);
  const other = new AccountDraftSync(db, { ...scope, ownerId: 'other' }, lease, new AccountFileSync(db, { ...scope, ownerId: 'other' }, lease).draftHooks);
  await assert.rejects(other.drafts.request({ operation: 'save', id: 'stolen', writeId: 'first', revision: 0, content: content([linked.id]) }), /not in this workspace/);
 } finally { await db.close(); }
});

test('linked metadata changes between preparation and commit cannot partly copy a draft', async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), scope = { kind: 'anonymous' as const }, things = new LocalThings(db, scope, lease);
 try {
  const link = await things.saveLinkedFile({ requestId: 'linked-race-selection-001', url: 'https://example.invalid/source.png' });
  const drafts = new LocalDrafts(db, scope, lease, undefined, { readLinked: async id => {
   const snapshot = await things.get(id); assert.ok(isLocalLinkedAttachment(snapshot));
   await db.transaction(scope, 'readwrite', lease, async tx => { const changed = structuredClone(snapshot); changed.crystal.url = 'https://example.invalid/changed.png'; await tx.put('things', id, changed); });
   return snapshot;
  } });
  await assert.rejects(drafts.createTemplate('stale', content([link.id])), /attachment changed/);
  assert.deepEqual((await drafts.request()).drafts, []); assert.equal((await things.snapshot()).length, 1);
  assert.equal(localMediaInfo(await things.get(link.id) as typeof link).draftId, undefined);
 } finally { await db.close(); }
});
