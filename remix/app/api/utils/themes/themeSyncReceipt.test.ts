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
