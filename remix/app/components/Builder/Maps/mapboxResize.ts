type ResizeMap = { resize: () => void };

type ResizeRuntime = {
	Observer: typeof ResizeObserver;
	requestFrame: (callback: FrameRequestCallback) => number;
	cancelFrame: (handle: number) => void;
};

// Mapbox measures its canvas when constructed. A drawer can change the host's
// width without changing the window size, so observe the actual map element.
export function observeMapboxContainer(
	container: HTMLElement,
	map: ResizeMap,
	runtime: ResizeRuntime = {
		Observer: ResizeObserver,
		requestFrame: window.requestAnimationFrame.bind(window),
		cancelFrame: window.cancelAnimationFrame.bind(window)
	}
): () => void {
	let active = true;
	let frame: number | null = null;
	let width: number | null = null;
	let height: number | null = null;
	const observer = new runtime.Observer((entries) => {
		const entry = entries.find((candidate) => candidate.target === container);
		if (!entry) return;
		const nextWidth = entry.contentRect.width;
		const nextHeight = entry.contentRect.height;
		if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0) return;
		if (nextWidth === width && nextHeight === height) return;
		width = nextWidth;
		height = nextHeight;
		if (frame !== null) return;
		frame = runtime.requestFrame(() => {
			frame = null;
			if (active) map.resize();
		});
	});
	observer.observe(container);
	return () => {
		active = false;
		observer.disconnect();
		if (frame !== null) runtime.cancelFrame(frame);
		frame = null;
	};
}
