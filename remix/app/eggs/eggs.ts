/**
 * 🥚 Thingtime easter eggs — a tiny, self-contained bag of delight.
 *
 * Hidden but discoverable, never annoying, always polite about motion. Every
 * animated effect here is gated behind {@link motionOK} (which respects both
 * `prefers-reduced-motion` and the theme's `--tt-motion` switch, exactly like
 * ConfettiCanvas), so eggs degrade to toast-only when motion is off.
 *
 * Toasts are NOT fired here — the caller passes them through `useLopu()` so we
 * keep the one sanctioned notification path (FUNDAMENTALS §7).
 */
import { burstConfetti } from '~/components/Landing/confetti';

/** Rainbow-panning border gradient (matches the Lopu toast / commander wrap). */
const RAINBOW_CSS = 'linear-gradient(120deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)';

/** True when we're allowed to animate: in a browser, not reduced-motion, and the
 * theme's motion switch isn't off. Mirrors ConfettiCanvas.motionEnabled(). */
export const motionOK = (): boolean => {
	if (typeof window === 'undefined') return false;
	try {
		if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			return false;
		}
		const motion = getComputedStyle(document.documentElement).getPropertyValue('--tt-motion').trim();
		return motion !== '0';
	} catch {
		return true;
	}
};

/** A celebratory spread of confetti across the top of the viewport. */
export const partyConfetti = (bursts = 5): void => {
	if (!motionOK() || typeof window === 'undefined') return;
	const w = window.innerWidth;
	for (let i = 0; i < bursts; i++) {
		const x = (w / (bursts + 1)) * (i + 1);
		const y = 90 + (i % 2) * 40;
		// stagger so it reads as a wave, not one blob
		window.setTimeout(() => burstConfetti(x, y, 70), i * 90);
	}
};

/** A brief full-viewport rainbow wash that fades out and cleans itself up. */
export const rainbowFlash = (): void => {
	if (!motionOK() || typeof document === 'undefined') return;
	// don't stack flashes
	if (document.getElementById('tt-egg-flash')) return;
	const el = document.createElement('div');
	el.id = 'tt-egg-flash';
	el.style.cssText = [
		'position:fixed',
		'inset:0',
		'z-index:8999',
		'pointer-events:none',
		`background:${RAINBOW_CSS}`,
		'background-size:300% 300%',
		'opacity:0',
		'mix-blend-mode:overlay',
		'transition:opacity 260ms ease-out'
	].join(';');
	document.body.appendChild(el);
	// fade in, then out, then remove
	requestAnimationFrame(() => {
		el.style.opacity = '0.55';
		window.setTimeout(() => {
			el.style.opacity = '0';
			window.setTimeout(() => el.remove(), 320);
		}, 420);
	});
};

/** The full party: confetti wave + a rainbow wash. Toast is the caller's job. */
export const partyMode = (): void => {
	partyConfetti(6);
	rainbowFlash();
};

/** The Konami code, by KeyboardEvent.code. */
export const KONAMI: readonly string[] = [
	'ArrowUp',
	'ArrowUp',
	'ArrowDown',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowLeft',
	'ArrowRight',
	'KeyB',
	'KeyA'
];

/**
 * Listen for the Konami code anywhere on the page. Returns a cleanup fn.
 * Matches on a rolling buffer so a stray keypress mid-sequence just resets it.
 */
export const installKonami = (onTrigger: () => void): (() => void) => {
	if (typeof window === 'undefined') return () => {};
	let buffer: string[] = [];
	const onKey = (e: KeyboardEvent) => {
		buffer.push(e.code);
		if (buffer.length > KONAMI.length) buffer = buffer.slice(-KONAMI.length);
		if (buffer.length === KONAMI.length && KONAMI.every((k, i) => buffer[i] === k)) {
			buffer = [];
			onTrigger();
		}
	};
	window.addEventListener('keydown', onKey);
	return () => window.removeEventListener('keydown', onKey);
};

/** Wizard incantations, rotated deterministically by the minute (no RNG — the
 * owner values determinism; keying off the clock keeps test == live). */
export const INCANTATIONS: readonly string[] = [
	'✨ Levio-thing-sa!',
	'🪄 Abra-ca-data!',
	'🌈 Expecto Rainbowum!',
	'🦄 Alohomora, little thing.',
	'🔮 Wingardium Thingiosa!',
	'💫 Accio serendipity!'
];

/** Pick an incantation for "now" — same minute → same spell. */
export const pickIncantation = (): string => {
	if (typeof Date === 'undefined') return INCANTATIONS[0];
	const idx = Math.floor(Date.now() / 60000) % INCANTATIONS.length;
	return INCANTATIONS[idx];
};

/** Recognised secret words for the Commander. Keys are matched case-insensitively
 * against the trimmed commander input. `navigate` words are handled by the caller. */
export type SecretWord = 'unicorn' | 'rainbow' | 'party' | 'konami' | 'lopu' | 'ode';

export const SECRET_WORDS: Record<string, SecretWord> = {
	unicorn: 'unicorn',
	rainbow: 'rainbow',
	party: 'party',
	konami: 'konami',
	lopu: 'lopu',
	ode: 'ode'
};

/** Short celebratory lines for the Commander eggs (deterministic by minute). */
export const SPARKLE_LINES: readonly string[] = [
	'You are made of stardust and stubbornness. 🌈',
	'The internet just got a little more yours. ✨',
	'Everything is a thing, and every thing is a little magic. 🦄',
	'Keep imagining. Thingtime is listening. 💫',
	'A wild rainbow appears! 🌈'
];

export const pickSparkle = (): string => {
	if (typeof Date === 'undefined') return SPARKLE_LINES[0];
	const idx = Math.floor(Date.now() / 60000) % SPARKLE_LINES.length;
	return SPARKLE_LINES[idx];
};
