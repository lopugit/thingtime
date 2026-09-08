/** Pointer and keyboard resizing, bounded to the visual viewport (including the iOS keyboard). */
export const makeEditorPanelResizable = (panel: HTMLElement, handle: HTMLElement, minimum = { width: 300, height: 240 }) => {
	let start: { x: number; y: number; width: number; height: number } | undefined;
	handle.setAttribute('role', 'button');
	handle.setAttribute('tabindex', '0');
	handle.setAttribute('aria-label', 'Resize editor window');
	handle.setAttribute('title', 'Drag to resize, or use arrow keys');
	handle.style.cssText += ';cursor:nwse-resize;touch-action:none;user-select:none';
	const setSize = (width: number, height: number) => {
		const rect = panel.getBoundingClientRect(),
			vv = window.visualViewport;
		const right = (vv?.offsetLeft || 0) + (vv?.width || innerWidth) - 8;
		const bottom = (vv?.offsetTop || 0) + (vv?.height || innerHeight) - 8;
		panel.style.width = `${Math.max(Math.min(minimum.width, right - rect.left), Math.min(width, right - rect.left))}px`;
		panel.style.height = `${Math.max(Math.min(minimum.height, bottom - rect.top), Math.min(height, bottom - rect.top))}px`;
	};
	const down = (e: PointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const rect = panel.getBoundingClientRect();
		start = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
		handle.setPointerCapture(e.pointerId);
	};
	const move = (e: PointerEvent) => {
		if (start && handle.hasPointerCapture(e.pointerId)) setSize(start.width + e.clientX - start.x, start.height + e.clientY - start.y);
	};
	const key = (e: KeyboardEvent) => {
		if (!e.key.startsWith('Arrow')) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = panel.getBoundingClientRect();
		setSize(
			rect.width + (e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : 0),
			rect.height + (e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0)
		);
	};
	handle.addEventListener('pointerdown', down);
	handle.addEventListener('pointermove', move);
	handle.addEventListener('keydown', key);
	return () => {
		handle.removeEventListener('pointerdown', down);
		handle.removeEventListener('pointermove', move);
		handle.removeEventListener('keydown', key);
	};
};

export const makeEditorPanelMovable = (panel: HTMLElement, handle: HTMLElement) => {
	let origin: { x: number; y: number; left: number; top: number } | undefined;
	let moved = false;
	handle.tabIndex = 0;
	handle.setAttribute('role', 'button');
	handle.setAttribute('aria-label', 'Move style window');
	handle.style.cursor = 'move';
	handle.style.touchAction = 'none';
	const position = (left: number, top: number) => {
		moved = true;
		const vv = window.visualViewport,
			rect = panel.getBoundingClientRect();
		const x = vv?.offsetLeft || 0,
			y = vv?.offsetTop || 0;
		panel.style.margin = '0';
		panel.style.position = 'fixed';
		panel.style.left = `${Math.max(x + 8, Math.min(left, x + (vv?.width || innerWidth) - rect.width - 8))}px`;
		panel.style.top = `${Math.max(y + 8, Math.min(top, y + (vv?.height || innerHeight) - rect.height - 8))}px`;
	};
	const down = (e: PointerEvent) => {
		e.preventDefault();
		const rect = panel.getBoundingClientRect();
		origin = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
		handle.setPointerCapture(e.pointerId);
	};
	const move = (e: PointerEvent) => {
		if (origin && handle.hasPointerCapture(e.pointerId)) position(origin.left + e.clientX - origin.x, origin.top + e.clientY - origin.y);
	};
	const key = (e: KeyboardEvent) => {
		if (!e.key.startsWith('Arrow')) return;
		e.preventDefault();
		const rect = panel.getBoundingClientRect();
		position(
			rect.left + (e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : 0),
			rect.top + (e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0)
		);
	};
	handle.addEventListener('pointerdown', down);
	handle.addEventListener('pointermove', move);
	handle.addEventListener('keydown', key);
	const clampPosition = () => {
		if (!moved) return;
		const rect = panel.getBoundingClientRect();
		position(rect.left, rect.top);
	};
	window.addEventListener('resize', clampPosition);
	window.visualViewport?.addEventListener('resize', clampPosition);
	window.visualViewport?.addEventListener('scroll', clampPosition);
	return () => {
		handle.removeEventListener('pointerdown', down);
		handle.removeEventListener('pointermove', move);
		handle.removeEventListener('keydown', key);
		window.removeEventListener('resize', clampPosition);
		window.visualViewport?.removeEventListener('resize', clampPosition);
		window.visualViewport?.removeEventListener('scroll', clampPosition);
	};
};
