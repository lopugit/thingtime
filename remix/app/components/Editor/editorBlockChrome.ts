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
		const actions = holder.querySelector<HTMLElement>('.ce-toolbar__actions');
		if (field && actions?.offsetParent) {
			const fieldRect = field.getBoundingClientRect();
			const actionRect = actions.getBoundingClientRect();
			const fields = Array.from(holder.querySelectorAll<HTMLElement>('[contenteditable="true"],textarea'));
			const firstTop = fields[0]?.getBoundingClientRect().top ?? fieldRect.top;
			const aboveEditor = firstTop - actionRect.height - 8;
			const overlapsText = (top: number) =>
				fields.some((entry) => {
					const bounds = entry.getBoundingClientRect();
					const intersects = (rect: DOMRect) =>
						rect.width > 0 &&
						rect.height > 0 &&
						rect.left < actionRect.right + 4 &&
						rect.right > actionRect.left - 4 &&
						rect.top < top + actionRect.height + 4 &&
						rect.bottom > top - 4;
					if (!intersects(bounds)) return false;
					if (entry.tagName === 'TEXTAREA' || !entry.textContent?.trim()) return true;
					const range = document.createRange();
					range.selectNodeContents(entry);
					return Array.from(range.getClientRects()).some(intersects);
				});
			// Prefer blank space beside the active text. Never cover a neighbouring
			// heading/line merely because the active field has no room for its controls.
			const top = [fieldRect.top, fieldRect.top - actionRect.height - 8, aboveEditor].find((candidate) => !overlapsText(candidate)) ?? aboveEditor;
			const next = `${top - actions.offsetParent.getBoundingClientRect().top}px`;
			if (actions.style.top !== next) actions.style.top = next;
			if (session) session.style.setProperty('--tt-editor-chrome-top', `${firstTop - session.getBoundingClientRect().top - 32}px`);
		}
		for (const [panel, cleanup] of panels)
			if (!panel.isConnected) {
				cleanup();
				panels.delete(panel);
			}
		holder
			.querySelectorAll<HTMLElement>('.ce-popover--opened:not(.ce-popover--inline):not(.ce-popover--nested) > .ce-popover__container')
			.forEach((panel) => {
				if (panels.has(panel)) return;
				panel.style.width = 'min(340px,calc(100vw - 24px))';
				panel.style.maxWidth = 'calc(100vw - 24px)';
				panel.style.maxHeight = 'min(560px,calc(100dvh - 24px))';
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
	observer.observe(holder, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
	holder.addEventListener('pointerup', schedule);
	holder.addEventListener('keyup', schedule);
	window.addEventListener('resize', schedule);
	return () => {
		observer.disconnect();
		cancelAnimationFrame(frame);
		panels.forEach((cleanup) => cleanup());
		holder.removeEventListener('pointerup', schedule);
		holder.removeEventListener('keyup', schedule);
		window.removeEventListener('resize', schedule);
	};
};
