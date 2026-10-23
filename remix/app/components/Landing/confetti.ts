/** Fire a confetti burst at viewport coordinates (see ConfettiCanvas). */
export const burstConfetti = (x: number, y: number, count = 60) => {
	try {
		window.dispatchEvent(
			new CustomEvent('tt:confetti', { detail: { x, y, count } }),
		);
	} catch (error) {
		// non-browser runtime — confetti is decorative
	}
};

/** Convenience: burst from a mouse/pointer event position. */
export const burstAtEvent = (event: { clientX?: number; clientY?: number }, count = 60) => {
	burstConfetti(
		event?.clientX ?? window.innerWidth / 2,
		event?.clientY ?? 300,
		count,
	);
};
