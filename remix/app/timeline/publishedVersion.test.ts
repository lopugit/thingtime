import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePublishedVersionPreview, parseVersionRequest } from './publishedVersion.ts';
const request = { command: 'preview-version' as const, mode: 'restore' as const, eventId: 'old', recover: true as const };
const snapshot = (acl: string[]) => ({
	adapter: 'thing-content',
	version: 1,
	value: { crystal: { title: 'Recovered' }, extended: null, tags: [], geo: null, acl, folderId: null }
});
const preview = {
	eventId: 'old',
	thingId: 'thing',
	mode: 'restore',
	expectedHeadId: 'deletion',
	current: null,
	recovery: true,
	recoveryFingerprint: 'a'.repeat(64),
	incoming: snapshot(['tt:all']),
	result: snapshot(['tt:user']),
	baseEventId: null,
	conflicts: []
};
test('recovery previews explicitly represent absence and promise private results', () => {
	assert.deepEqual(parsePublishedVersionPreview(preview, 'old', 'thing', request), preview);
	for (const change of [
		{ recovery: false },
		{ recoveryFingerprint: 'invalid' },
		{ result: snapshot(['tt:all']) },
		{ baseEventId: 'base' },
		{ current: snapshot(['tt:user']) }
	])
		assert.throws(() => parsePublishedVersionPreview({ ...preview, ...change }, 'old', 'thing', request));
	assert.throws(() => parsePublishedVersionPreview(preview, 'old', 'thing', { ...request, recover: undefined }));
});
test('undo is a third merge-engine mode that keeps recovery restore-only', () => {
	const undo = { command: 'preview-version' as const, mode: 'undo' as const, eventId: 'middle', choices: {}, componentMode: 'current' as const, componentChoices: {} };
	assert.deepEqual(parseVersionRequest(undo), undo);
	assert.throws(() => parseVersionRequest({ ...undo, recover: true }), /recovery/);
	assert.throws(() => parseVersionRequest({ ...undo, mode: 'revert' }), /Invalid version request/);
	const apply = { ...undo, command: 'apply-version', expectedHeadId: 'head', operationId: '377abf25-b322-4ac0-9707-a59c36e7bcd5', expectedComponents: 'b'.repeat(64) };
	assert.deepEqual(parseVersionRequest(apply), apply);
	const { expectedComponents: _omitted, ...unreviewed } = apply;
	assert.throws(() => parseVersionRequest(unreviewed), /components/);
});
test('recovery is explicit restore-only and its preview identity is bounded', () => {
	assert.deepEqual(parseVersionRequest(request), request);
	for (const change of [{ recover: false }, { mode: 'merge' }, { expectedRecovery: 'a'.repeat(64) }])
		assert.throws(() => parseVersionRequest({ ...request, ...change }));
	const apply = {
		...request,
		command: 'apply-version',
		operationId: '277abf25-b322-4ac0-9707-a59c36e7bcd5',
		expectedHeadId: 'deletion',
		expectedRecovery: 'a'.repeat(64)
	};
	assert.deepEqual(parseVersionRequest(apply), apply);
	assert.throws(() => parseVersionRequest({ ...apply, expectedRecovery: 'invalid' }));
	assert.throws(() => parseVersionRequest({ ...apply, recover: undefined }));
});
