// DOM adapter for Editor.js block reordering: pointer drag + touch long-press
// from the six-dot settings grip, Alt+ArrowUp/Down keyboard moves, a drop
// indicator, viewport autoscroll, and aria-live announcements. All index and
// gesture decisions live in editorJsBlockReorder.ts (pure, unit-tested); this
// file only observes events and calls Editor.js's public blocks.move() API —
// one move per completed gesture, so one history event.

import {
	autoscrollStep,
	describeBlockMove,
	evaluatePress,
	planKeyboardMove,
	planPointerMove,
	TOUCH_LONG_PRESS_MS
} from './editorJsBlockReorder';
import type { BlockRect, PressState } from './editorJsBlockReorder';

const SETTINGS_GRIP_SELECTOR = '.ce-toolbar__settings-btn';
const BLOCK_SELECTOR = '.ce-block';

type EditorLike = {
	blocks?: {
		move?: (toIndex: number, fromIndex?: number) => void;
		getBlocksCount?: () => number;
		getCurrentBlockIndex?: () => number;
	};
	caret?: { setToBlock?: (index: number, position?: string) => void };
	readOnly?: { isEnabled?: boolean };
};

export type WatchEditorJsBlockReorderOptions = {
	// called after a completed move so the host can settle a save even if
	// Editor.js does not emit onChange for blocks.move()
	onMoved?: () => void;
};

