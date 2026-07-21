// Editor.js block drag/drop + keyboard reordering (claude-todo/14).
//
// Everything routes through the ONE public mutation Editor.js gives us —
// `editor.blocks.move(toIndex, fromIndex)` — called exactly once per completed
// gesture. That single call fires Editor.js's own onChange, which flows down
// LongTextEditor's ordered save queue and lands in Thingtime's undo timeline
// as ONE history event: no per-pointer-move noise, ids/data/tunes untouched.
//
// Interactions installed by watchEditorJsBlockReorder:
//  - Desktop: pointer drag starting from the six-dot settings grip. A plain
//    click still opens block settings (drag only arms past a movement
//    threshold); a drop indicator line previews the insertion point; the
//    nearest scroll container autoscrolls near its edges.
//  - Mobile: long-press (400ms) on the grip enters the same drag. A short tap
//    opens settings; a press that moves early is treated as scroll and never
//    hijacked.
//  - Keyboard: Alt+Shift+ArrowUp / Alt+Shift+ArrowDown moves the active block,
//    keeps the caret in it, and announces the new position via a visually
//    hidden aria-live region.
//  - Escape / pointercancel abort an in-flight drag without touching data.
// Read-only mode installs nothing that mutates (guarded per event).

const SETTINGS_GRIP_SELECTOR = '.ce-toolbar__settings-btn';
const BLOCK_SELECTOR = '.ce-block';
const DRAG_START_THRESHOLD_PX = 5;
const LONG_PRESS_MS = 400;
const AUTOSCROLL_EDGE_PX = 48;
const AUTOSCROLL_MAX_STEP_PX = 24;

export type BlockRect = { top: number; bottom: number };

// Map a pointer's Y to the insertion boundary index (0..blocks.length): the
// gap ABOVE block i wins while the pointer is in the top half of block i.
export const computeDropIndex = (blockRects: BlockRect[], pointerY: number): number => {
	for (let i = 0; i < blockRects.length; i++) {
		const rect = blockRects[i];
		const middle = rect.top + (rect.bottom - rect.top) / 2;
		if (pointerY < middle) return i;
	}
	return blockRects.length;
};

// Convert an insertion boundary into a blocks.move target. Returns null for
// every no-op (dropping a block back onto itself) so first/last no-ops never
// call move and never create history.
export const resolveMoveTarget = (dropIndex: number, fromIndex: number): number | null => {
	// removing the dragged block first shifts later boundaries down by one
	const target = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
	return target === fromIndex ? null : target;
};

// Signed autoscroll step for a pointer near the top/bottom of a scroll
// viewport — proportional to edge proximity, 0 in the middle.
export const getAutoscrollStep = (
	pointerY: number,
	viewportTop: number,
	viewportBottom: number,
	edge: number = AUTOSCROLL_EDGE_PX,
	maxStep: number = AUTOSCROLL_MAX_STEP_PX
): number => {
	const fromTop = pointerY - viewportTop;
	const fromBottom = viewportBottom - pointerY;
	if (fromTop < edge) return -Math.ceil(((edge - Math.max(fromTop, 0)) / edge) * maxStep);
	if (fromBottom < edge) return Math.ceil(((edge - Math.max(fromBottom, 0)) / edge) * maxStep);
	return 0;
};

export const describeBlockMove = (toIndex: number, blockCount: number): string =>
	`Block moved to position ${toIndex + 1} of ${blockCount}`;

// Keyboard contract, exported for tests: Alt+Shift+Arrow, chosen because it is
// free in contenteditable (Alt+Shift+vertical-arrow selection is vanishingly
// rare) while Cmd/Ctrl+Shift+Arrow are real selection shortcuts.
export const isBlockMoveKeydown = (
	event: Pick<KeyboardEvent, 'key' | 'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey'>
): 'up' | 'down' | null => {
	if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return null;
	if (event.key === 'ArrowUp') return 'up';
	if (event.key === 'ArrowDown') return 'down';
	return null;
};

type EditorLike = {
	blocks: {
		move: (toIndex: number, fromIndex?: number) => void;
		getBlocksCount: () => number;
		getCurrentBlockIndex: () => number;
	};
	caret: { setToBlock: (index: number, position?: string) => boolean };
};

export type WatchEditorJsBlockReorderOptions = {
	getEditor: () => EditorLike | null;
	isReadOnly: () => boolean;
};

const findScrollParent = (start: HTMLElement): HTMLElement | null => {
	let node: HTMLElement | null = start;
	while (node && node !== document.body) {
		const style = window.getComputedStyle(node);
		if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
		node = node.parentElement;
	}
	return null;
};

