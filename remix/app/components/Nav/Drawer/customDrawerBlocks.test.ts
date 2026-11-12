import assert from 'node:assert/strict';
import test from 'node:test';
import { customDrawerBlocks, customDrawerPresentationBlocks } from './customDrawerBlocks';
import type { WebpageBlock } from '~/components/Builder/webpageBlocks';

const flatten = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
for (const settings of [false, true]) {
 test(`closed ${settings ? 'settings' : 'navigation'} item editor does not mount default inputs or mutate saved template`, () => {
  const saved = customDrawerBlocks(settings);
  const before = JSON.stringify(saved);
  const rendered = flatten(customDrawerPresentationBlocks(saved, false, false));
  assert.equal(rendered.some(block => block.id === 'drawer-emoji'), false);
  assert.equal(rendered.some(block => block.id === 'drawer-title'), false);
  assert.equal(rendered.some(block => block.id === 'custom-drawer-dialog'), false);
  assert.equal(rendered.some(block => block.id === 'custom-drawer-add'), true);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(flatten(saved).some(block => block.id === 'drawer-emoji'), true);
 });
 test(`open ${settings ? 'settings' : 'navigation'} draft and Builder editing preserve all inputs regardless of navigation visibility`, () => {
  const saved = customDrawerBlocks(settings);
  assert.equal(customDrawerPresentationBlocks(saved, true, false), saved);
  assert.equal(customDrawerPresentationBlocks(saved, false, true), saved);
  assert.equal(flatten(customDrawerPresentationBlocks(saved, true, false)).some(block => block.id === 'drawer-emoji'), true);
 });
}
test('projection preserves unknown hidden drafts and authored non-dialog blocks', () => {
 const saved: WebpageBlock[] = [
  { id: 'other-dialog', type: 'element', tag: 'dialog', children: [{ id: 'unsaved', type: 'element', tag: 'input', props: { value: 'keep draft' } }] },
  { id: 'custom-drawer-dialog', type: 'element', tag: 'section', children: [{ id: 'authored', type: 'text', text: 'Keep authored content' }] }
 ];
 assert.deepEqual(customDrawerPresentationBlocks(saved, false, false), saved);
});
