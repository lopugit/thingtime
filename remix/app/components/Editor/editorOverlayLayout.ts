/** Shared geometry for floating editor chrome. Coordinates are viewport pixels. */
export type OverlayRect = { left: number; top: number; width: number; height: number };
export const overlayIntersects = (a: OverlayRect, b: OverlayRect, gap = 6) =>
	a.left < b.left + b.width + gap && a.left + a.width + gap > b.left && a.top < b.top + b.height + gap && a.top + a.height + gap > b.top;

export const placeEditorOverlay = (
	size: { width: number; height: number },
	preferred: { left: number; top: number },
	bounds: OverlayRect,
	obstacles: OverlayRect[]
): OverlayRect => {
	const width = Math.min(size.width, bounds.width),
		height = Math.min(size.height, bounds.height);
	const clampX = (x: number) => Math.max(bounds.left, Math.min(x, bounds.left + bounds.width - width));
	const clampY = (y: number) => Math.max(bounds.top, Math.min(y, bounds.top + bounds.height - height));
	const xs = new Set([clampX(preferred.left), bounds.left, clampX(bounds.left + bounds.width)]);
	const ys = new Set([clampY(preferred.top), bounds.top, clampY(bounds.top + bounds.height)]);
	for (const obstacle of obstacles) {
		xs.add(clampX(obstacle.left - width - 8));
		xs.add(clampX(obstacle.left + obstacle.width + 8));
		ys.add(clampY(obstacle.top - height - 8));
		ys.add(clampY(obstacle.top + obstacle.height + 8));
	}
	let best = { left: clampX(preferred.left), top: clampY(preferred.top), width, height };
	let bestScore = Infinity;
	for (const left of [...xs].sort((a, b) => Math.abs(a - preferred.left) - Math.abs(b - preferred.left)).slice(0, 24))
		for (const top of [...ys].sort((a, b) => Math.abs(a - preferred.top) - Math.abs(b - preferred.top)).slice(0, 32)) {
			const rect = { left, top, width, height };
			const collisions = obstacles.filter((obstacle) => overlayIntersects(rect, obstacle)).length;
			const score = collisions * 1e7 + Math.abs(left - preferred.left) + Math.abs(top - preferred.top) * 1.5;
			if (score < bestScore) {
				best = rect;
				bestScore = score;
			}
		}
	return best;
};

export const editorOverlayBounds = (holder: HTMLElement): OverlayRect => {
	const vv = window.visualViewport;
	let left = (vv?.offsetLeft || 0) + 8,
		top = (vv?.offsetTop || 0) + 8;
	let right = left + (vv?.width || innerWidth) - 16,
		bottom = top + (vv?.height || innerHeight) - 16;
	for (let parent = holder.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
		const css = getComputedStyle(parent),
			rect = parent.getBoundingClientRect();
		if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
			left = Math.max(left, rect.left + 8);
			right = Math.min(right, rect.right - 8);
		}
		if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
			top = Math.max(top, rect.top + 8);
			bottom = Math.min(bottom, rect.bottom - 8);
		}
	}
	// Account for fixed application chrome, including the builder inspector.
	document
		.querySelectorAll<HTMLElement>('header, .thingtimeTopNav, [data-testid="builder-drawer"], [data-editor-overlay-obstacle]')
		.forEach((element) => {
			if (element.contains(holder)) return;
			const css = getComputedStyle(element),
				rect = element.getBoundingClientRect();
			if (!['fixed', 'sticky'].includes(css.position) || !rect.width || !rect.height) return;
			if (rect.height > (bottom - top) * 0.6) {
				if (rect.right >= right && rect.left < right) right = Math.max(left, rect.left - 8);
				else if (rect.left <= left && rect.right > left) left = Math.min(right, rect.right + 8);
			} else if (rect.width > (right - left) * 0.6 && (rect.top <= top || element.classList.contains('thingtimeTopNav')) && rect.bottom > top)
				top = Math.min(bottom, rect.bottom + 8);
		});
	return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};

/** Move the containing element by a measured delta; also works in scaled builders. */
export const moveEditorOverlay = (element: HTMLElement, position: Pick<OverlayRect, 'left' | 'top'>, mover = element) => {
	const rect = element.getBoundingClientRect(),
		css = getComputedStyle(mover);
	const parent = mover.offsetParent as HTMLElement | null;
	const scaleX = parent?.offsetWidth ? parent.getBoundingClientRect().width / parent.offsetWidth : 1;
	const scaleY = parent?.offsetHeight ? parent.getBoundingClientRect().height / parent.offsetHeight : 1;
	if (Math.abs(position.left - rect.left) > 0.5) mover.style.left = `${(parseFloat(css.left) || 0) + (position.left - rect.left) / (scaleX || 1)}px`;
	if (Math.abs(position.top - rect.top) > 0.5) mover.style.top = `${(parseFloat(css.top) || 0) + (position.top - rect.top) / (scaleY || 1)}px`;
};

export const editorTextObstacles = (holder: HTMLElement): OverlayRect[] => {
	const rects: OverlayRect[] = [];
	holder.querySelectorAll<HTMLElement>('[contenteditable="true"],textarea').forEach((field) => {
		if (field.tagName === 'TEXTAREA' || !field.textContent?.trim()) rects.push(field.getBoundingClientRect());
		else {
			const range = document.createRange();
			range.selectNodeContents(field);
			rects.push(...Array.from(range.getClientRects()));
		}
	});
	const frame = holder.closest('.ttBlockFrame');
	const canvas = frame?.closest('[data-testid="webpage-blocks"]') ?? frame?.parentElement;
	canvas?.querySelectorAll<HTMLElement>('.ttBlockFrame').forEach((other) => {
		if (!other.contains(holder) && !frame?.contains(other)) rects.push(other.getBoundingClientRect());
	});
	const session = holder.closest('.tt-editor-session');
	const scope = holder.closest('main, [role="dialog"]') ?? holder.parentElement?.parentElement;
	scope?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,button,input,select,summary,img,video').forEach((element) => {
		if (
			session?.contains(element) ||
			element.contains(holder) ||
			element.closest('.ttBlockChip, .tt-editor-history-controls, .ce-toolbar, .ce-popover, .ttInsertZone, .ttDropWell')
		)
			return;
		if (/^(H[1-6]|P)$/.test(element.tagName)) {
			const range = document.createRange();
			range.selectNodeContents(element);
			rects.push(...Array.from(range.getClientRects()));
		} else rects.push(element.getBoundingClientRect());
	});
	const bounds = editorOverlayBounds(holder);
	return rects.filter((rect) => rect.width > 0 && rect.height > 0 && overlayIntersects(rect, bounds, 0));
};

export const setEditorOverlayStyle = (element: HTMLElement, values: Partial<CSSStyleDeclaration>) => {
	for (const [key, value] of Object.entries(values)) {
		if ((element.style as any)[key] !== value) (element.style as any)[key] = value;
	}
};
