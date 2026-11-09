/** Initialize an expensive editor only at its first visible intersection. The
 * caller keeps that initialized editor mounted afterwards to preserve drafts. */
export function observeFirstVisibleEditor(element: HTMLElement, reveal: () => void): () => void {
	const view = element.ownerDocument.defaultView;
	if (!view) return () => {};
	let live = true,
		observer: IntersectionObserver | undefined,
		frame: number | null = null;
	const visible = () => {
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && !parent.querySelector(':scope > summary')?.contains(element)) return false;
		}
		const rect = element.getBoundingClientRect();
		return element.isConnected && rect.width > 0 && rect.height > 0 && view.getComputedStyle(element).visibility !== 'hidden';
	};
	const cleanup = () => {
		observer?.disconnect();
		if (frame !== null) view.cancelAnimationFrame(frame);
		view.removeEventListener('scroll', schedule, true);
		view.removeEventListener('resize', schedule);
		element.ownerDocument.removeEventListener('toggle', schedule, true);
	};
	const open = () => {
		if (!live || !visible()) return;
		live = false;
		cleanup();
		reveal();
	};
	const check = () => {
		frame = null;
		const rect = element.getBoundingClientRect();
		if (rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth) open();
	};
	const schedule = () => {
		if (live && frame === null) frame = view.requestAnimationFrame(check);
	};
	if (typeof view.IntersectionObserver === 'function') {
		observer = new view.IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.target === element && entry.isIntersecting)) open();
		});
		observer.observe(element);
	} else {
		view.addEventListener('scroll', schedule, true);
		view.addEventListener('resize', schedule);
		element.ownerDocument.addEventListener('toggle', schedule, true);
		schedule();
	}
	return () => {
		live = false;
		cleanup();
	};
}
