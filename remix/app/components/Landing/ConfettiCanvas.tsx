import React from 'react';

// Extended celebration palette from the v2-fable mockup.
const CONFETTI_COLORS = [
	'#59ff9c',
	'#59bdff',
	'#00b7ef',
	'#ed1c24',
	'#ffa3b1',
	'#6f3198',
	'#a8e61d',
	'#ffc20e',
	'#ff7e00',
	'hotpink'
];

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	s: number;
	c: string;
	g: number;
	ph: number;
	life: number;
}

/**
 * Full-viewport square-confetti canvas (v2-fable landing). Bursts are fired
 * via the 'tt:confetti' CustomEvent (see confetti.ts). Respects
 * prefers-reduced-motion and the theme's motion switch (--tt-motion).
 */
export const ConfettiCanvas = () => {
	const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
	const partsRef = React.useRef<Particle[]>([]);
	const rafRef = React.useRef<number>(0);

	React.useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const reduced = !!(
			window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
		);

		const sizeCanvas = () => {
			const d = Math.min(window.devicePixelRatio || 1, 2);
			canvas.width = window.innerWidth * d;
			canvas.height = window.innerHeight * d;
			ctx.setTransform(d, 0, 0, d, 0, 0);
		};
		sizeCanvas();

		const motionEnabled = () =>
			!reduced &&
			getComputedStyle(document.documentElement).getPropertyValue('--tt-motion').trim() !== '0';

		const burst = (event: Event) => {
			if (!motionEnabled()) return;
			const { x, y, count } = (event as CustomEvent).detail || {};
			const n = Math.min(200, count || 60);
			for (let i = 0; i < n; i++) {
				const a = Math.random() * Math.PI * 2;
				const sp = 3 + Math.random() * 6;
				partsRef.current.push({
					x: x ?? window.innerWidth / 2,
					y: y ?? 300,
					vx: Math.cos(a) * sp,
					vy: Math.sin(a) * sp - 4,
					s: [7, 9, 11][Math.floor(Math.random() * 3)],
					c: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
					g: 0.14 + Math.random() * 0.07,
					ph: Math.random() * 6.28,
					life: 0
				});
			}
		};

		let canvasDirty = false;
		const tick = () => {
			rafRef.current = requestAnimationFrame(tick);
			// Idle fast-path: nothing to draw and nothing drawn last frame.
			if (!partsRef.current.length && !canvasDirty) return;
			const w = window.innerWidth;
			const h = window.innerHeight;
			ctx.clearRect(0, 0, w, h);
			canvasDirty = partsRef.current.length > 0;
			if (!partsRef.current.length) return;
			const keep: Particle[] = [];
			for (const p of partsRef.current) {
				p.life++;
				p.vy = Math.min(p.vy + p.g, 6.5);
				p.x += p.vx + Math.sin((p.life + p.ph * 60) / 22) * 0.8;
				p.y += p.vy;
				p.vx *= 0.985;
				if (p.y < h + 30 && p.life < 420) {
					ctx.fillStyle = p.c;
					ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
					keep.push(p);
				}
			}
			partsRef.current = keep;
		};

		window.addEventListener('resize', sizeCanvas);
		window.addEventListener('tt:confetti', burst);
		rafRef.current = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(rafRef.current);
			window.removeEventListener('resize', sizeCanvas);
			window.removeEventListener('tt:confetti', burst);
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			style={{
				position: 'fixed',
				top: 0,
				left: 0,
				width: '100vw',
				height: '100vh',
				pointerEvents: 'none',
				zIndex: 9000
			}}
		/>
	);
};
