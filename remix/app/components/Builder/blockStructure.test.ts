import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockStructureBlocks, blockStructureData } from './blockStructure';
import { collectBlockIds, findBlock, insertBlock, insertBlockRelative, removeBlock, type WebpageBlock } from './webpageBlocks';
import { resolveBlockProps } from './templateBlocks';
import { parseTransientBinding } from './transientBlockActions';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';

const text = (id: string): WebpageBlock => ({ id, type: 'text', text: `Content ${id}` });
const tree = (): WebpageBlock[] => [text('intro'), { id: 'row', type: 'container', direction: 'row', children: [
 text('left'), { id: 'column', type: 'container', direction: 'column', children: [text('inner'), text('last')] }
] }, text('footer')];

test('directional insertion uses matching axes and leaves unrelated siblings in place', () => {
 const initial = tree();
 const root = insertBlockRelative(initial, 'intro', 'above', text('new'));
 assert.deepEqual(root.map(block => block.id), ['new', 'intro', 'row', 'footer']);
 const row = insertBlockRelative(initial, 'left', 'right', text('new'));
 assert.deepEqual(findBlock(row, 'row')?.children?.map(block => block.id), ['left', 'new', 'column']);
 const column = insertBlockRelative(initial, 'inner', 'below', text('new'));
 assert.deepEqual(findBlock(column, 'column')?.children?.map(block => block.id), ['inner', 'new', 'last']);
 assert.deepEqual(initial, tree());
});

test('cross-axis insertion wraps only the target and retains original content and unique identities', () => {
 const initial = tree();
 const vertical = insertBlockRelative(initial, 'left', 'above', text('new'));
 const wrapper = findBlock(vertical, 'row')!.children![0];
 assert.equal(wrapper.direction, 'column');
 assert.deepEqual(wrapper.children?.map(block => block.id), ['new', 'left']);
 assert.equal(findBlock(vertical, 'column')?.children?.[0].text, 'Content inner');
 const horizontal = insertBlockRelative(initial, 'inner', 'left', text('new'));
 const row = findBlock(horizontal, 'column')!.children![0];
 assert.equal(row.direction, 'row');
 assert.deepEqual(row.children?.map(block => block.id), ['new', 'inner']);
 assert.equal(findBlock(horizontal, 'inner')?.text, 'Content inner');
 assert.equal(collectBlockIds(horizontal).size, collectBlockIds(initial).size + 2);
 assert.deepEqual(insertBlockRelative(initial, 'missing', 'right', text('new')), initial);
 assert.equal(insertBlockRelative(initial, 'left', 'right', text('intro')), initial);
});

test('directional insertion understands reversed flex and does not reorder a grid', () => {
 const reversed: WebpageBlock[] = [{ id: 'reverse', type: 'element', tag: 'div', css: { display: 'flex', 'flex-direction': 'row-reverse' }, children: [text('a'), text('b')] }];
 const next = insertBlockRelative(reversed, 'a', 'left', text('new'));
 assert.deepEqual(findBlock(next, 'reverse')?.children?.map(block => block.id), ['a', 'new', 'b']);
 const grid: WebpageBlock[] = [{ id: 'grid', type: 'container', direction: 'grid', columns: 2, children: [text('a'), text('b')] }];
 const nextGrid = insertBlockRelative(grid, 'a', 'right', text('new'));
 assert.equal(findBlock(nextGrid, 'grid')?.children?.[0].direction, 'row');
 assert.equal(findBlock(nextGrid, 'grid')?.children?.[1].id, 'b');
});

test('relative insertion refuses specialised parent grammars on matching and wrapper axes', () => {
 const option: WebpageBlock = { id: 'choice', type: 'element', tag: 'option', text: 'Saved choice', props: { value: 'saved' } };
 for (const tag of ['select', 'SELECT', 'option', 'textarea', 'input']) {
  for (const css of [undefined, { display: 'flex', 'flex-direction': 'row' }, { display: 'flex', 'flex-direction': 'column' }]) {
   const blocks: WebpageBlock[] = [{ id: 'control', type: 'element', tag, css, children: [option] }];
   for (const direction of ['above', 'below', 'left', 'right'] as const) {
    const next = insertBlockRelative(blocks, option.id, direction, text('new'));
    assert.equal(next, blocks, `${tag} ${css?.['flex-direction'] || 'wrapper'} ${direction}`);
    assert.equal(next[0].children?.[0], option);
    assert.equal(collectBlockIds(next).size, 2);
   }
  }
 }
 const transparent: WebpageBlock[] = [{ id: 'transparent', type: 'element', tag: 'section', props: { transparent: true }, children: [text('child')] }];
 assert.equal(insertBlockRelative(transparent, 'child', 'right', text('new')), transparent);
});

