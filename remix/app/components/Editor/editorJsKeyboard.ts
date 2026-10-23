const EDITOR_JS_TEXT_FIELD_SELECTOR = '[contenteditable="true"].cdx-input';

export const EDITOR_JS_NATIVE_TEXT_FIELD_KEYS = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

const editorJsNativeTextFieldKeys = new Set<string>(EDITOR_JS_NATIVE_TEXT_FIELD_KEYS);

type ClosestEventTarget = EventTarget & {
	closest?: (selector: string) => unknown;
};

const backwardBoundaryKeys = new Set<string>(['Backspace', 'ArrowLeft', 'ArrowUp']);

const getEditorJsTextField = (target: EventTarget | null): unknown => {
	const closestTarget = target as ClosestEventTarget | null;
	return typeof closestTarget?.closest === 'function' ? closestTarget.closest(EDITOR_JS_TEXT_FIELD_SELECTOR) : null;
};

export const shouldPreserveEditorJsTextFieldKeydown = (event: Pick<KeyboardEvent, 'key' | 'target'>): boolean => {
	if (!editorJsNativeTextFieldKeys.has(event.key)) return false;
	return Boolean(getEditorJsTextField(event.target));
};

const nodeBoundaryLength = (node: Node): number => (node.nodeType === Node.TEXT_NODE ? node.textContent?.length || 0 : node.childNodes.length);

const isAtTrueTextFieldBoundary = (field: HTMLElement, event: KeyboardEvent): boolean => {
	if (typeof window === 'undefined') return false;
	const selection = window.getSelection();
	const focusNode = selection?.focusNode;
	if (!selection?.isCollapsed || !focusNode || (focusNode !== field && !field.contains(focusNode))) return false;

	const atStart = backwardBoundaryKeys.has(event.key);
	let node: Node = focusNode;
	let offset = selection.focusOffset;

	while (true) {
		if (offset !== (atStart ? 0 : nodeBoundaryLength(node))) return false;
		if (node === field) return true;

		const parent = node.parentNode;
		if (!parent) return false;
		const siblingIndex = Array.prototype.indexOf.call(parent.childNodes, node) as number;
		if (siblingIndex !== (atStart ? 0 : parent.childNodes.length - 1)) return false;

		node = parent;
		offset = atStart ? 0 : nodeBoundaryLength(parent);
	}
};

export const getEditorJsArrowMovement = (
	event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'altKey' | 'ctrlKey'>
): { alter: 'extend' | 'move'; direction: 'backward' | 'forward' | 'left' | 'right'; granularity: string } => {
	const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
	const direction = horizontal ? (event.key === 'ArrowLeft' ? 'left' : 'right') : event.key === 'ArrowUp' ? 'backward' : 'forward';
	let granularity = horizontal ? 'character' : 'line';
	if (event.metaKey) granularity = horizontal ? 'lineboundary' : 'documentboundary';
	else if (event.altKey || event.ctrlKey) granularity = horizontal ? 'word' : 'paragraph';

	return { alter: event.shiftKey ? 'extend' : 'move', direction, granularity };
};

/**
 * Editor.js treats multiline tool fields as a series of block inputs. That
 * makes an empty internal line look like a block boundary, so its block-level
 * handler steals native deletion and cursor navigation. Stop the event before
 * it reaches that handler, preserving native deletion and Selection movement.
 */
export const preserveEditorJsTextFieldKeydown = (event: KeyboardEvent): void => {
	if (!shouldPreserveEditorJsTextFieldKeydown(event)) return;

	// Let IME candidate navigation and tool-owned keyboard handlers finish
	// without moving the document selection a second time, while still keeping
	// Editor.js's outer block-navigation listener out of the event path.
	if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) {
		event.stopPropagation();
		return;
	}
	const field = getEditorJsTextField(event.target);
	if (typeof HTMLElement !== 'undefined' && field instanceof HTMLElement && isAtTrueTextFieldBoundary(field, event)) return;

	event.stopPropagation();
	if (!event.key.startsWith('Arrow')) return;

	// Chrome performs contenteditable arrow navigation while the key event
	// bubbles. Because the Editor.js block handler also lives in that path, we
	// reproduce the native Selection movement before stopping the event.
	if (typeof window === 'undefined') return;

	const selection = window.getSelection();
	if (!selection || typeof selection.modify !== 'function') return;
	event.preventDefault();

	const movement = getEditorJsArrowMovement(event);
	selection.modify(movement.alter, movement.direction, movement.granularity);
};

/**
 * Bind at the textbox itself so the event reaches the native control and any
 * tool-owned listener before we stop Editor.js's outer `.ce-block` listener.
 * The observer covers blocks and captions that tools add after initial render.
 */
export const watchEditorJsTextFieldKeydowns = (holder: HTMLElement): (() => void) => {
	const guardedFields = new Set<HTMLElement>();

	const guard = (element: Element) => {
		if (!(element instanceof HTMLElement) || guardedFields.has(element)) return;
		element.addEventListener('keydown', preserveEditorJsTextFieldKeydown);
		guardedFields.add(element);
	};

	const guardFieldsWithin = (root: Element) => {
		if (root.matches(EDITOR_JS_TEXT_FIELD_SELECTOR)) guard(root);
		root.querySelectorAll(EDITOR_JS_TEXT_FIELD_SELECTOR).forEach(guard);
	};

	guardFieldsWithin(holder);

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (node instanceof Element) guardFieldsWithin(node);
			}
		}

		guardedFields.forEach((field) => {
			if (holder.contains(field)) return;
			field.removeEventListener('keydown', preserveEditorJsTextFieldKeydown);
			guardedFields.delete(field);
		});
	});
	observer.observe(holder, { childList: true, subtree: true });

	return () => {
		observer.disconnect();
		guardedFields.forEach((field) => field.removeEventListener('keydown', preserveEditorJsTextFieldKeydown));
		guardedFields.clear();
	};
};
