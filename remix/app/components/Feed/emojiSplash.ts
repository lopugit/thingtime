/**
 * 🎉 Emoji splash — a tiny DOM-particle burst for reaction taps.
 *
 * Pattern-sibling of the eggs (`~/eggs/eggs.ts` rainbowFlash) and the Landing
 * confetti: decorative, self-contained, self-cleaning, SSR-safe, and always
 * polite about motion — every burst is gated behind the SAME {@link motionOK}
 * switch the confetti engine uses (prefers-reduced-motion + `--tt-motion`),
 * so reduced-motion viewers get zero work, zero DOM.
 *
 * 5–8 <span> copies of the chosen emoji spawn at the tapped element's viewport
 * position inside one fixed, pointer-events:none container, then drift up with
 * randomized sideways drift, wobble, spin and fade over ~700–900ms. Animation
 * is transform/opacity ONLY (compositor work, no layout thrash) via the Web
 * Animations API; each particle node is removed on its `finish` (the WAAPI
 * animationend), the container when the last particle lands, and a timeout
 * safety net guarantees cleanup even if `finish` never fires. Concurrent
 * bursts are capped — spam-taps cull the oldest burst, so nodes can't pile up.
 */
import { motionOK } from '~/eggs/eggs';
import { splitEmojis } from '~/utils/reactionTokens';

const MAX_CONCURRENT_BURSTS = 3;
const MIN_PARTICLES = 5;
const MAX_PARTICLES = 8;
const MIN_DURATION_MS = 700;
const MAX_DURATION_MS = 900;
// above cards/popovers (popover z 10), below the rainbow egg wash (8999)
const SPLASH_Z_INDEX = 8990;

type ActiveBurst = { root: HTMLElement; timer: number; pending: number };

/** Live bursts, oldest first — the concurrency cap culls from the front. */
const activeBursts: ActiveBurst[] = [];

const removeBurst = (burst: ActiveBurst): void => {
	const idx = activeBursts.indexOf(burst);
	if (idx !== -1) activeBursts.splice(idx, 1);
	window.clearTimeout(burst.timer);
	burst.root.remove();
};

/**
 * The first grapheme of `text` when it IS an emoji (poll options like
 * "🍕 Pizza"), else null — so callers can fall back to a default glyph.
 */
export const leadingEmoji = (text: unknown): string | null => {
	if (typeof text !== 'string') return null;
	const first = splitEmojis(text.trim())[0] || '';
	return /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(first) ? first : null;
};

/**
 * Burst `emoji` (a reaction token — possibly a multi-emoji group, whose
 * emojis the particles cycle through) from the centre of `anchor`.
 * No-ops entirely server-side and when motion is reduced.
 */
export const splashEmoji = (emoji: string, anchor?: Element | null): void => {
	if (typeof document === 'undefined' || typeof window === 'undefined') return;
	// zero work when the viewer prefers reduced motion (same gate as confetti)
	if (!motionOK()) return;
	const token = (emoji || '').trim();
	if (!token) return;
	// WAAPI is the transform/opacity engine here; without it, skip (decorative)
	if (typeof HTMLElement === 'undefined' || typeof HTMLElement.prototype.animate !== 'function') return;

	// origin: centre of the tapped element, else mid-viewport
	let originX = window.innerWidth / 2;
	let originY = window.innerHeight / 2;
	const rect = anchor?.getBoundingClientRect?.();
	if (rect && (rect.width || rect.height)) {
		originX = rect.left + rect.width / 2;
		originY = rect.top + rect.height / 2;
	}

	// cap concurrency: spam-taps cull the OLDEST burst so nodes never pile up
	while (activeBursts.length >= MAX_CONCURRENT_BURSTS) removeBurst(activeBursts[0]);

	const root = document.createElement('div');
	root.setAttribute('aria-hidden', 'true');
	root.style.cssText = [
		'position:fixed',
		'left:0',
		'top:0',
		'width:0',
		'height:0',
		`z-index:${SPLASH_Z_INDEX}`,
		'pointer-events:none'
	].join(';');

	const burst: ActiveBurst = { root, timer: 0, pending: 0 };
	const emojis = splitEmojis(token);
	const count = MIN_PARTICLES + Math.floor(Math.random() * (MAX_PARTICLES - MIN_PARTICLES + 1));

	for (let i = 0; i < count; i++) {
		const span = document.createElement('span');
		span.textContent = emojis[i % emojis.length];
		span.style.cssText = [
			'position:absolute',
			`left:${originX}px`,
			`top:${originY}px`,
			'font-size:18px',
			'line-height:1',
			'will-change:transform,opacity'
		].join(';');

		// randomized "physics": sideways drift, upward rise, mid-flight wobble,
		// spin, and a per-particle size — all expressed as transform/opacity
		const drift = (Math.random() - 0.5) * 110;
		const rise = 60 + Math.random() * 70;
		const wobble = (Math.random() - 0.5) * 34;
		const spin = (Math.random() - 0.5) * 90;
		const scale = 0.9 + Math.random() * 0.9;
		const duration = MIN_DURATION_MS + Math.random() * (MAX_DURATION_MS - MIN_DURATION_MS);

		const animation = span.animate(
			[
				{
					transform: 'translate(-50%, -50%) translate(0px, 0px) rotate(0deg) scale(0.5)',
					opacity: 1
				},
				{
					transform: `translate(-50%, -50%) translate(${drift * 0.6 + wobble}px, ${-rise * 0.55}px) rotate(${spin * 0.6}deg) scale(${scale})`,
					opacity: 0.9,
					offset: 0.55
				},
				{
					transform: `translate(-50%, -50%) translate(${drift}px, ${-rise}px) rotate(${spin}deg) scale(${scale * 0.85})`,
					opacity: 0
				}
			],
			{ duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
		);
		burst.pending += 1;
		// finish == animationend for WAAPI: drop the node the moment it lands,
		// and the whole burst once its last particle has
		animation.onfinish = () => {
			span.remove();
			burst.pending -= 1;
			if (burst.pending <= 0) removeBurst(burst);
		};
		root.appendChild(span);
	}

	// safety net: even if `finish` never fires (hidden tab, cancelled
	// timeline), the burst still leaves the DOM — no leaks
	burst.timer = window.setTimeout(() => removeBurst(burst), MAX_DURATION_MS + 400);
	activeBursts.push(burst);
	document.body.appendChild(root);
};
