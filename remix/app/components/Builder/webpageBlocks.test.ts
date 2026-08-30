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
