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

/** Follow the selection and visual viewport, including keyboard pans and nested scrolling. */
export const watchEditorJsInlinePosition = (holder: HTMLElement): (() => void) => {
	let frame = 0;
	const sync = () => {
		frame = 0;
		const selection = window.getSelection();
		if (!selection?.rangeCount || selection.isCollapsed || !holder.contains(selection.anchorNode)) return;
		const toolbar = holder.querySelector<HTMLElement>('.ce-inline-toolbar');
		const panel = toolbar?.querySelector<HTMLElement>('.ce-popover--inline.ce-popover--opened > .ce-popover__container');
		if (!toolbar || !panel) return;
		const range = selection.getRangeAt(0),
			rect = range.getBoundingClientRect();
		const vv = window.visualViewport;
		panel.style.maxWidth = `${(vv?.width || window.innerWidth) - 16}px`;
		panel.style.minWidth = '0';
		panel.style.height = 'auto';
		panel.style.bottom = 'auto';
		panel.style.minHeight = '46px';
		const items = panel.querySelector<HTMLElement>(':scope > .ce-popover__items');
		if (items) {
			items.style.flexWrap = 'wrap';
			items.style.flexShrink = '0';
		}
		// Position the container itself; transformed builder ancestors still use their own containing block.
		const old = panel.getBoundingClientRect();
		const pos = inlineToolbarPosition(
			rect,
			{ width: old.width, height: old.height },
			{ left: vv?.offsetLeft || 0, top: vv?.offsetTop || 0, width: vv?.width || window.innerWidth }
		);
		const left = parseFloat(toolbar.style.left) || 0,
			top = parseFloat(toolbar.style.top) || 0;
		const nextLeft = `${left + pos.left - old.left}px`,
			nextTop = `${top + pos.top - old.top}px`;
		if (Math.abs(pos.left - old.left) > 0.5) toolbar.style.left = nextLeft;
		if (Math.abs(pos.top - old.top) > 0.5) toolbar.style.top = nextTop;
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