const blockRects = (holder: HTMLElement): { rects: BlockRect[]; elements: HTMLElement[] } => {
	const elements = Array.from(holder.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
	return {
		elements,
		rects: elements.map((el) => {
			const rect = el.getBoundingClientRect();
			return { top: rect.top, height: rect.height };
		})
	};
};

export const watchEditorJsBlockReorder = (
	holder: HTMLElement,
	getEditor: () => EditorLike | null,
	options: WatchEditorJsBlockReorderOptions = {}
): (() => void) => {
	if (typeof window === 'undefined') return () => {};

	// ————— aria-live announcements (keyboard + drag share it) —————
	const liveRegion = document.createElement('div');
	liveRegion.setAttribute('role', 'status');
	liveRegion.setAttribute('aria-live', 'polite');
	Object.assign(liveRegion.style, {
		position: 'absolute',
		width: '1px',
		height: '1px',
		overflow: 'hidden',
		clipPath: 'inset(50%)',
		whiteSpace: 'nowrap'
	} satisfies Partial<CSSStyleDeclaration>);
	holder.appendChild(liveRegion);
	const announce = (text: string) => {
		liveRegion.textContent = '';
		liveRegion.textContent = text;
	};

	const editorIsReadOnly = () => Boolean(getEditor()?.readOnly?.isEnabled);

	const moveBlock = (fromIndex: number, toIndex: number): boolean => {
		const editor = getEditor();
		if (!editor?.blocks?.move) return false;
		try {
			editor.blocks.move(toIndex, fromIndex);
			const count = editor.blocks.getBlocksCount?.() ?? 0;
			announce(describeBlockMove(toIndex, count));
			options.onMoved?.();
			return true;
		} catch {
			return false;
		}
	};

	// ————— keyboard: Alt+ArrowUp / Alt+ArrowDown moves the current block —————
	const onKeydown = (event: KeyboardEvent) => {
		if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
		// 'Up'/'Down' are the legacy key names (old WebKit/Edge and some
		// automation layers); modern browsers send 'ArrowUp'/'ArrowDown'
		const up = event.key === 'ArrowUp' || event.key === 'Up';
		const down = event.key === 'ArrowDown' || event.key === 'Down';
		if (!up && !down) return;
		if (editorIsReadOnly()) return;
		const editor = getEditor();
		const fromIndex = editor?.blocks?.getCurrentBlockIndex?.() ?? -1;
		const count = editor?.blocks?.getBlocksCount?.() ?? 0;
		const toIndex = planKeyboardMove(fromIndex, up ? -1 : 1, count);
		if (toIndex === null) return; // boundary: no move, no history
		event.preventDefault();
		event.stopPropagation();
		if (moveBlock(fromIndex, toIndex)) {
			try {
				editor?.caret?.setToBlock?.(toIndex, 'start');
			} catch {
				// caret restoration is best-effort; the move already succeeded
			}
		}
	};

	// ————— pointer drag / touch long-press from the settings grip —————
	let press: (PressState & { grip: HTMLElement }) | null = null;
	let drag: { fromIndex: number; lastClientY: number } | null = null;
	// a click fired by releasing a drag over the grip arrives within a tick of
	// pointerup; suppress only that window so a later plain click still opens
	// block settings normally
	let suppressClicksUntil = 0;
	let longPressTimer: ReturnType<typeof setTimeout> | undefined;
	let autoscrollFrame: number | undefined;

	const indicator = document.createElement('div');
	Object.assign(indicator.style, {
		position: 'absolute',
		left: '0',
		right: '0',
		height: '2px',
		background: 'var(--tt-accent, hotpink)',
		borderRadius: '1px',
		pointerEvents: 'none',
		display: 'none',
		zIndex: '10'
	} satisfies Partial<CSSStyleDeclaration>);

	const positionIndicator = (viewportY: number) => {
		const holderRect = holder.getBoundingClientRect();
		indicator.style.top = `${viewportY - holderRect.top}px`;
		indicator.style.display = 'block';
	};

	const stopAutoscroll = () => {
		if (autoscrollFrame !== undefined) cancelAnimationFrame(autoscrollFrame);
		autoscrollFrame = undefined;
	};

	const runAutoscroll = () => {
		stopAutoscroll();
		const tick = () => {
			if (!drag) return;
			const step = autoscrollStep(drag.lastClientY, window.innerHeight);
			if (step !== 0) {
				window.scrollBy(0, step);
				updateDrag(drag.lastClientY);
			}
			autoscrollFrame = requestAnimationFrame(tick);
		};
		autoscrollFrame = requestAnimationFrame(tick);
	};

	const clearGesture = () => {
		press = null;
		drag = null;
		clearTimeout(longPressTimer);
		stopAutoscroll();
		indicator.style.display = 'none';
		indicator.remove();
		window.removeEventListener('pointermove', onWindowPointerMove, true);
		window.removeEventListener('pointerup', onWindowPointerUp, true);
		window.removeEventListener('pointercancel', onWindowPointerCancel, true);
		window.removeEventListener('keydown', onWindowKeydownDuringDrag, true);
	};

	const updateDrag = (clientY: number) => {
		if (!drag) return;
		drag.lastClientY = clientY;
		const { rects } = blockRects(holder);
		if (!rects.length) return;
		const plan = planPointerMove(clientY, rects, drag.fromIndex);
		positionIndicator(plan.indicatorY);
	};

	const startDrag = (clientY: number) => {
		if (!press) return;
		const { rects } = blockRects(holder);
		if (!rects.length) return clearGesture();
		// the grip rides beside its block: the block whose vertical span contains
		// the grip's centre is the one being dragged
		const gripRect = press.grip.getBoundingClientRect();
		const gripCenterY = gripRect.top + gripRect.height / 2;
		let fromIndex = rects.findIndex((rect) => gripCenterY >= rect.top && gripCenterY < rect.top + rect.height);
		if (fromIndex < 0) fromIndex = getEditor()?.blocks?.getCurrentBlockIndex?.() ?? -1;
		if (fromIndex < 0) return clearGesture();

		drag = { fromIndex, lastClientY: clientY };
		holder.appendChild(indicator);
		updateDrag(clientY);
		runAutoscroll();
		window.addEventListener('keydown', onWindowKeydownDuringDrag, true);
	};

	const onWindowKeydownDuringDrag = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && drag) {
			event.preventDefault();
			event.stopPropagation();
			clearGesture();
		}
	};

	const onWindowPointerMove = (event: PointerEvent) => {
		if (drag) {
			event.preventDefault();
			updateDrag(event.clientY);
			return;
		}
		if (!press) return;
		const outcome = evaluatePress(press, event.clientX, event.clientY, Date.now());
		if (outcome === 'cancel') return clearGesture();
		if (outcome === 'start-drag') startDrag(event.clientY);
	};

	const onWindowPointerUp = (event: PointerEvent) => {
		if (!drag) return clearGesture(); // plain click → settings opens natively
		event.preventDefault();
		suppressClicksUntil = Date.now() + 350; // this release is a drop, not a settings click
		const { rects } = blockRects(holder);
		const plan = rects.length ? planPointerMove(event.clientY, rects, drag.fromIndex) : null;
		const { fromIndex } = drag;
		clearGesture();
		// first/last no-ops and drops on the source gap change nothing: no move,
		// no history event
		if (plan?.changed) moveBlock(fromIndex, plan.toIndex);
	};

	const onWindowPointerCancel = () => clearGesture();

	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0 && event.pointerType === 'mouse') return;
		const grip = (event.target as Element | null)?.closest?.(SETTINGS_GRIP_SELECTOR) as HTMLElement | null;
		if (!grip || !holder.contains(grip)) return;
		if (editorIsReadOnly()) return;

		clearGesture();
		press = {
			pointerType: (event.pointerType as PressState['pointerType']) || 'mouse',
			startX: event.clientX,
			startY: event.clientY,
			startedAt: Date.now(),
			grip
		};
		window.addEventListener('pointermove', onWindowPointerMove, true);
		window.addEventListener('pointerup', onWindowPointerUp, true);
		window.addEventListener('pointercancel', onWindowPointerCancel, true);
		if (press.pointerType === 'touch') {
			// touch emits no pointermove while the finger is still: promote the
			// held press to a drag on a timer (movement paths run through
			// evaluatePress above)
			longPressTimer = setTimeout(() => {
				if (press && !drag) startDrag(press.startY);
			}, TOUCH_LONG_PRESS_MS);
		}
	};

	// a drag that started on the grip must not ALSO open block settings when the
	// pointer is released over it
	const onClickCapture = (event: MouseEvent) => {
		if (Date.now() >= suppressClicksUntil) return;
		if ((event.target as Element | null)?.closest?.(SETTINGS_GRIP_SELECTOR)) {
			event.preventDefault();
			event.stopPropagation();
		}
	};

	holder.addEventListener('keydown', onKeydown, true);
	holder.addEventListener('pointerdown', onPointerDown, true);
	holder.addEventListener('click', onClickCapture, true);

	return () => {
		clearGesture();
		holder.removeEventListener('keydown', onKeydown, true);
		holder.removeEventListener('pointerdown', onPointerDown, true);
		holder.removeEventListener('click', onClickCapture, true);
		liveRegion.remove();
	};
};
