export const EDITOR_JS_EDITABLE_SELECTOR = '[contenteditable="true"]';

type ClosestEventTarget = EventTarget & {
	closest?: (selector: string) => Element | null;
};

/**
 * Editor.js updates its toolbar during `touchstart`. Mobile Safari can then
 * omit the compatibility click that would normally focus the contenteditable.
 * Resolve only genuine touch releases inside this editor so the caller can
 * restore focus synchronously while the user gesture is still active.
 */
export const getEditorJsTouchFocusTarget = (
	holder: HTMLElement,
	target: EventTarget | null,
	pointerType: string,
	activeElement: Element | null
): HTMLElement | null => {
	if (pointerType !== 'touch' || !target || typeof (target as ClosestEventTarget).closest !== 'function') return null;

	const editable = (target as ClosestEventTarget).closest?.(EDITOR_JS_EDITABLE_SELECTOR) as HTMLElement | null;
	if (!editable || !holder.contains(editable) || activeElement === editable) return null;

	return editable;
};
