import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';
import { TIMELINE_NOTE_KIND, TIMELINE_NOTE_MAX_BYTES } from '../../../timeline/notes.ts';
import { timelineNoteBytes } from './envelope.ts';
import { thingStorageSizeBytes, currentContentStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION } from '../storage/storageCore.ts';
import { toBin } from '../auth/binary.ts';

const note = { formatVersion: 1, id: 'note-177abf25-b322-4ac0-9707-a59c36e7bcd5', ownerId: 'user-1', eventId: 'event-1', thingId: 'thing-1', author: 'owner', text: 'Why this changed', createdAt: '2026-10-13T07:00:00.000Z' };
const doc = (overrides: Record<string, unknown> = {}) => ({
	schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: [TIMELINE_NOTE_KIND], ownerId: 'user-1', acl: ['tt:user'],
	crystal: { name: 'Note' }, extended: null, tags: [], timelineNoteVersion: 1, secure: toBin(JSON.stringify(note)), ...overrides
});

test('a note meters its secure record, not only its value-free crystal', () => {
	const bytes = Buffer.byteLength(JSON.stringify(note));
	assert.equal(timelineNoteBytes(doc()), bytes);
	const ordinary: Record<string, unknown> = { thingtime: ['data'], crystal: { title: 'Ordinary' } };
	assert.equal(timelineNoteBytes(ordinary), 0);
	const crystalOnly = Buffer.byteLength(JSON.stringify({ crystal: { name: 'Note' }, extended: null, tags: [] }));
	assert.equal(thingStorageSizeBytes(doc()), crystalOnly + bytes);
	const stamped = { ...doc(), storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, sizeBytes: crystalOnly + bytes };
	assert.equal(currentContentStorageSizeBytes(stamped), crystalOnly + bytes);
	assert.equal(currentContentStorageSizeBytes({ ...stamped, sizeBytes: crystalOnly }), null);
});

test('a malformed note envelope fails closed instead of metering as free', () => {
	assert.equal(timelineNoteBytes(doc({ timelineNoteVersion: 2 })), null);
	assert.equal(timelineNoteBytes(doc({ secure: null })), null);
	assert.equal(timelineNoteBytes(doc({ secure: toBin('x'.repeat(TIMELINE_NOTE_MAX_BYTES + 1)) })), null);
	assert.throws(() => thingStorageSizeBytes(doc({ secure: null })), /Timeline storage envelope is invalid/);
	assert.equal(currentContentStorageSizeBytes({ ...doc({ secure: null }), storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, sizeBytes: 10 }), null);
});
