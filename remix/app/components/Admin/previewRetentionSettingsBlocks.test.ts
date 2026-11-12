import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIEW_RETENTION_SETTINGS_BLOCKS } from './previewRetentionSettingsBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { parseTransientBinding } from '../Builder/transientBlockActions';
import type { WebpageBlock } from '../Builder/webpageBlocks';
const flatten = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
test('retention layouts retain separately editable nested copy, fields and actions through saved-block validation', () => {
  const blocks = flatten(settingsDocumentBlocks(PREVIEW_RETENTION_SETTINGS_BLOCKS));
  assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length);
  assert.ok(blocks.every(block => ['element', 'condition'].includes(block.type)));
  for (const suffix of ['cleanup-title', 'cleanup-description', 'enabled-label', 'enabled-hint', 'enabled-input', 'orphan-grace-label', 'orphan-grace-input', 'superseded-input', 'superseded-grace-input', 'liveliness-title', 'inactive-input', 'inactive-days-input', 'protection-title', 'protection-copy', 'save', 'reload'])
    assert.ok(blocks.some(block => block.id === `preview-retention-${suffix}`), suffix);
  const controls = blocks.filter(block => ['input', 'button'].includes(block.tag || ''));
  assert.equal(controls.length, 8);
  assert.deepEqual(controls.map(block => parseTransientBinding(JSON.stringify(block.props?.['data-tt-action-inputs']))?.operation).sort(),
    ['policy.enabled', 'policy.inactive', 'policy.inactive-days', 'policy.orphan-grace', 'policy.reload', 'policy.save', 'policy.superseded', 'policy.superseded-grace'].sort());
  assert.ok(controls.every(block => block.props?.['data-tt-action'] === '$transient'));
  assert.ok(blocks.every(block => block.source === undefined && block.component === undefined && block.native === undefined));
});
test('each persisted scalar label and control can be edited independently without freezing its siblings', () => {
  const blocks = settingsDocumentBlocks(PREVIEW_RETENTION_SETTINGS_BLOCKS);
  const all = flatten(blocks);
  const label = all.find(block => block.id === 'preview-retention-enabled-label')!;
  const input = all.find(block => block.id === 'preview-retention-enabled-input')!;
  label.text = 'My cleanup setting'; input.css = { ...input.css, 'accent-color': '#663399' };
  const roundtrip = flatten(settingsDocumentBlocks(JSON.parse(JSON.stringify(blocks))));
  assert.equal(roundtrip.find(block => block.id === label.id)?.text, 'My cleanup setting');
  assert.equal(roundtrip.find(block => block.id === input.id)?.css?.['accent-color'], '#663399');
  assert.equal(roundtrip.find(block => block.id === 'preview-retention-orphan-grace-label')?.text, 'Closed or missing PR grace period (hours)');
});
