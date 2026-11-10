import { parseTransientBinding } from '../Builder/transientBlockActions';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSyncResourceDraft, syncResourceDraft, syncResourceControlsBlocks, syncSpeedBytes } from './syncResourceControlsBlocks';
test('resource drafts support optional decimal bit rates and unrestricted safe concurrency', () => {
 const empty = syncResourceDraft(); assert.equal(parseSyncResourceDraft(empty), undefined);
 assert.deepEqual(parseSyncResourceDraft({ ...empty, upload: '2', uploadUnit: 'Mbps', download: '0.5', downloadUnit: 'Gbps', transferConcurrency: '4096', indexingConcurrency: '1024', cpuPercent: '100' }),
 { uploadBytesPerSecond: 250000, downloadBytesPerSecond: 62500000, transferConcurrency: 4096, indexingConcurrency: 1024, cpuPercent: 100 });
 for (const [key, value] of [['cpuPercent', '101'], ['cpuPercent', '1.5'], ['transferConcurrency', '0'], ['indexingConcurrency', '9007199254740992'], ['upload', '-1'], ['download', 'Infinity']] as const)
  assert.throws(() => parseSyncResourceDraft({ ...empty, [key]: value }));
 assert.equal(syncResourceDraft({ uploadBytesPerSecond: 250000 }).upload, '2');
});
test('decimal speeds never round upward beyond the exact requested ceiling', () => {
 assert.equal(syncSpeedBytes('1', 'Kbps'), 125); assert.equal(syncSpeedBytes('', 'Mbps'), undefined);
 // Exact 0.0014 Kbps = 0.175 bytes/s. The upper adjacent double would exceed it.
 const value = syncSpeedBytes('0.0014', 'Kbps')!;
 assert.ok(value <= 0.175); assert.ok(value > 0);
 assert.equal(syncSpeedBytes('1e-3', 'Mbps'), 125);
 assert.throws(() => syncSpeedBytes('0', 'Mbps')); assert.throws(() => syncSpeedBytes('1e999', 'Gbps'));
});
test('each resource label, input, unit option and help text is an individual Builder block', () => {
 const all: any[] = []; const walk = (blocks: any[]) => { for (const block of blocks) { all.push(block); if (block.children) walk(block.children); } }; walk(syncResourceControlsBlocks);
 assert.equal(new Set(all.map(block => block.id)).size, all.length);
 assert.equal(all.filter(block => block.tag === 'input').length, 5);
 assert.equal(all.filter(block => block.tag === 'select').length, 2);
 assert.equal(all.filter(block => block.tag === 'option').length, 6);
 const controls = all.filter(block => block.props?.['data-tt-action'] === '$transient');
 assert.equal(controls.length, 7);
 for (const control of controls) assert.ok(parseTransientBinding(JSON.stringify(control.props['data-tt-action-inputs'])), control.id);
 assert.ok(all.some(block => block.id === 'cpu-help' && block.text.includes('only for this sync workload')));
});

test('the resource editor default document passes the real Settings Builder validator', () => {
 const blocks = settingsDocumentBlocks(syncResourceControlsBlocks); assert.equal(blocks.length, 1);
});
