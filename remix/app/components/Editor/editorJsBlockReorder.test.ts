import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	autoscrollStep,
	describeBlockMove,
	evaluatePress,
	planKeyboardMove,
	planPointerMove,
	resolveDropSlot,
	slotToMoveTarget,
	POINTER_DRAG_THRESHOLD_PX,
	TOUCH_LONG_PRESS_MS,
	TOUCH_SLOP_PX
} from './editorJsBlockReorder.ts';

const rects = [
	{ top: 0, height: 40 },
	{ top: 40, height: 60 },
	{ top: 100, height: 20 }
];

test('resolveDropSlot picks the gap by block midpoints', () => {
	assert.equal(resolveDropSlot(-10, rects), 0);
	assert.equal(resolveDropSlot(19, rects), 0); // above first midpoint (20)
	assert.equal(resolveDropSlot(21, rects), 1);
	assert.equal(resolveDropSlot(69, rects), 1); // above second midpoint (70)
	assert.equal(resolveDropSlot(71, rects), 2);
	assert.equal(resolveDropSlot(109, rects), 2); // above third midpoint (110)
	assert.equal(resolveDropSlot(111, rects), 3);
	assert.equal(resolveDropSlot(50, []), 0);
});

test('slotToMoveTarget compensates for removing the dragged block', () => {
	// dragging block 0 to the gap after block 1 → target index 1
	assert.equal(slotToMoveTarget(2, 0), 1);
	// dragging block 2 to the top gap → target index 0
	assert.equal(slotToMoveTarget(0, 2), 0);
	// gap adjacent to the block itself → its own index
	assert.equal(slotToMoveTarget(1, 1), 1);
});

test('planPointerMove flags no-op targets (both adjacent gaps)', () => {
	// both the gap before and the gap after block 1 resolve to index 1
	assert.equal(planPointerMove(50, rects, 1).changed, false);
	assert.equal(planPointerMove(75, rects, 1).changed, false);
	// a real move
	const plan = planPointerMove(115, rects, 0);
	assert.deepEqual({ toIndex: plan.toIndex, changed: plan.changed }, { toIndex: 2, changed: true });
});

test('planPointerMove positions the indicator at the target gap', () => {
	assert.equal(planPointerMove(-5, rects, 1).indicatorY, 0); // top gap
	assert.equal(planPointerMove(50, rects, 0).indicatorY, 40); // after block 0
	assert.equal(planPointerMove(115, rects, 0).indicatorY, 120); // after last
});

test('mouse press becomes a drag only past the movement threshold', () => {
	const press = { pointerType: 'mouse' as const, startX: 10, startY: 10, startedAt: 0 };
	assert.equal(evaluatePress(press, 11, 11, 5), 'pending'); // a click
	assert.equal(evaluatePress(press, 10 + POINTER_DRAG_THRESHOLD_PX, 10, 5), 'start-drag');
});

test('touch press: scroll cancels, patient hold starts the drag', () => {
	const press = { pointerType: 'touch' as const, startX: 0, startY: 0, startedAt: 0 };
	// wandered early → user is scrolling
	assert.equal(evaluatePress(press, 0, TOUCH_SLOP_PX + 1, TOUCH_LONG_PRESS_MS - 100), 'cancel');
	// stayed within slop, not yet held long enough
	assert.equal(evaluatePress(press, 0, TOUCH_SLOP_PX - 2, TOUCH_LONG_PRESS_MS - 100), 'pending');
	// held long enough without wandering
	assert.equal(evaluatePress(press, 0, TOUCH_SLOP_PX - 2, TOUCH_LONG_PRESS_MS), 'start-drag');
});

test('planKeyboardMove moves within bounds and refuses boundary no-ops', () => {
	assert.equal(planKeyboardMove(1, -1, 3), 0);
	assert.equal(planKeyboardMove(1, 1, 3), 2);
	assert.equal(planKeyboardMove(0, -1, 3), null); // first block up → no history
	assert.equal(planKeyboardMove(2, 1, 3), null); // last block down → no history
	assert.equal(planKeyboardMove(-1, 1, 3), null);
	assert.equal(planKeyboardMove(3, 1, 3), null);
});

test('autoscrollStep ramps near edges and is quiet in the middle', () => {
	assert.equal(autoscrollStep(500, 1000), 0);
	assert.ok(autoscrollStep(10, 1000) < 0); // near top → scroll up
	assert.ok(autoscrollStep(990, 1000) > 0); // near bottom → scroll down
	// deeper into the band scrolls faster
	assert.ok(Math.abs(autoscrollStep(5, 1000)) > Math.abs(autoscrollStep(40, 1000)));
	// clamped: pointer past the edge never exceeds the max step
	assert.ok(Math.abs(autoscrollStep(-50, 1000)) <= 24);
});

test('describeBlockMove announces a human position', () => {
	assert.equal(describeBlockMove(0, 4), 'Block moved to position 1 of 4');
	assert.equal(describeBlockMove(3, 4), 'Block moved to position 4 of 4');
});
