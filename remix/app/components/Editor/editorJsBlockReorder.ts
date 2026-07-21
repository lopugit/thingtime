// Pure planning logic for Editor.js block reordering (drag/drop, long-press,
// and keyboard moves). Everything DOM-flavoured stays in the adapter
// (editorJsBlockDragDrop.ts); this module is plain math so node:test can cover
// index changes, no-ops, gesture thresholds, and cancellation exhaustively.

export type BlockRect = { top: number; height: number };

// How far a mouse/pen pointer must travel from the grip before a drag starts
// (below this a press is still a click that opens block settings).
export const POINTER_DRAG_THRESHOLD_PX = 4;
// Touch: hold this long without wandering to start reordering…
export const TOUCH_LONG_PRESS_MS = 350;
// …and wandering further than this before the hold elapses means the user is
// scrolling, so the gesture cancels and native scroll keeps working.
export const TOUCH_SLOP_PX = 8;
// Viewport band (top/bottom) where dragging autoscrolls, and its top speed.
export const AUTOSCROLL_EDGE_PX = 48;
export const AUTOSCROLL_MAX_STEP_PX = 24;

// The insertion slot (0..rects.length) the pointer is over: before the first
// block whose midpoint is below the pointer, else after the last block.
export const resolveDropSlot = (pointerY: number, rects: BlockRect[]): number => {
	for (let i = 0; i < rects.length; i++) {
		if (pointerY < rects[i].top + rects[i].height / 2) return i;
	}
	return rects.length;
};

// Convert an insertion slot to the blocks.move() target index. Removing the
// dragged block first shifts every later slot down by one.
export const slotToMoveTarget = (slot: number, fromIndex: number): number => (slot > fromIndex ? slot - 1 : slot);

export type PointerMovePlan = {
	slot: number;
	toIndex: number;
	changed: boolean;
	// y (same coordinate space as the rects) where the drop indicator sits
	indicatorY: number;
};

export const planPointerMove = (pointerY: number, rects: BlockRect[], fromIndex: number): PointerMovePlan => {
	const slot = resolveDropSlot(pointerY, rects);
	const toIndex = slotToMoveTarget(slot, fromIndex);
	const indicatorY = slot === 0 ? (rects[0]?.top ?? 0) : rects[slot - 1].top + rects[slot - 1].height;
	return { slot, toIndex, changed: toIndex !== fromIndex, indicatorY };
};

// ————— press state machine (shared by mouse/pen and touch) —————

export type PressPointerType = 'mouse' | 'pen' | 'touch';

export type PressState = {
	pointerType: PressPointerType;
	startX: number;
	startY: number;
	startedAt: number;
};

export type PressEvaluation = 'pending' | 'start-drag' | 'cancel';

// Decide what a tracked press has become. Mouse/pen: crossing the drag
// threshold starts the drag (any earlier release is a plain click). Touch:
// wandering past the slop before the long-press elapses is a scroll (cancel);
// staying put until it elapses starts the drag.
export const evaluatePress = (press: PressState, x: number, y: number, now: number): PressEvaluation => {
	const distance = Math.hypot(x - press.startX, y - press.startY);

	if (press.pointerType === 'touch') {
		if (distance > TOUCH_SLOP_PX && now - press.startedAt < TOUCH_LONG_PRESS_MS) return 'cancel';
		if (now - press.startedAt >= TOUCH_LONG_PRESS_MS) return 'start-drag';
		return 'pending';
	}

	return distance >= POINTER_DRAG_THRESHOLD_PX ? 'start-drag' : 'pending';
};

// ————— keyboard moves —————

// Target index for moving a block one step, or null when the move is a no-op
// (already at the boundary) — boundary no-ops must not create history.
export const planKeyboardMove = (fromIndex: number, direction: -1 | 1, blockCount: number): number | null => {
	if (fromIndex < 0 || fromIndex >= blockCount) return null;
	const toIndex = fromIndex + direction;
	if (toIndex < 0 || toIndex >= blockCount) return null;
	return toIndex;
};

// ————— autoscroll —————

// Signed scroll step for a pointer near the viewport edges; 0 in the middle.
// Speed ramps linearly the deeper the pointer is into the edge band.
export const autoscrollStep = (
	clientY: number,
	viewportHeight: number,
	edge: number = AUTOSCROLL_EDGE_PX,
	maxStep: number = AUTOSCROLL_MAX_STEP_PX
): number => {
	if (clientY < edge) return -Math.ceil(maxStep * ((edge - Math.max(clientY, 0)) / edge));
	const fromBottom = viewportHeight - clientY;
	if (fromBottom < edge) return Math.ceil(maxStep * ((edge - Math.max(fromBottom, 0)) / edge));
	return 0;
};

// ————— accessibility —————

export const describeBlockMove = (toIndex: number, blockCount: number): string =>
	`Block moved to position ${toIndex + 1} of ${blockCount}`;