export const watchEditorJsBlockReorder = (holder: HTMLElement, options: WatchEditorJsBlockReorderOptions): (() => void) => {
	let disposed = false;

	// —— aria-live announcer (shared by keyboard + pointer moves) ——
	const announcer = document.createElement('div');
	announcer.setAttribute('role', 'status');
	announcer.setAttribute('aria-live', 'polite');
	Object.assign(announcer.style, {
		position: 'absolute',
		width: '1px',
		height: '1px',
		margin: '-1px',
		overflow: 'hidden',
		clipPath: 'inset(50%)',
		whiteSpace: 'nowrap'
	} as CSSStyleDeclaration);
	holder.appendChild(announcer);
	const announce = (message: string) => {
		// re-set even when identical so repeated moves re-announce
		announcer.textContent = '';
		announcer.textContent = message;
	};

	const moveBlock = (fromIndex: number, toIndex: number): boolean => {
		const editor = options.getEditor();
		if (!editor) return false;
		const count = editor.blocks.getBlocksCount();
		if (fromIndex < 0 || toIndex < 0 || fromIndex >= count || toIndex >= count || fromIndex === toIndex) return false;
		editor.blocks.move(toIndex, fromIndex);
		// keep focus with the moved block (spec: caret stays in the block)
		try {
			editor.caret.setToBlock(toIndex, 'start');
		} catch {
			// caret restoration is best-effort; the move itself already landed
		}
		announce(describeBlockMove(toIndex, count));
		return true;
	};

	// —— keyboard moves ——
	const onKeydown = (event: KeyboardEvent) => {
		if (options.isReadOnly()) return;
		const direction = isBlockMoveKeydown(event);
		if (!direction) return;
		const editor = options.getEditor();
		if (!editor) return;
		const fromIndex = editor.blocks.getCurrentBlockIndex();
		if (fromIndex < 0) return;
		const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
		const count = editor.blocks.getBlocksCount();
		event.preventDefault();
		event.stopPropagation();
		// first/last no-ops: swallow the key (predictable) but never call move
		if (toIndex < 0 || toIndex >= count) return;
		moveBlock(fromIndex, toIndex);
	};
	holder.addEventListener('keydown', onKeydown, true);

	// —— pointer drag from the settings grip ——
	type DragState = {
		pointerId: number;
		grip: HTMLElement;
		fromIndex: number;
		startX: number;
		startY: number;
		active: boolean; // armed after threshold / long-press
		dropIndex: number | null;
		longPressTimer: ReturnType<typeof setTimeout> | undefined;
		isTouch: boolean;
	};
	let drag: DragState | null = null;
	let indicator: HTMLDivElement | null = null;
	let autoscrollTimer: ReturnType<typeof setInterval> | undefined;
	let suppressNextClick = false;

	const blockElements = (): HTMLElement[] => Array.from(holder.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));

	const blockIndexAtY = (y: number): number => {
		const rects = blockElements().map((el) => el.getBoundingClientRect());
		for (let i = 0; i < rects.length; i++) {
			if (y >= rects[i].top && y <= rects[i].bottom) return i;
		}
		return -1;
	};

	const ensureIndicator = (): HTMLDivElement => {
		if (indicator) return indicator;
		indicator = document.createElement('div');
		Object.assign(indicator.style, {
			position: 'fixed',
			height: '3px',
			borderRadius: '2px',
			background: 'var(--tt-accent, hotpink)',
			boxShadow: '0 0 0 1px var(--tt-card, #ffffff)',
			zIndex: '9999',
			pointerEvents: 'none'
		} as CSSStyleDeclaration);
		document.body.appendChild(indicator);
		return indicator;
	};

	const positionIndicator = (dropIndex: number) => {
		const blocks = blockElements();
		if (!blocks.length) return;
		const line = ensureIndicator();
		const reference = dropIndex < blocks.length ? blocks[dropIndex].getBoundingClientRect() : blocks[blocks.length - 1].getBoundingClientRect();
		const y = dropIndex < blocks.length ? reference.top : reference.bottom;
		line.style.left = `${reference.left}px`;
		line.style.width = `${reference.width}px`;
		line.style.top = `${y - 1.5}px`;
	};

	const clearIndicator = () => {
		indicator?.remove();
		indicator = null;
	};

	const stopAutoscroll = () => {
		clearInterval(autoscrollTimer);
		autoscrollTimer = undefined;
	};

	const endDrag = (commit: boolean) => {
		const state = drag;
		drag = null;
		stopAutoscroll();
		clearIndicator();
		document.removeEventListener('pointermove', onPointerMove, true);
		document.removeEventListener('pointerup', onPointerUp, true);
		document.removeEventListener('pointercancel', onPointerCancel, true);
		document.removeEventListener('keydown', onDragKeydown, true);
		if (!state) return;
		clearTimeout(state.longPressTimer);
		document.body.style.userSelect = '';
		try {
			state.grip.releasePointerCapture(state.pointerId);
		} catch {
			// capture may already be gone
		}
		if (!state.active) return;
		// a real drag happened: the trailing click must not open block settings
		suppressNextClick = true;
		setTimeout(() => {
			suppressNextClick = false;
		}, 300);
		if (commit && state.dropIndex !== null) {
			const target = resolveMoveTarget(state.dropIndex, state.fromIndex);
			if (target !== null) moveBlock(state.fromIndex, target);
		}
	};

	const armDrag = (state: DragState) => {
		state.active = true;
		clearTimeout(state.longPressTimer);
		document.body.style.userSelect = 'none';
		try {
			state.grip.setPointerCapture(state.pointerId);
		} catch {
			// pointer capture is an enhancement, not a requirement
		}
		// autoscroll loop: reads the latest pointer Y captured by onPointerMove
		autoscrollTimer = setInterval(() => {
			if (!drag?.active) return;
			const scroller = findScrollParent(holder);
			const top = scroller ? scroller.getBoundingClientRect().top : 0;
			const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
			const step = getAutoscrollStep(lastPointerY, top, bottom);
			if (!step) return;
			if (scroller) scroller.scrollTop += step;
			else window.scrollBy(0, step);
			// re-aim the indicator after scrolling shifts the blocks
			if (drag.dropIndex !== null) positionIndicator(drag.dropIndex);
		}, 50);
	};

	let lastPointerY = 0;

	const onPointerMove = (event: PointerEvent) => {
		const state = drag;
		if (!state || event.pointerId !== state.pointerId) return;
		lastPointerY = event.clientY;

		if (!state.active) {
			const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
			if (state.isTouch) {
				// early movement on touch = the user is scrolling, not long-pressing
				if (moved > DRAG_START_THRESHOLD_PX * 2) endDrag(false);
				return;
			}
			if (moved <= DRAG_START_THRESHOLD_PX) return;
			armDrag(state);
		}

		event.preventDefault();
		const rects: BlockRect[] = blockElements().map((el) => {
			const rect = el.getBoundingClientRect();
			return { top: rect.top, bottom: rect.bottom };
		});
		state.dropIndex = computeDropIndex(rects, event.clientY);
		positionIndicator(state.dropIndex);
	};

	const onPointerUp = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (drag.active) event.preventDefault();
		endDrag(true);
	};

	const onPointerCancel = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		endDrag(false);
	};

	const onDragKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && drag) {
			event.preventDefault();
			event.stopPropagation();
			endDrag(false);
		}
	};

	const onPointerDown = (event: PointerEvent) => {
		if (options.isReadOnly() || drag) return;
		const grip = (event.target as HTMLElement | null)?.closest?.(SETTINGS_GRIP_SELECTOR) as HTMLElement | null;
		if (!grip || !holder.contains(grip)) return;

		// the grip belongs to whichever block the toolbar is aligned with —
		// resolve it by geometry (robust across Editor.js toolbar positioning),
		// falling back to the editor's own notion of the current block
		const gripRect = grip.getBoundingClientRect();
		let fromIndex = blockIndexAtY(gripRect.top + gripRect.height / 2);
		if (fromIndex < 0) fromIndex = options.getEditor()?.blocks.getCurrentBlockIndex() ?? -1;
		if (fromIndex < 0) return;

		const isTouch = event.pointerType === 'touch';
		const state: DragState = {
			pointerId: event.pointerId,
			grip,
			fromIndex,
			startX: event.clientX,
			startY: event.clientY,
			active: false,
			dropIndex: null,
			longPressTimer: undefined,
			isTouch
		};
		drag = state;
		lastPointerY = event.clientY;
		if (isTouch) {
			state.longPressTimer = setTimeout(() => {
				if (drag === state && !state.active) armDrag(state);
			}, LONG_PRESS_MS);
		}
		document.addEventListener('pointermove', onPointerMove, true);
		document.addEventListener('pointerup', onPointerUp, true);
		document.addEventListener('pointercancel', onPointerCancel, true);
		document.addEventListener('keydown', onDragKeydown, true);
	};

	// after a completed drag, swallow the click that would open block settings
	const onClickCapture = (event: MouseEvent) => {
		if (!suppressNextClick) return;
		const grip = (event.target as HTMLElement | null)?.closest?.(SETTINGS_GRIP_SELECTOR);
		if (!grip) return;
		suppressNextClick = false;
		event.preventDefault();
		event.stopPropagation();
	};

	// the grip is not a scroll surface: opting it out of browser touch
	// gestures lets long-press dragging work without ever touching page
	// scroll started anywhere else
	const styleGrips = () => {
		holder.querySelectorAll<HTMLElement>(SETTINGS_GRIP_SELECTOR).forEach((el) => {
			el.style.touchAction = 'none';
		});
	};
	const gripObserver = new MutationObserver(styleGrips);
	gripObserver.observe(holder, { childList: true, subtree: true });
	styleGrips();

	holder.addEventListener('pointerdown', onPointerDown, true);
	holder.addEventListener('click', onClickCapture, true);

	return () => {
		if (disposed) return;
		disposed = true;
		endDrag(false);
		gripObserver.disconnect();
		holder.removeEventListener('pointerdown', onPointerDown, true);
		holder.removeEventListener('click', onClickCapture, true);
		holder.removeEventListener('keydown', onKeydown, true);
		announcer.remove();
	};
};
