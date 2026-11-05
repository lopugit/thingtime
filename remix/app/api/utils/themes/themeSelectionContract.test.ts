import assert from 'node:assert/strict';
import test from 'node:test';
import { parseThemeSelection, parseThemeSelectionWrite, parseThemeSelectionAcknowledgment } from './themeSelectionContract';
const version = 'theme-selection-v1:' + 'a'.repeat(64),
	command = { themeId: 'fixture-theme', expectedVersion: version, writeId: 'fixture-write' };
test('active theme contracts preserve null clearing and reject authority, oversized and ambiguous fields', () => {
	assert.deepEqual(parseThemeSelection({ themeId: null, version }), { themeId: null, version });
	assert.deepEqual(parseThemeSelectionWrite(command), command);
	const acknowledgment = { ...command, result: { themeId: command.themeId, version } };
	assert.deepEqual(parseThemeSelectionAcknowledgment(acknowledgment), acknowledgment);
	for (const row of [
		{ ...command, ownerId: 'forged' },
		{ ...command, themeId: {} },
		{ ...command, themeId: undefined },
		{ ...command, expectedVersion: 'old' },
		{ ...command, writeId: 'x'.repeat(161) },
		{ ...command, themeId: '../../escape' }
	])
		assert.throws(() => parseThemeSelectionWrite(row));
	assert.throws(() => parseThemeSelectionAcknowledgment({ ...acknowledgment, result: { themeId: 'other', version } }));
	assert.throws(() => parseThemeSelection({ themeId: null, version, privateValue: 'not accepted' }));
});
