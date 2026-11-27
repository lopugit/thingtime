/** Is someone actually using this window?
 *
 * Background polling exists to show a person fresh data. Once nobody has
 * touched the window for a while, polling only costs server work, so the
 * activity manager and the background-refresh helper pause their network
 * polls while the user is idle and refresh as soon as they interact again.
 * Hidden windows are handled separately by visibility.
 *
 * The tracker itself does no network work: it records the time of the last
 * interaction and keeps at most one local timer to notice the switch to idle. */
export const IDLE_AFTER_MS = 2 * 60_000;

type Listener = (idle: boolean) => void;
export type PresenceEnvironment = {
	window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
	document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
	now: () => number;
	setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer: (id: ReturnType<typeof setTimeout>) => void;
};

// Any of these means a person is present. Pointer movement and scrolling count
// so that reading with the mouse or trackpad keeps updates flowing.
const WINDOW_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll', 'focus'] as const;

export function createUserPresence(env: PresenceEnvironment, idleAfterMs = IDLE_AFTER_MS) {
	let last = env.now();
	let idle = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const listeners = new Set<Listener>();
	const set = (next: boolean) => {
		if (next === idle) return;
		idle = next;
		for (const listener of [...listeners]) listener(idle);
	};
	const check = () => {
		timer = undefined;
		const quiet = env.now() - last;
		if (quiet >= idleAfterMs) set(true);
		else timer = env.setTimer(check, idleAfterMs - quiet);
	};
	const arm = () => {
		if (timer === undefined && !idle) timer = env.setTimer(check, Math.max(0, idleAfterMs - (env.now() - last)));
	};
	const seen = () => {
		last = env.now();
		if (idle) set(false);
		arm();
	};
	const visibility = () => {
		if (env.document.visibilityState === 'visible') seen();
	};
	for (const type of WINDOW_EVENTS) env.window.addEventListener(type, seen, { passive: true, capture: true });
	env.document.addEventListener('visibilitychange', visibility);
	arm();
	return {
		isIdle: () => idle,
		/** Called with true when the user goes idle and false when they return. */
		subscribe(listener: Listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		/** Record an interaction that the DOM events above cannot see. */
		seen,
		dispose() {
			if (timer !== undefined) env.clearTimer(timer);
			timer = undefined;
			for (const type of WINDOW_EVENTS) env.window.removeEventListener(type, seen, { capture: true });
			env.document.removeEventListener('visibilitychange', visibility);
			listeners.clear();
		}
	};
}

let browserPresence: ReturnType<typeof createUserPresence> | undefined;
/** The shared tracker for this window, or undefined outside a browser. */
export function userPresence() {
	if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
	browserPresence ??= createUserPresence({
		window,
		document,
		now: Date.now,
		setTimer: (fn, ms) => setTimeout(fn, ms),
		clearTimer: (id) => clearTimeout(id)
	});
	return browserPresence;
}
