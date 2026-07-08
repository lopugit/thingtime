/**
 * 🖥️ Console easter egg — a rainbow banner + a real `window.lopu` scripting
 * surface over the one Thingtime data tree, for the curious who open devtools.
 *
 * NOTE: the app owns `window.tt` (ThingtimeProvider reassigns it to the live
 * tree on every state change), so this egg lives on `window.lopu` instead — a
 * free namespace it can safely keep. `window.tt.get/set` already work too.
 *
 * Installed once (guarded) by the EasterEggs host, which closes the API over the
 * live thingtime getters/setters and the Lopu toast.
 */

export interface TtConsoleApi {
	get: (path?: string) => any;
	set: (path: string, value: any) => void;
	paths: () => string[];
	toast: (title: string, description?: string) => void;
	confetti: () => void;
	help: () => void;
}

const RAINBOW_STOPS = ['#f34a4a', '#ffbc48', '#58ca70', '#47b5e6', '#a555e8'];

/** Print "thingtime" with one rainbow colour per letter, big and bold. */
const printBanner = () => {
	const word = '🦄 thingtime';
	const styles: string[] = [];
	let fmt = '';
	for (let i = 0; i < word.length; i++) {
		fmt += `%c${word[i]}`;
		const color = RAINBOW_STOPS[i % RAINBOW_STOPS.length];
		styles.push(`color:${color};font-size:22px;font-weight:800;font-family:'Space Grotesk',system-ui,sans-serif;text-shadow:0 1px 0 rgba(0,0,0,.08)`);
	}
	// eslint-disable-next-line no-console
	console.log(fmt, ...styles);
	// eslint-disable-next-line no-console
	console.log(
		'%cYou found the console. 🌈 Try %clopu.help()%c for a little magic.',
		'color:#9a9aa6;font-size:12px',
		'color:#a555e8;font-size:12px;font-weight:700',
		'color:#9a9aa6;font-size:12px'
	);
};

const printHelp = () => {
	// eslint-disable-next-line no-console
	console.log('%c🦄 window.lopu — Thingtime console API', 'color:#47b5e6;font-size:14px;font-weight:800');
	const rows: Array<[string, string]> = [
		['lopu.get(path?)', 'read the thingtime tree (whole tree if no path)'],
		['lopu.set(path, value)', 'write a value, e.g. lopu.set("me.mood", "🌈")'],
		['lopu.paths()', 'list known thing paths'],
		['lopu.toast(title, desc?)', 'make Lopu say something'],
		['lopu.confetti()', 'you know what this does 🎉'],
		['lopu.help()', 'this'],
		['⌨︎ psst', 'the Konami code works anywhere. so does typing "unicorn".']
	];
	for (const [k, v] of rows) {
		// eslint-disable-next-line no-console
		console.log(`%c${k.padEnd(26)}%c${v}`, 'color:#a555e8;font-weight:700', 'color:#5a5a66');
	}
};

export const installConsoleEgg = (api: TtConsoleApi): void => {
	if (typeof window === 'undefined') return;
	const w = window as any;
	if (w.__ttConsoleEgg) return; // once per tab
	w.__ttConsoleEgg = true;

	// The app owns window.tt (live thingtime tree) — keep our egg on window.lopu.
	w.lopu = {
		get: api.get,
		set: api.set,
		paths: api.paths,
		toast: api.toast,
		confetti: api.confetti,
		help: printHelp
	};

	try {
		printBanner();
	} catch {
		// consoles vary; the banner is decorative
	}
};
