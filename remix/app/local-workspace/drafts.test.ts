import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalDrafts } from './drafts';
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
