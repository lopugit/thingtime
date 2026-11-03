import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	blockLabel,
	collectBlockIds,
	countBlocks,
	findBlock,
	findParentId,
	insertBlock,
	moveBlock,
	newBlockId,
	removeBlock,
	updateBlock,
	type WebpageBlock
} from './webpageBlocks';

const tree = (): WebpageBlock[] => [
	{ id: 'a', type: 'text', text: 'hello' },
	{
		id: 'row',
		type: 'container',
		direction: 'row',
		children: [
			{ id: 'b', type: 'component', component: 'thingtime-button-solid' },
			{ id: 'c', type: 'text', text: 'world' }
		]
	},
	{ id: 'native-home', type: 'native', native: 'home' }
];

test('collect/count/find/parent basics', () => {
	const blocks = tree();
	assert.deepEqual([...collectBlockIds(blocks)].sort(), ['a', 'b', 'c', 'native-home', 'row']);
	assert.equal(countBlocks(blocks), 5);
	assert.equal(findBlock(blocks, 'c')?.text, 'world');
	assert.equal(findParentId(blocks, 'c'), 'row');
	assert.equal(findParentId(blocks, 'a'), null);
	assert.equal(findParentId(blocks, 'nope'), undefined);
});

test('insert at root and into a container; original tree untouched', () => {
	const blocks = tree();
	const atRoot = insertBlock(blocks, null, 1, { id: 'x', type: 'text', text: 'x' });
	assert.deepEqual(
		atRoot.map((block) => block.id),
		['a', 'x', 'row', 'native-home']
	);
	const inRow = insertBlock(blocks, 'row', 99, { id: 'y', type: 'text', text: 'y' });
	assert.deepEqual(
		findBlock(inRow, 'row')?.children?.map((block) => block.id),
		['b', 'c', 'y']
	);
	assert.equal(countBlocks(blocks), 5); // pure — input untouched
});

test('remove and update are id-targeted and immutable', () => {
	const blocks = tree();
	const removed = removeBlock(blocks, 'b');
	assert.deepEqual(findBlock(removed, 'row')?.children?.map((block) => block.id), ['c']);
	const updated = updateBlock(blocks, 'c', { text: 'planet', id: 'hijack', type: 'native' } as any);
	// id and type are pinned — a patch can never change them
	assert.equal(findBlock(updated, 'c')?.text, 'planet');
	assert.equal(findBlock(updated, 'c')?.type, 'text');
	assert.equal(findBlock(updated, 'hijack'), null);
});

test('move reorders at root, moves across containers, refuses cycles', () => {
	const blocks = tree();
	const reordered = moveBlock(blocks, 'native-home', null, 0);
	assert.deepEqual(reordered.map((block) => block.id), ['native-home', 'a', 'row']);

	const crossed = moveBlock(blocks, 'a', 'row', 1);
	assert.deepEqual(findBlock(crossed, 'row')?.children?.map((block) => block.id), ['b', 'a', 'c']);

	// moving a container into its own subtree is refused (tree unchanged)
	const nested: WebpageBlock[] = [
		{
			id: 'outer',
			type: 'container',
			direction: 'column',
			children: [{ id: 'inner', type: 'container', direction: 'column', children: [] }]
		}
	];
	assert.deepEqual(moveBlock(nested, 'outer', 'inner', 0), nested);
	// moving into a non-container is refused
	assert.deepEqual(moveBlock(blocks, 'a', 'native-home', 0), blocks);
});

test('move indices are rendered-seam indices — downward same-container drags land ON the seam', () => {
	// root renders [a, row, native-home]: drop a on the seam between row and
	// native-home (rendered index 2, computed while a is still in the list)
	const blocks = tree();
	const down = moveBlock(blocks, 'a', null, 2);
	assert.deepEqual(down.map((block) => block.id), ['row', 'a', 'native-home']);
	// a's own bottom seam (index 1) is a visual no-op and stays one
	const noop = moveBlock(blocks, 'a', null, 1);
	assert.deepEqual(noop.map((block) => block.id), ['a', 'row', 'native-home']);
	// end of list
	const last = moveBlock(blocks, 'a', null, 3);
	assert.deepEqual(last.map((block) => block.id), ['row', 'native-home', 'a']);
	// same convention inside a container: row renders [b, c] — drop b below c
	const inRow = moveBlock(blocks, 'b', 'row', 2);
	assert.deepEqual(findBlock(inRow, 'row')?.children?.map((block) => block.id), ['c', 'b']);
});

