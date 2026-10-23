import assert from 'node:assert/strict';
import test from 'node:test';
import { parseThemeWrite, parseThemeWriteAcknowledgment } from './themeSyncContract';
import { normalizeSavedTheme } from '../../../theme/savedTheme';
const version = 'theme-state-v1:' + 'a'.repeat(64);
const save = {
	action: 'save',
	id: '123e4567-e89b-42d3-a456-426614174000',
	writeId: 'fixture-write',
	expectedVersion: null,
	name: ' Peach ',
	theme: { colors: { accent: '#bb8877' } },
	visibility: 'private'
};
test('theme synchronization shares canonical token normalization and stable request identities', () => {
	const parsed = parseThemeWrite(save),
		normalized = normalizeSavedTheme(save);
	assert.ok(normalized.ok);
	assert.deepEqual(parsed, { ...save, name: normalized.name, theme: normalized.theme });
	assert.deepEqual(parseThemeWrite(parsed), parsed);
	for (const title of [null,'Library label']) assert.equal((parseThemeWrite({...save,title}) as any).title,title);
	assert.equal('title' in parsed,false);
	for (const folderId of [null, 'owned-folder']) assert.equal((parseThemeWrite({ ...save, folderId }) as any).folderId, folderId);
	assert.deepEqual(parseThemeWrite({ action: 'delete', id: save.id, writeId: save.writeId, expectedVersion: version }), {
		action: 'delete',
		id: save.id,
		writeId: save.writeId,
		expectedVersion: version
	});
});
test('theme synchronization refuses ambiguous operations, authority fields and oversized or executable values', () => {
	for (const value of [
		null,
		[],
		{},
		{ ...save, ownerId: 'forged' },
		...[42,{},[],undefined,'x'.repeat(121)].map(title=>({...save,title})),
		...[{}, 4, '', '../folder', save.id, 'timeline-forged'].map((folderId) => ({ ...save, folderId })),
		{ ...save, acl: ['tt:all'] },
		{ ...save, writeId: '' },
		{ ...save, id: '../../escape' },
		{ ...save, id: 'subscription-reserved' },
		{ ...save, id: 'quota-reserved' },
		{ ...save, expectedVersion: undefined },
		{ ...save, expectedVersion: 'timestamp' },
		{ ...save, visibility: 'hidden' },
		{ ...save, theme: () => ({}) },
		{ ...save, theme: { unknown: 'x'.repeat(65536) } },
		{ ...save, name: '' },
		{ action: 'delete', id: save.id, writeId: save.writeId, expectedVersion: null },
		{ action: 'delete', id: save.id, writeId: save.writeId, expectedVersion: version, name: 'ignored' }
	])
		assert.throws(() => parseThemeWrite(value));
});
test('theme acknowledgments distinguish create/update from deletion and reject extra server envelope fields', () => {
	const result = { id: save.id, writeId: save.writeId, action: 'save', expectedVersion: null, resultVersion: version };
	assert.deepEqual(parseThemeWriteAcknowledgment(result), result);
	const deleted = { ...result, action: 'delete', expectedVersion: version, resultVersion: null };
	assert.deepEqual(parseThemeWriteAcknowledgment(deleted), deleted);
	for (const bad of [
		{ ...result, resultVersion: null },
		{ ...deleted, expectedVersion: null },
		{ ...result, ownerId: 'unexpected' },
		{ ...result, resultVersion: 'unversioned' },
		{ ...deleted, resultVersion: version }
	])
		assert.throws(() => parseThemeWriteAcknowledgment(bad));
});
