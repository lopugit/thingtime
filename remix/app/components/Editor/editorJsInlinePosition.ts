import {
	editorOverlayBounds,
	editorTextObstacles,
	moveEditorOverlay,
	placeEditorSelectionToolbar,
	setEditorOverlayStyle
} from './editorOverlayLayout';

export const inlineToolbarPosition = (
	selection: { left: number; top: number; width: number },
	toolbar: { width: number; height: number },
	viewport: { left: number; top: number; width: number }
) => ({
	left: Math.max(
		viewport.left + 8,
		Math.min(selection.left + selection.width / 2 - toolbar.width / 2, viewport.left + viewport.width - toolbar.width - 8)
	),
	top: Math.max(viewport.top + 8, selection.top - toolbar.height - 12)
});

/** Selection gets the closest available space; secondary chrome works around it. */
export const layoutEditorJsInlineToolbar = (holder: HTMLElement) => {
	const selection = window.getSelection();
	if (!selection?.rangeCount || selection.isCollapsed || !holder.contains(selection.anchorNode)) return;
	const toolbar = holder.querySelector<HTMLElement>('.ce-inline-toolbar');
	const panel = toolbar?.querySelector<HTMLElement>('.ce-popover--inline.ce-popover--opened > .ce-popover__container');
	if (!toolbar || !panel) return;
	const range = selection.getRangeAt(0),
		rect = range.getBoundingClientRect();
	const bounds = editorOverlayBounds(holder);
	setEditorOverlayStyle(panel, { maxWidth: `${bounds.width}px`, minWidth: '0px', height: 'auto', bottom: 'auto', minHeight: '46px' });
	const items = panel.querySelector<HTMLElement>(':scope > .ce-popover__items');
	if (items) {
		setEditorOverlayStyle(items, { flexWrap: 'wrap', flexShrink: '0' });
	}
	// Position the container itself; transformed builder ancestors still use their own containing block.
	const old = panel.getBoundingClientRect();
	const obstacles = editorTextObstacles(holder);

	const pos = placeEditorSelectionToolbar(old, rect, bounds, obstacles);
	moveEditorOverlay(panel, pos, toolbar);
	return pos;
};

/** Follow the selection and visual viewport, including keyboard pans and nested scrolling. */
export const watchEditorJsInlinePosition = (holder: HTMLElement): (() => void) => {
	let frame = 0;
	const sync = () => {
		frame = 0;
		layoutEditorJsInlineToolbar(holder);
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(sync);
	};
	const observer = new MutationObserver(schedule);
	observer.observe(holder, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
	document.addEventListener('selectionchange', schedule);
	window.addEventListener('scroll', schedule, true);
	window.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('scroll', schedule);
	return () => {
		observer.disconnect();
		cancelAnimationFrame(frame);
		document.removeEventListener('selectionchange', schedule);
		window.removeEventListener('scroll', schedule, true);
		window.removeEventListener('resize', schedule);
		window.visualViewport?.removeEventListener('resize', schedule);
		window.visualViewport?.removeEventListener('scroll', schedule);
	};
};
