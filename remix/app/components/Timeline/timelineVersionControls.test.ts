import assert from 'node:assert/strict';
import test from 'node:test';
import { historyAncestryLine, normalizeVersionName, versionControlState } from './timelineVersionControls.ts';
import { TIMELINE_UNDO_LABEL } from '../../timeline/publishedVersion.ts';
import { TIMELINE_VERSION_NAME_MAX_CHARS } from '../../timeline/versionNames.ts';
import { eventFixture } from '../../timeline/testFixtures.ts';

const saved = (overrides = {}) => eventFixture('saved', { mode: 'revision', operation: 'update', source: 'api', clientId: null, before: { adapter: 'thing-content', version: 1, value: {} }, after: { adapter: 'thing-content', version: 1, value: {} }, ...overrides });

test('name and export controls follow sync state, mode, content and the live connection', () => {
	assert.deepEqual(versionControlState({ status: 'accepted', event: saved() }, true), { name: true, export: true, title: '' });
	assert.deepEqual(versionControlState({ status: 'pending', event: saved() }, true), { name: false, export: false, title: 'Sync this version first' });
	assert.deepEqual(versionControlState({ status: 'accepted', event: saved() }, false), { name: false, export: false, title: 'Reconnect to name or export versions' });
	assert.equal(versionControlState({ status: 'accepted', event: eventFixture('draft') }, true).name, false);
	assert.equal(versionControlState({ status: 'accepted', event: eventFixture('draft') }, true).export, false);
	assert.equal(versionControlState({ status: 'accepted', event: saved({ mode: 'effect', operation: 'effect', before: null }) }, true).export, false);
	// A synced deletion has `before` content the server can export, but no `after` to name.
	const deletion = versionControlState({ status: 'accepted', event: saved({ operation: 'delete', after: null }) }, true);
	assert.deepEqual(deletion, { name: false, export: true, title: 'Only saved versions can be named' });
});

test('typed names are trimmed, stripped of control characters and bounded like the server rule', () => {
	assert.equal(normalizeVersionName('  Launch copy \u0007 '), 'Launch copy');
	assert.equal(normalizeVersionName('x'.repeat(200)).length, TIMELINE_VERSION_NAME_MAX_CHARS);
	assert.equal(normalizeVersionName('\n\t'), '');
});

test('the ancestry line names an undo by the change it reverted and the head it continued from', () => {
	assert.equal(historyAncestryLine({ parentIds: [], operation: 'create', label: 'Add page' }), 'First recorded moment');
	assert.equal(historyAncestryLine({ parentIds: ['head-123456789012345'], operation: 'update', label: 'Edited' }), 'Continues from head-1234567');
	assert.equal(historyAncestryLine({ parentIds: ['head-1', 'other-1'], operation: 'merge', label: 'Merged' }), 'Combined from head-1 + other-1');
	assert.equal(historyAncestryLine({ parentIds: ['head-1', 'source-1'], operation: 'restore', label: TIMELINE_UNDO_LABEL }), 'Undid source-1 · continues from head-1');
	assert.equal(historyAncestryLine({ parentIds: ['head-1'], operation: 'restore', label: TIMELINE_UNDO_LABEL }), 'Undid head-1 · continues from head-1');
	// The label alone never promotes a plain restore or a client label to an undo.
	assert.equal(historyAncestryLine({ parentIds: ['head-1', 'source-1'], operation: 'restore', label: 'Restored' }), 'Combined from head-1 + source-1');
	assert.equal(historyAncestryLine({ parentIds: ['head-1', 'source-1'], operation: 'merge', label: TIMELINE_UNDO_LABEL }), 'Combined from head-1 + source-1');
});
