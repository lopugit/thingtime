import React from 'react';

const COMPOSER = '[data-lopu-launcher-clearance]';
const GUTTER = 8;

// On phones the floating shortcut can cover a page composer's submit button.
// Temporarily tuck it away only where the two surfaces intersect. Keep its box
// (and saved position) unchanged so scrolling clear restores it without a loop.
// Lopu remains available through the navigation while the shortcut is tucked.
export function useLopuLauncherClearance(ref: React.RefObject<HTMLElement | null>, active: boolean, positionKey: string) {
	const [covered, setCovered] = React.useState(false);
	React.useLayoutEffect(() => {
		const launcher = ref.current;
		if (!active || !launcher) return;
		let frame = 0;
		let composers: Element[] = [];
		const measure = () => {
			frame = 0;
			const bubble = launcher.getBoundingClientRect();
			setCovered(composers.some(element => {
				const rect = element.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 &&
					rect.left < bubble.right + GUTTER && rect.right > bubble.left - GUTTER &&
					rect.top < bubble.bottom + GUTTER && rect.bottom > bubble.top - GUTTER;
			}));
		};
		const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
		const resize = new ResizeObserver(schedule);
		const refresh = () => {
			composers = Array.from(document.querySelectorAll(COMPOSER));
			resize.disconnect();
			resize.observe(document.body);
			resize.observe(launcher);
			composers.forEach(element => resize.observe(element));
			schedule();
		};
		const mutations = new MutationObserver(records => {
			if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
				node instanceof Element && (node.matches(COMPOSER) || node.querySelector(COMPOSER))))) refresh();
			else schedule();
		});
		refresh();
		cancelAnimationFrame(frame);
		measure();
		mutations.observe(document.body, { childList: true, subtree: true });
		window.addEventListener('scroll', schedule, true);
		window.addEventListener('resize', schedule);
		window.visualViewport?.addEventListener('resize', schedule);
		window.visualViewport?.addEventListener('scroll', schedule);
		return () => {
			cancelAnimationFrame(frame);
			resize.disconnect();
			mutations.disconnect();
			window.removeEventListener('scroll', schedule, true);
			window.removeEventListener('resize', schedule);
			window.visualViewport?.removeEventListener('resize', schedule);
			window.visualViewport?.removeEventListener('scroll', schedule);
		};
	}, [active, positionKey, ref]);
	return active && covered;
}
