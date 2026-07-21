import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { computeDropIndex, describeBlockMove, getAutoscrollStep, isBlockMoveKeydown, resolveMoveTarget } from './editorJsBlockReorder.ts';

const rects = [
	{ top: 0, bottom: 100 },
	{ top: 100, bottom: 200 },
	{ top: 200, bottom: 300 }
];

test('computeDropIndex maps a pointer to the insertion boundary at block midpoints', () => {
	assert.equal(computeDropIndex(rects, -20), 0); // above everything
	assert.equal(computeDropIndex(rects, 30), 0); // top half of block 0
	assert.equal(computeDropIndex(rects, 70), 1); // bottom half of block 0
	assert.equal(computeDropIndex(rects, 149), 1); // top half of block 1
	assert.equal(computeDropIndex(rects, 151), 2); // bottom half of block 1
	assert.equal(computeDropIndex(rects, 260), 3); // bottom half of the last block
	assert.equal(computeDropIndex(rects, 999), 3); // below everything
	assert.equal(computeDropIndex([], 50), 0); // no blocks: only boundary 0
});

test('resolveMoveTarget adjusts for the removed block and nulls every no-op', () => {
	// dropping block 0 at its own boundaries is a no-op both ways
	assert.equal(resolveMoveTarget(0, 0), null);
	assert.equal(resolveMoveTarget(1, 0), null);
	// dropping block 2 just above or below itself is a no-op
	assert.equal(resolveMoveTarget(2, 2), null);
	assert.equal(resolveMoveTarget(3, 2), null);
	// real moves
	assert.equal(resolveMoveTarget(0, 2), 0); // drag block 2 to the top
	assert.equal(resolveMoveTarget(3, 0), 2); // drag block 0 to the bottom (3 blocks)
	assert.equal(resolveMoveTarget(2, 0), 1); // drag block 0 below block 1
});

test('getAutoscrollStep is zero mid-viewport and grows toward the edges', () => {
	assert.equal(getAutoscrollStep(500, 0, 1000), 0);
	assert.ok(getAutoscrollStep(10, 0, 1000) < 0, 'near the top scrolls up');
	assert.ok(getAutoscrollStep(990, 0, 1000) > 0, 'near the bottom scrolls down');
	// closer to the edge = faster, bounded by the max step
	const near = Math.abs(getAutoscrollStep(2, 0, 1000));
	const far = Math.abs(getAutoscrollStep(40, 0, 1000));
	assert.ok(near > far);
	assert.ok(near <= 24);
	// pointer already past the edge clamps to the max step
	assert.equal(getAutoscrollStep(-50, 0, 1000), -24);
});

test('isBlockMoveKeydown matches Alt+Shift+vertical arrows only', () => {
	const base = { altKey: true, shiftKey: true, metaKey: false, ctrlKey: false };
	assert.equal(isBlockMoveKeydown({ ...base, key: 'ArrowUp' }), 'up');
	assert.equal(isBlockMoveKeydown({ ...base, key: 'ArrowDown' }), 'down');
	assert.equal(isBlockMoveKeydown({ ...base, key: 'ArrowLeft' }), null);
	assert.equal(isBlockMoveKeydown({ ...base, key: 'ArrowUp', metaKey: true }), null);
	assert.equal(isBlockMoveKeydown({ ...base, key: 'ArrowUp', ctrlKey: true }), null);
	assert.equal(isBlockMoveKeydown({ altKey: false, shiftKey: true, metaKey: false, ctrlKey: false, key: 'ArrowUp' }), null);
	assert.equal(isBlockMoveKeydown({ altKey: true, shiftKey: false, metaKey: false, ctrlKey: false, key: 'ArrowDown' }), null);
});

test('describeBlockMove announces a 1-based position with the total', () => {
	assert.equal(describeBlockMove(0, 4), 'Block moved to position 1 of 4');
	assert.equal(describeBlockMove(3, 4), 'Block moved to position 4 of 4');
});
