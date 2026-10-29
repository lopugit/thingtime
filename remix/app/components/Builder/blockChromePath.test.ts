import assert from 'node:assert/strict';
import test from 'node:test';
import { blockChromePath, canAddBlockChildren, ownsBlockFocus, blockChromePosition, blockChromeBottomInset, shouldReleaseBlockChromePin, blockChromeSelectionState } from './blockChromePath';
import type { WebpageBlock } from './webpageBlocks';

test('breadcrumb keeps every editable ancestor through DOM, list and conditional children', () => {
 const leaf: WebpageBlock = { id: 'text', type: 'text', text: 'Hello' };
 const condition: WebpageBlock = { id: 'condition', type: 'condition', children: [leaf] };
 const collection: WebpageBlock = { id: 'list', type: 'collection', children: [condition] };
 const element: WebpageBlock = { id: 'section', type: 'element', tag: 'section', children: [collection] };
 const root: WebpageBlock = { id: 'row', type: 'container', direction: 'row', children: [element] };
 assert.deepEqual(blockChromePath([root], leaf.id).map(block => block.id), ['row', 'section', 'list', 'condition', 'text']);
 assert.deepEqual(blockChromePath([root], root.id), [root]);
 assert.deepEqual(blockChromePath([root], 'deleted'), []);
 assert.deepEqual(blockChromePath([root], null), []);
 for (const parent of [root, element, collection, condition]) assert.equal(canAddBlockChildren(parent), true);
 assert.equal(canAddBlockChildren(leaf), false);
});

test('append affordance accepts populated row, column, grid and authored children without invalid void children', () => {
 for (const direction of ['row', 'column', 'grid'] as const) {
  assert.equal(canAddBlockChildren({ id: direction, type: 'container', direction, children: [{ id: 'populated', type: 'text' }] }), true);
 }
 for (const tag of ['input', 'img', 'br', 'select', 'textarea']) assert.equal(canAddBlockChildren({ id: tag, type: 'element', tag }), false);
 assert.equal(canAddBlockChildren({ id: 'native', type: 'native' }), false);
});


test('inline editor focus belongs to the innermost frame rather than authored ancestors', () => {
 const inner = {};
 const outer = {};
 const editor = { closest: (selector: string) => selector === '[data-block-id]' ? inner : null } as unknown as EventTarget;
 assert.equal(ownsBlockFocus(editor, inner as EventTarget), true);
 assert.equal(ownsBlockFocus(editor, outer as EventTarget), false);
 assert.equal(ownsBlockFocus(null, outer as EventTarget), false);
});


test('toolbar remains reachable at right and bottom viewport edges', () => {
 const viewport = { width: 1280, height: 720 };
 const toolbar = { width: 540, height: 80 };
 const position = blockChromePosition({ frame: { left: 1190, top: 700, bottom: 740 }, toolbar, viewport, clearance: 52 });
 assert.equal(position.left + toolbar.width, viewport.width - 8);
 assert.ok(position.top + toolbar.height <= viewport.height - 8);
 assert.ok(position.top >= 60);
});

test('toolbar flips below a top-edge block and bounds wrapped paths in mobile iframe viewports', () => {
 assert.deepEqual(blockChromePosition({ frame: { left: 20, top: 60, bottom: 90 }, toolbar: { width: 200, height: 44 }, viewport: { width: 800, height: 600 }, clearance: 52 }), { left: 26, top: 88 });
 const mobile = blockChromePosition({ frame: { left: 340, top: 620, bottom: 670 }, toolbar: { width: 359, height: 300 }, viewport: { width: 375, height: 667 }, clearance: 52 });
 assert.equal(mobile.left, 8);
 assert.ok(mobile.top >= 60);
 assert.ok(mobile.top + 300 <= 659);
});


test('breadcrumb selection stays pinned across toolbar relocation until deliberate canvas input', () => {
 const clicked = { x: 300, y: 210 };
 assert.equal(shouldReleaseBlockChromePin(clicked, clicked, false), false);
 assert.equal(shouldReleaseBlockChromePin(clicked, { x: 302, y: 211 }, false), false);
 assert.equal(shouldReleaseBlockChromePin(clicked, { x: 400, y: 300 }, true), false);
 assert.equal(shouldReleaseBlockChromePin(clicked, { x: 310, y: 211 }, false), true);
 assert.equal(shouldReleaseBlockChromePin(clicked, clicked, false, true), true);
});


test('pinned breadcrumb waits for lagging host chrome selection before detecting later changes', () => {
 assert.equal(blockChromeSelectionState('grid', 'text', null), 'pending');
 assert.equal(blockChromeSelectionState('grid', 'grid', null), 'acknowledged');
 assert.equal(blockChromeSelectionState('grid', 'text', 'grid'), 'changed');
});


test('tall breadcrumbs reserve measured Builder footer space with internal scroll', () => {
 const position = blockChromePosition({ frame: { left: 8, top: 500, bottom: 700 }, toolbar: { width: 304, height: 680 }, viewport: { width: 320, height: 800 }, clearance: 52, bottomClearance: 120 });
 const availableHeight = 800 - 52 - 120 - 16;
 assert.ok(position.top >= 60);
 assert.ok(position.top + availableHeight <= 800 - 120 - 8);
});

test('host toolbar clearance projects into scaled iframe and skips previews above its edge', () => {
 assert.equal(blockChromeBottomInset(800, 680, 0, 1), 120);
 assert.equal(blockChromeBottomInset(800, 680, 100, 0.8), 75);
 assert.equal(blockChromeBottomInset(600, 680, 0, 1), 0);
});
