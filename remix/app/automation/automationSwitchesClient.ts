import {
	DEFAULT_AUTOMATION_SWITCHES,
	automationSwitchFor,
	normalizeAutomationSwitches,
	type AutomationSwitchId,
	type AutomationSwitchState
} from './automationSwitches';

/**
 * Browser copy of the administrator Automation switches. Until the server
 * answers, everything is off (or the last answer this browser saw, from
 * localStorage, so first paint matches the previous visit). The switches are
 * read once per page load and again when the window comes back to the
 * foreground (at most every ten minutes) — never on a timer.
 */
export type AutomationSwitchesEnvironment = {
	fetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
	storage?: () => Pick<Storage, 'getItem' | 'setItem'> | undefined;
	now: () => number;
	onReturn?: (listener: () => void) => () => void;
};

const STORAGE_KEY = 'tt-automation-switches:v1';
export const AUTOMATION_SWITCHES_PATH = '/api/v1/automation/switches';
const REFRESH_ON_RETURN_MS = 10 * 60_000;

export function createAutomationSwitchesClient(env: AutomationSwitchesEnvironment) {
	let state: AutomationSwitchState = DEFAULT_AUTOMATION_SWITCHES;
	let lastRead = -Infinity;
	let reading: Promise<void> | null = null;
	let started = false;
	const listeners = new Set<() => void>();
	try {
		const saved = env.storage?.()?.getItem(STORAGE_KEY);
		if (saved) state = normalizeAutomationSwitches(JSON.parse(saved));
	} catch {
		/* unreadable cache: stay all-off */
	}
	const publish = (next: AutomationSwitchState) => {
		if (Object.keys(next).every((id) => next[id] === state[id])) return;
		state = next;
		try {
			env.storage?.()?.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			/* storage is a convenience; the live state still applies */
		}
		for (const listener of listeners) listener();
	};
	const refresh = (): Promise<void> => {
		if (reading) return reading;
		lastRead = env.now();
		reading = (async () => {
			try {
				const response = await env.fetch(AUTOMATION_SWITCHES_PATH);
				const body = (await response.json()) as { ok?: unknown; switches?: unknown } | null;
				// A failed read keeps the current state; it never switches work on.
				if (response.ok && body?.ok === true) publish(normalizeAutomationSwitches(body.switches));
			} catch {
				/* keep the current state */
			} finally {
				reading = null;
			}
		})();
		return reading;
	};
	const start = () => {
		if (started) return;
		started = true;
		void refresh();
		env.onReturn?.(() => {
			if (env.now() - lastRead >= REFRESH_ON_RETURN_MS) void refresh();
		});
	};
	return {
		read: () => state,
		enabled: (id: AutomationSwitchId) => state[id] === true,
		/** Whether repeating work owned by this activity id or refresh key may run. */
		allows: (activityId: string) => state[automationSwitchFor(activityId)] === true,
		subscribe(listener: () => void) {
			start();
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		start,
		refresh,
		/** Applies a state the administrator editor just saved. */
		apply: (next: unknown) => publish(normalizeAutomationSwitches(next))
	};
}

let browserClient: ReturnType<typeof createAutomationSwitchesClient> | undefined;
export function automationSwitches() {
	browserClient ??= createAutomationSwitchesClient({
		fetch: (url) => (typeof window === 'undefined' ? Promise.reject(new Error('No browser')) : window.fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } })),
		storage: () => (typeof window === 'undefined' ? undefined : window.localStorage),
		now: Date.now,
		onReturn: (listener) => {
			if (typeof document === 'undefined') return () => {};
			const visible = () => {
				if (document.visibilityState === 'visible') listener();
			};
			document.addEventListener('visibilitychange', visible);
			return () => document.removeEventListener('visibilitychange', visible);
		}
	});
	if (typeof window !== 'undefined') browserClient.start();
	return browserClient;
}
