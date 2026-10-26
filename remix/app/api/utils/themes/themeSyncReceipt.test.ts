import { createHash } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { normalizeSavedTheme } from '../../../theme/savedTheme';
import { THEME_SYNC_MAX_BYTES } from './themeSyncContract';
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseThemeWrite } from './themeSyncContract';
import { themeWriteDigest, createThemeWriteReceipt, readThemeWriteReceipt } from './themeSyncReceipt';
const parsed = parseThemeWrite({
	action: 'save',
	id: '123e4567-e89b-42d3-a456-426614174000',
	writeId: 'fixture-write',
	expectedVersion: null,
	name: 'Peach',
	theme: {},
	visibility: 'private'
});
if (parsed.action !== 'save') throw Error('Invalid fixture');
const command = parsed;
const result = {
	id: command.id,
	writeId: command.writeId,
	action: 'save' as const,
	expectedVersion: null,
	resultVersion: 'theme-state-v1:' + 'a'.repeat(64)
};
const time = '2026-10-17T01:00:00.000Z';
test('theme receipt replays only the exact admitted owner, selected plane and normalized request', () => {
	const digest = themeWriteDigest('owner', 'home', command),
		receipt = createThemeWriteReceipt('owner', result, digest, time);
	assert.deepEqual(readThemeWriteReceipt(receipt, 'owner', command, digest), result);
	for (const [owner, plane, changed] of [
		['other', 'home', command],
		['owner', 'other', command],
		['owner', 'home', { ...command, name: 'New' }],
		['owner', 'home', { ...command, title: 'Other library title' }],
		['owner', 'home', { ...command, title: null }],
		['owner', 'home', { ...command, folderId: 'different-folder' }]
	] as const) {
		const wrong = themeWriteDigest(owner, plane, changed);
		assert.notEqual(wrong, digest);
		assert.throws(() => readThemeWriteReceipt(receipt, owner, changed, wrong));
	}
	assert.equal(receipt.mode, 'effect');
	assert.equal(receipt.after?.adapter, 'theme-write-receipt');
	assert.equal(JSON.stringify(receipt).includes('Peach'), false);
});
test('client imports, revision heads and altered acknowledgments cannot become successful theme receipts', () => {
	const digest = themeWriteDigest('owner', 'home', command),
		receipt = createThemeWriteReceipt('owner', result, digest, time);
	for (const changed of [
		{ ...receipt, source: 'client', clientId: 'forged' },
		{ ...receipt, actorId: 'other' },
		{ ...receipt, mode: 'revision', operation: 'update' },
		{ ...receipt, thingId: 'different' },
		{ ...receipt, after: { ...receipt.after, value: { ...result, requestDigest: digest, resultVersion: null } } },
		{ ...receipt, after: { ...receipt.after, value: { ...result, requestDigest: digest, ownerId: 'forged' } } }
	])
		assert.throws(() => readThemeWriteReceipt(changed, 'owner', command, digest));
});

test('pre-focus frozen commands retain their exact v1 receipt across transport and server reparsing', () => {
	const normalized = normalizeSavedTheme({ name: 'Peach', theme: {} });
	assert.ok(normalized.ok);
	const legacy = { ...command, theme: structuredClone(normalized.theme) };
	for (const key of ['focusBorder', 'focusGlowStart', 'focusGlowEnd']) Reflect.deleteProperty(legacy.theme.colors, key);
	for (const key of ['focusGlowBlur', 'focusGlowOpacity']) Reflect.deleteProperty(legacy.theme.general, key);
	// This reproduces the pre-upgrade algorithm without calling the new parser.
	const request = copyBoundedJson({ ownerId: 'owner', selectedPlane: 'home', storagePlane: 'home', command: legacy },
		{ maxBytes: THEME_SYNC_MAX_BYTES + 4096, maxDepth: 12, maxNodes: 4096, sortKeys: true });
	const admitted = 'theme-write-v1:' + createHash('sha256').update('thingtime:theme-write:v1\0').update(JSON.stringify(request)).digest('hex');
	assert.equal(admitted, 'theme-write-v1:1f074268f8566c93ca8dc8df4e0eea43cbdb5404d88f12d81296fc604662a5f5', 'Frozen pre-focus v1 receipt digest');
	const receipt = createThemeWriteReceipt('owner', result, admitted, time);
	const wire = parseThemeWrite(JSON.parse(JSON.stringify(legacy)));
	const reparsed = parseThemeWrite(wire);
	assert.deepEqual(wire, legacy); assert.deepEqual(reparsed, legacy);
	const digest = themeWriteDigest('owner', 'home', reparsed);
	assert.equal(digest, admitted);
	assert.deepEqual(readThemeWriteReceipt(receipt, 'owner', reparsed, digest), result);
	assert.equal(JSON.stringify(receipt), JSON.stringify(createThemeWriteReceipt('owner', result, admitted, time)), 'No receipt mutation or alternate replay identity');
	for (const [section, key, value] of [
		['colors', 'focusBorder', normalized.theme.colors.focusBorder], ['colors', 'focusGlowStart', '#123456'], ['colors', 'focusGlowEnd', '#234567'],
		['general', 'focusGlowBlur', 0], ['general', 'focusGlowOpacity', 0]
	] as const) {
		const changed = parseThemeWrite({ ...legacy, theme: { ...legacy.theme, [section]: { ...legacy.theme[section], [key]: value } } });
		const wrong = themeWriteDigest('owner', 'home', changed);
		assert.notEqual(wrong, admitted, 'An explicitly supplied focus field is distinct from an absent legacy field');
		assert.throws(() => readThemeWriteReceipt(receipt, 'owner', changed, wrong));
	}
});