test('first child insertion initializes supported blocks without children; leaves are refused', () => {
 for (const type of ['container', 'element', 'condition', 'collection'] as const) {
  const blocks: WebpageBlock[] = [{ id: 'parent', type, ...(type === 'element' ? { tag: 'section' } : {}) }];
  assert.equal(insertBlock(blocks, 'parent', 0, text('new'))[0].children?.[0].id, 'new');
  assert.equal(blocks[0].children, undefined);
 }
 const blocks = [text('leaf')];
 assert.equal(insertBlock(blocks, 'leaf', 0, text('new')), blocks);
 for (const tag of ['input', 'IMG', 'textarea', 'select']) {
  const leaves: WebpageBlock[] = [{ id: 'leaf', type: 'element', tag }];
  assert.equal(insertBlock(leaves, 'leaf', 0, text('new')), leaves);
 }
});

test('structure scopes project the actual tree and stay coherent after insert/delete', () => {
 const initial = tree();
 assert.deepEqual(blockStructureData(initial, 'inner', 'block', 'inner').rows.map(row => row.id), ['inner']);
 assert.deepEqual(blockStructureData(initial, 'inner', 'parent', 'inner').rows.map(row => row.id), ['column', 'inner', 'last']);
 const full = blockStructureData(initial, 'inner', 'page', 'inner');
 assert.equal(full.rows.find(row => row.id === 'inner')?.depth, 2);
 assert.equal(full.rows.find(row => row.id === 'inner')?.selected, true);
 const changed = insertBlockRelative(initial, 'inner', 'below', text('added'));
 assert.deepEqual(blockStructureData(changed, 'inner', 'parent', 'added').rows.map(row => row.id), ['column', 'inner', 'added', 'last']);
 const missing = blockStructureData(removeBlock(initial, 'inner'), 'inner', 'block', null);
 assert.equal(missing.scope, 'page');
 assert.match(missing.description, /removed/);
 assert.equal(blockStructureData(initial, 'intro', 'parent', null).rootId, null);
});

test('structure projection has no block-count or nesting-depth product limit', () => {
 const blocks = Array.from({ length: 250 }, (_, index) => text(`block-${index}`));
 assert.equal(blockStructureData(blocks, 'block-0', 'page', null).rows.length, 250);
 let nested: WebpageBlock = text('deep');
 for (let index = 0; index < 40; index++) nested = { id: `nest-${index}`, type: 'container', children: [nested] };
 const result = blockStructureData([nested], 'deep', 'page', 'deep');
 assert.equal(result.rows.at(-1)?.depth, 40);
 assert.match(result.rows.at(-1)!.indent, /30%/);
});

test('structure layout validates as individually editable persisted blocks with safe scalar selection bindings', () => {
 assert.deepEqual(settingsDocumentBlocks(blockStructureBlocks), blockStructureBlocks);
 const row = findBlock(blockStructureBlocks, 'structure-node')!;
 assert.deepEqual(row.children?.map(child => child.id), ['structure-node-label', 'structure-node-selection', 'structure-node-detail']);
 const props = resolveBlockProps(row.props!, { item: { id: 'a"quoted\\id', label: 'Text', selected: true, indent: '14px', border: '#f00', background: '#fff' } });
 const binding = parseTransientBinding(JSON.stringify(props['data-tt-action-inputs']));
 assert.equal(binding?.operation, 'select');
 assert.equal(binding?.inputs.blockId, 'a"quoted\\id');
 assert.equal(props['aria-pressed'], true);
 assert.equal((props.style as Record<string, string>).marginLeft, '14px');
});