test('newBlockId never collides and labels stay short', () => {
	const existing = new Set(['text-1', 'text-2']);
	const id = newBlockId('text', existing);
	assert.ok(!existing.has(id));
	assert.equal(blockLabel({ id: 'x', type: 'text', style: 'heading' } as WebpageBlock), 'heading');
	assert.equal(blockLabel({ id: 'x', type: 'component', component: 'mui-card' } as WebpageBlock), 'mui-card');
	assert.equal(blockLabel({ id: 'x', type: 'native', native: 'feed' } as WebpageBlock), 'native · feed');
});

test('moveBlockRelative steps within the parent list and clamps at edges', async () => {
	const { moveBlockRelative } = await import('./webpageBlocks');
	const blocks = tree();
	const down = moveBlockRelative(blocks, 'a', 1);
	assert.deepEqual(down.map((block) => block.id), ['row', 'a', 'native-home']);
	// clamped: first block up / nested child within its own list only
	assert.deepEqual(moveBlockRelative(blocks, 'a', -1), blocks);
	const nestedUp = moveBlockRelative(blocks, 'c', -1);
	assert.deepEqual(findBlock(nestedUp, 'row')?.children?.map((block) => block.id), ['c', 'b']);
	assert.deepEqual(moveBlockRelative(blocks, 'missing', 1), blocks);
});

test('wrapBlock replaces the block with a container holding it, in place', async () => {
	const { wrapBlock } = await import('./webpageBlocks');
	const blocks = tree();
	const next = wrapBlock(blocks, 'c', 'grid');
	const row = next.find((block) => block.id === 'row')!;
	const wrapper = row.children![1];
	assert.equal(wrapper.type, 'container');
	assert.equal(wrapper.direction, 'grid');
	assert.equal(wrapper.columns, 2);
	assert.deepEqual(wrapper.children!.map((child) => child.id), ['c']);
	// the original list shape is otherwise untouched
	assert.deepEqual(next.map((block) => block.id), ['a', 'row', 'native-home']);
	assert.equal(row.children![0].id, 'b');
	// unknown id is a no-op
	assert.equal(wrapBlock(blocks, 'nope', 'row'), blocks);
});

test('duplicateBlock deep-clones with fresh ids right after the original', async () => {
	const { duplicateBlock } = await import('./webpageBlocks');
	const blocks = tree();
	const next = duplicateBlock(blocks, 'row');
	assert.equal(next.length, 4);
	const copy = next[2];
	assert.equal(copy.type, 'container');
	assert.notEqual(copy.id, 'row');
	assert.equal(copy.children!.length, 2);
	assert.ok(copy.children!.every((child, index) => child.id !== ['b', 'c'][index]));
	// no id collisions across the whole tree
	const { collectBlockIds: collect } = await import('./webpageBlocks');
	assert.equal([...collect(next)].length, new Set([...collect(next)]).size);
});

test('duplicateBlock clone ids always satisfy the server gate id pattern', async () => {
	const { duplicateBlock, collectBlockIds } = await import('./webpageBlocks');
	// mirrors COMPONENT_KEY_PATTERN in schemas/registry.ts, which the write
	// gate applies to EVERY block id — a clone that fails it is rejected at save
	const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
	// the 24-char prefix slice lands exactly on a separator here, which used to
	// mint `aaaaaaaaaaaaaaaaaaaaaaa--1` and make the save 400
	const longId = 'aaaaaaaaaaaaaaaaaaaaaaa-bbb-c';
	for (const id of [longId, 'a-b-c-d-e-f-g-h-i-j-k-l-m-n', 'hero-title', 'x']) {
		const next = duplicateBlock([{ id, type: 'text', text: 'hi' }], id);
		assert.equal(next.length, 2, `expected a copy for ${id}`);
		for (const blockId of collectBlockIds(next)) {
			assert.match(blockId, ID_PATTERN, `clone id "${blockId}" (from "${id}") must satisfy the gate`);
			assert.ok(blockId.length <= 40, `clone id "${blockId}" must fit the 40-char cap`);
		}
	}
});
