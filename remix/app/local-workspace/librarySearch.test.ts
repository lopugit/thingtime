import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings, type LocalThing } from './things';
import { searchLocalLibrary } from './librarySearch';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };

test('library search finds nested authored content across folders and pages exact literal matches', async () => {
 const db = new WorkspaceDatabase(new IDBFactory());
 const things = new LocalThings(db, { kind: 'anonymous' }, lease);
 try {
  const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Examples' } });
  for (let n = 0; n < 61; n++) await things.create({ thingtime: ['data'], folderId: folder.id, crystal: { name: `Card ${n}`, nested: { body: 'Golden [card] 🌈' } } });
  const rows = await things.snapshot();
  const one = searchLocalLibrary(rows, { q: 'GOLDEN [card]', limit: 50 });
  const two = searchLocalLibrary(rows, { q: 'golden [card]', cursor: one.nextCursor!, limit: 50 });
  assert.equal(one.total, 61); assert.equal(one.things.length, 50); assert.equal(two.things.length, 11);
  assert.equal(new Set([...one.things, ...two.things].map(row => row.id)).size, 61); assert.equal(two.nextCursor, null);
  assert.equal(searchLocalLibrary(rows, { q: 'nested' }).total, 0, 'field names are not authored values');
  assert.equal(searchLocalLibrary(rows, { q: 'golden.*' }).total, 0, 'query is never a regular expression');
  assert.equal(searchLocalLibrary(rows, { q: 'golden', thingtime: 'component' }).total, 0);
  assert.equal(searchLocalLibrary(rows, { q: 'examples', thingtime: 'data,folder' }).things[0].id, folder.id);
  assert.throws(() => searchLocalLibrary(rows, { q: 'changed', cursor: one.nextCursor }), /cursor|filters/i);
  assert.throws(() => searchLocalLibrary(rows, { q: 'x'.repeat(201) }), /200/);
  assert.throws(() => searchLocalLibrary(rows, { q: {} }), /string/);
  assert.throws(() => searchLocalLibrary(rows, { cursor: 'server-cursor' }), /Reload/);
  const anchor = one.things.at(-1)!;
  await things.remove([anchor.id]);
  assert.throws(() => searchLocalLibrary((rows.filter(row => row.id !== anchor.id)), { q: 'golden [card]', cursor: one.nextCursor }), /changed/);
  await things.update({ id: one.things[0].id, crystal: { name: 'Freshly renamed' } });
  assert.equal(searchLocalLibrary(await things.snapshot(), { q: 'freshly renamed' }).total, 1);
 } finally { await db.close(); }
});

test('library search excludes relational activity and draft/attached files while keeping standalone content', () => {
 const base: LocalThing = { id: 'local-example', thingtime: ['data'], crystal: { name: 'Needle' }, createdAt: '2026-10-16', updatedAt: '2026-10-16', revision: 1 };
 const attachment = (id: string, draft = false, target = false) => ({ ...base, id, thingtime: ['attachment'], ...(target ? { targetId: base.id } : {}), localAttachment: { purpose: 'file', ...(draft ? { draftId: 'draft', expiresAt: 'later' } : {}) } }) as LocalThing;
 const rows = [base, ...['save','reaction','vote','updown','action-run'].map(kind => ({ ...base, id: `local-${kind}`, thingtime: [kind] })), attachment('local-file'), attachment('local-draft', true), attachment('local-attached', false, true)];
 assert.deepEqual(searchLocalLibrary(rows, { q: 'needle' }).things.map(row => row.id).sort(), ['local-example','local-file']);
});
