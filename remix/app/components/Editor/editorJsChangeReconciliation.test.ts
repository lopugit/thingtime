import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { acknowledgeLatestEditorJsEcho, shouldAcceptEditorJsSnapshot } from './editorJsChangeReconciliation.ts';

test('retires skipped intermediate signatures when React commits the final echo', () => {
	const pending = ['AB', 'A'];
	assert.equal(acknowledgeLatestEditorJsEcho(pending, 'A', 'A', 'A'), true);
	assert.deepEqual(pending, []);
});

test('preserves a normal changed parent echo for changed-signature reconciliation', () => {
	const pending = ['B'];
	assert.equal(acknowledgeLatestEditorJsEcho(pending, 'A', 'B', 'B'), false);
	assert.deepEqual(pending, ['B']);
});

test('does not retire a pending edit for an older parent value', () => {
	const pending = ['AB'];
	assert.equal(acknowledgeLatestEditorJsEcho(pending, 'A', 'A', 'AB'), false);
	assert.deepEqual(pending, ['AB']);
});

test('rejects an old editor result after a newer cross-remount sequence', () => {
	const source = { configKey: 'old-tools', valueMode: 'blocks', externalRevision: 2 };
	const current = { valueMode: 'blocks', externalRevision: 2 };
	assert.equal(shouldAcceptEditorJsSnapshot(source, current, 3, 4), false);
	assert.equal(shouldAcceptEditorJsSnapshot(source, current, 5, 4), true);
});

test('rejects results invalidated by conversion or external replacement', () => {
	const source = { configKey: 'old', valueMode: 'string', externalRevision: 1 };
	assert.equal(shouldAcceptEditorJsSnapshot(source, { valueMode: 'blocks', externalRevision: 1 }, 5, 0), false);
	assert.equal(shouldAcceptEditorJsSnapshot(source, { valueMode: 'string', externalRevision: 2 }, 5, 0), false);
});
