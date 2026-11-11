import assert from 'node:assert/strict';
import test from 'node:test';
import { findBlock } from '../Builder/webpageBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { readSpeedTrackers, speedDraftBlocks, speedTrackerBlocks, transferSpeedBlocks, updateSpeedTracker, MAX_SPEED_TRACKERS } from './transferSpeedBlocks';

test('speed preferences are independently editable blocks without runtime values', () => {
 const blocks = settingsDocumentBlocks(transferSpeedBlocks);
 assert.equal(readSpeedTrackers(blocks).length, 1);
 assert.ok(settingsDocumentBlocks([speedTrackerBlocks({ id: 'tracker-abcdef123456', windowValue: 1, windowUnit: 'hours', unit: 'Gbps' })]));
 for (const suffix of ['title', 'window-label', 'window', 'time-label', 'time', 'unit-label', 'unit', 'upload', 'download', 'apply', 'remove']) assert.ok(findBlock(blocks, `tracker-default-${suffix}`), suffix);
 const next = updateSpeedTracker(blocks, { id: 'tracker-default', windowValue: 2, windowUnit: 'minutes', unit: 'Files/ps' });
 assert.deepEqual(readSpeedTrackers(next), [{ id: 'tracker-default', windowValue: 2, windowUnit: 'minutes', unit: 'Files/ps' }]);
 assert.equal(readSpeedTrackers(blocks)[0].windowValue, 10);
 const encoded = JSON.stringify(next);
 assert.ok(!encoded.includes('counters')); assert.ok(!encoded.includes('bytesTransferred')); assert.ok(!encoded.includes('private/home'));
 assert.deepEqual(readSpeedTrackers(settingsDocumentBlocks(JSON.parse(encoded))), readSpeedTrackers(next));
});

test('invalid authored tracker windows and units never reach arithmetic; list work stays bounded', () => {
 const blocks = structuredClone(transferSpeedBlocks), parent = findBlock(blocks, 'speed-trackers')!;
 parent.children = Array.from({ length: 24 }, (_, i) => speedTrackerBlocks({ id: `tracker-${i}`, windowValue: 1, windowUnit: 'seconds', unit: 'Kbps' }));
 assert.equal(readSpeedTrackers(blocks).length, MAX_SPEED_TRACKERS);
 for (const value of [0, -1, 86401, Infinity, NaN]) {
  const next = updateSpeedTracker(transferSpeedBlocks, { id: 'tracker-default', windowValue: value, windowUnit: 'seconds', unit: 'Mbps' });
  assert.deepEqual(readSpeedTrackers(next), []);
 }
 const wrong = structuredClone(transferSpeedBlocks); findBlock(wrong, 'tracker-default-unit')!.props!.value = 'Physical IOPS';
 assert.deepEqual(readSpeedTrackers(wrong), []);
});


test('raw speed draft fields preserve incomplete values without changing applied tracker preferences', () => {
 const fields = { 'tracker-default': { window: '0', time: 'hours', unit: 'Gbps' } };
 const next = speedDraftBlocks(transferSpeedBlocks, fields);
 assert.equal(findBlock(next, 'tracker-default-window')?.props?.value, '0');
 assert.equal(findBlock(next, 'tracker-default-time')?.props?.value, 'hours');
 assert.equal(findBlock(next, 'tracker-default-unit')?.props?.value, 'Gbps');
 assert.deepEqual(findBlock(next, 'tracker-default-window')?.props?.['data-tt-action-inputs'], { operation: 'edit', id: 'tracker-default', field: 'window' });
 assert.equal(findBlock(transferSpeedBlocks, 'tracker-default-window')?.props?.value, 10);
});
