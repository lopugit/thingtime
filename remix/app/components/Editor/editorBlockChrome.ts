import { layoutEditorJsInlineToolbar } from './editorJsInlinePosition';
import {
	editorOverlayBounds,
	editorTextObstacles,
	moveEditorOverlay,
	placeEditorOverlay,
	overlayIntersects,
	setEditorOverlayStyle
} from './editorOverlayLayout';
import { makeEditorPanelResizable } from './floatingEditorPanel';

/** Keep editing chrome outside the document's width and mirror it for right-aligned text. */
export const watchEditorBlockChrome = (holder: HTMLElement, getEditor: () => any) => {
	let frame = 0;
	const panels = new Map<HTMLElement, () => void>();
	const sync = () => {
		frame = 0;
		const editor = getEditor();
		const block = editor?.blocks.getBlockByIndex(editor.blocks.getCurrentBlockIndex());
		const field = block?.holder?.querySelector('[contenteditable],textarea');
		const align = field ? getComputedStyle(field).textAlign : 'left';
		holder.dataset.ttControlsSide = ['right', 'end'].includes(align) ? 'left' : 'right';
		const session = holder.closest<HTMLElement>('.tt-editor-session');
		if (session) session.dataset.ttControlsSide = holder.dataset.ttControlsSide;
		const bounds = editorOverlayBounds(holder);
		const obstacles = editorTextObstacles(holder);
		const inline = layoutEditorJsInlineToolbar(holder);
		if (inline) obstacles.push(inline);
		const chip = holder.closest('.ttBlockFrame')?.querySelector<HTMLElement>(':scope > .ttBlockChip');
		if (chip) {
			const frameRect = chip.parentElement!.getBoundingClientRect();
			setEditorOverlayStyle(chip, { width: 'max-content', maxWidth: `${bounds.width}px`, flexWrap: 'wrap' });
			const size = chip.getBoundingClientRect();
			const placement = placeEditorOverlay(size, { left: frameRect.left + 6, top: frameRect.top - size.height / 2 }, bounds, obstacles);
			moveEditorOverlay(chip, placement);
			obstacles.push(placement);
		}
		const history = session?.querySelector<HTMLElement>(':scope > .tt-editor-history-controls');
		const visible = bounds.width > 0 && bounds.height > 0 && overlayIntersects(holder.getBoundingClientRect(), bounds, 0);
		if (history) {
			setEditorOverlayStyle(history, { visibility: visible ? 'visible' : 'hidden' });
			obstacles.push(history.getBoundingClientRect());
		}
		const actions = holder.querySelector<HTMLElement>('.ce-toolbar__actions');
		if (field && actions?.offsetParent) {
			const fieldRect = field.getBoundingClientRect(),
				size = actions.getBoundingClientRect();
			const placement = placeEditorOverlay(
				size,
				{
					left: holder.dataset.ttControlsSide === 'left' ? fieldRect.left : fieldRect.right - size.width,
					top: fieldRect.top
				},
				bounds,
				obstacles
			);
			moveEditorOverlay(actions, placement);
		}

		for (const [panel, cleanup] of panels)
			if (!panel.isConnected) {
				cleanup();
				panels.delete(panel);
			}
		holder.querySelectorAll<HTMLElement>('.ce-popover--opened:not(.ce-popover--inline) > .ce-popover__container').forEach((panel) => {
			setEditorOverlayStyle(panel, {
				maxWidth: `${bounds.width}px`,
				minWidth: '0px',
				maxHeight: `${Math.min(560, bounds.height)}px`,
				overflow: 'auto'
			});
			const rect = panel.getBoundingClientRect();
			const x = Math.max(bounds.left, Math.min(rect.left, bounds.left + bounds.width - rect.width));
			const y = Math.max(bounds.top, Math.min(rect.top, bounds.top + bounds.height - rect.height));
			if (Math.abs(x - rect.left) > 0.5 || Math.abs(y - rect.top) > 0.5) {
				const [tx = 0, ty = 0] = panel.style.translate.split(' ').map((value) => parseFloat(value) || 0);
				panel.style.translate = `${tx + x - rect.left}px ${ty + y - rect.top}px`;
			}
			if (panel.parentElement?.classList.contains('ce-popover--nested') || panels.has(panel)) return;
			panel.style.width = 'min(340px,calc(100vw - 24px))';
			panel.style.resize = 'both';
			panel.style.overflow = 'auto';
			panel.querySelectorAll<HTMLElement>('.ce-popover__items').forEach((items) => {
				items.style.minWidth = '0';
				items.style.overflowX = 'hidden';
			});
			const handle = document.createElement('div');
			handle.textContent = '⤡';
			handle.style.cssText = 'position:sticky;bottom:0;margin-left:auto;width:28px;height:24px;text-align:center;background:var(--tt-card,#fff)';
			panel.append(handle);
			panels.set(panel, makeEditorPanelResizable(panel, handle, { width: 240, height: 220 }));
		});
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(sync);
	};
	const observer = new MutationObserver(schedule);
	observer.observe(holder.closest('.ttBlockFrame') ?? holder.closest('.tt-editor-session') ?? holder, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ['class', 'style']
	});
	const resize = new ResizeObserver(schedule);
	for (let parent: HTMLElement | null = holder; parent; parent = parent.parentElement) resize.observe(parent);
	schedule();
	document.addEventListener('selectionchange', schedule);
	holder.addEventListener('pointerup', schedule);
	holder.addEventListener('keyup', schedule);
	window.addEventListener('resize', schedule);
	window.addEventListener('scroll', schedule, true);
	window.visualViewport?.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('scroll', schedule);
	return () => {
		observer.disconnect();
		resize.disconnect();
		cancelAnimationFrame(frame);
		panels.forEach((cleanup) => cleanup());
		document.removeEventListener('selectionchange', schedule);
		holder.removeEventListener('pointerup', schedule);
		holder.removeEventListener('keyup', schedule);
		window.removeEventListener('resize', schedule);
		window.removeEventListener('scroll', schedule, true);
		window.visualViewport?.removeEventListener('resize', schedule);
		window.visualViewport?.removeEventListener('scroll', schedule);
		const chip = holder.closest('.ttBlockFrame')?.querySelector<HTMLElement>(':scope > .ttBlockChip');
		if (chip) {
			chip.style.left = '';
			chip.style.top = '';
			chip.style.maxWidth = '';
			chip.style.width = '';
			chip.style.flexWrap = '';
		}
	};
};
