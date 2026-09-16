import React from 'react';

export const lopuVisualViewportGeometry = (layoutHeight: number, height: number, offsetTop: number) => ({
	height: Math.max(0, height),
	top: Math.max(0, offsetTop),
	bottom: Math.max(0, layoutHeight - height - offsetTop),
	keyboardOpen: layoutHeight - height > 120
});

// iOS keyboards resize and pan the visual viewport without resizing 100dvh.
export function useLopuVisualViewport() {
	const read = () =>
		typeof window === 'undefined'
			? null
			: lopuVisualViewportGeometry(window.innerHeight, window.visualViewport?.height ?? window.innerHeight, window.visualViewport?.offsetTop ?? 0);
	const [viewport, setViewport] = React.useState(read);
	React.useEffect(() => {
		let frame = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => setViewport(read()));
		};
		const visual = window.visualViewport;
		visual?.addEventListener('resize', update);
		visual?.addEventListener('scroll', update);
		window.addEventListener('resize', update);
		update();
		return () => {
			cancelAnimationFrame(frame);
			visual?.removeEventListener('resize', update);
			visual?.removeEventListener('scroll', update);
			window.removeEventListener('resize', update);
		};
	}, []);
	return viewport;
}
