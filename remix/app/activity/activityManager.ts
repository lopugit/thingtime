import { userPresence } from './userPresence';
import { automationSwitches } from '../automation/automationSwitchesClient';

/** Explicit, device-local ownership of background work. No global timer or
 * EventTarget monkey-patching: disabling an entry invokes its real cleanup. */
export type ActivityKind = 'polling' | 'schedule' | 'watcher' | 'listener' | 'event';
/** `background` work keeps running while the window is hidden. `local` work
 * (on-screen clocks, codes, device-local reads) keeps running while the user is
 * idle; every other polling activity pauses until they interact again. */
export type ActivitySpec = { id: string; title: string; kind: ActivityKind; detail?: string; background?: boolean; essential?: boolean; local?: boolean };
export type ActivityRow = ActivitySpec & {
	enabled: boolean;
	instances: number;
	running: number;
	calls: number;
	failures: number;
	lastRun: number | null;
	durationMs: number;
	state: string;
};
type Instance = { spec: ActivitySpec; start: (signal: AbortSignal) => void | (() => void); controller?: AbortController; cleanup?: () => void };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'tt-background-activities:v1';

export function createActivityManager(
	options: {
		storage?: () => Store | undefined;
		hidden?: () => boolean;
		idle?: () => boolean;
		/** True when an administrator's Automation switch turns this work off. */
		blocked?: (spec: ActivitySpec) => boolean;
		now?: () => number;
		notify?: (callback: () => void) => void;
	} = {}
) {
	const definitions = new Map<string, ActivityRow>(),
		instances = new Set<Instance>(),
		subscribers = new Set<() => void>();
	let disabled = new Set<string>(),
		loaded = false,
		queued = false,
		dirty = false,
		snapshot: readonly ActivityRow[] = [];
	const now = options.now ?? Date.now;
	const load = () => {
		if (loaded) return;
		loaded = true;
		try {
			const value = JSON.parse(options.storage?.()?.getItem(KEY) || '[]');
			if (Array.isArray(value)) disabled = new Set(value.filter((x) => typeof x === 'string'));
		} catch {
			/* fail open for existing operation; writes report errors */
		}
	};
	const publish = () => {
		dirty = true;
		if (!subscribers.size || queued) return;
		queued = true;
		(options.notify ?? queueMicrotask)(() => {
			queued = false;
			for (const fn of subscribers) fn();
		});
	};
	const update = (id: string) => {
		const row = definitions.get(id)!;
		const owned = [...instances].filter((item) => item.spec.id === id);
		row.instances = owned.length;
		row.running = owned.filter((item) => !!item.controller).length;
		row.enabled = row.essential || !disabled.has(id);
		row.state = !row.enabled
			? 'Disabled until you enable it'
			: owned.length && switchedOff(row)
			? 'Turned off by an administrator'
			: !owned.length
			? 'Idle — no mounted owner'
			: !row.running
			? options.hidden?.() || !options.idle?.()
				? 'Waiting while this window is hidden'
				: 'Paused until you use Thingtime again'
			: 'Active';
		publish();
	};
	const stop = (instance: Instance, reason = 'disposed') => {
		instance.controller?.abort(reason);
		instance.controller = undefined;
		const cleanup = instance.cleanup;
		instance.cleanup = undefined;
		try {
			cleanup?.();
		} catch {
			definitions.get(instance.spec.id)!.failures++;
		}
	};
	// Network polling waits while nobody is using the window; it resumes (with an
	// immediate catch-up, see activityInterval) on the next interaction.
	// Administrator Automation switches stop repeating network work only;
	// device-local timers and lifecycle guards are never switched off.
	const switchedOff = (spec: ActivitySpec) => spec.kind === 'polling' && !spec.local && !spec.essential && !!options.blocked?.(spec);
	const idlePaused = (spec: ActivitySpec) => spec.kind === 'polling' && !spec.background && !spec.local && !!options.idle?.();
	const reconcile = (instance: Instance) => {
		const paused = idlePaused(instance.spec);
		const off = switchedOff(instance.spec);
		const shouldRun = (instance.spec.essential || !disabled.has(instance.spec.id)) && (instance.spec.background || !options.hidden?.()) && !paused && !off;
		if (!shouldRun) stop(instance, disabled.has(instance.spec.id) ? 'disabled' : off ? 'switched-off' : paused && !options.hidden?.() ? 'idle' : 'hidden');
		else if (!instance.controller) {
			instance.controller = new AbortController();
			try {
				instance.cleanup = instance.start(instance.controller.signal) || undefined;
			} catch {
				instance.controller.abort();
				instance.controller = undefined;
				definitions.get(instance.spec.id)!.failures++;
			}
		}
		update(instance.spec.id);
	};
	const manager = {
		read: () => {
			if (dirty) {
				snapshot = [...definitions.values()].map((row) => ({ ...row })).sort((a, b) => a.title.localeCompare(b.title));
				dirty = false;
			}
			return snapshot;
		},
		subscribe(fn: () => void) {
			subscribers.add(fn);
			return () => {
				subscribers.delete(fn);
			};
		},
		enabled(id: string) {
			load();
			return !disabled.has(id);
		},
		define(spec: ActivitySpec) {
			load();
			if (!definitions.has(spec.id)) {
				definitions.set(spec.id, {
					...spec,
					enabled: !disabled.has(spec.id),
					instances: 0,
					running: 0,
					calls: 0,
					failures: 0,
					lastRun: null,
					durationMs: 0,
					state: !spec.essential && disabled.has(spec.id) ? 'Disabled until you enable it' : 'Idle — no mounted owner'
				});
				publish();
			}
		},
		register(spec: ActivitySpec, start: Instance['start']) {
			load();
			if (!definitions.has(spec.id))
				definitions.set(spec.id, {
					...spec,
					enabled: !disabled.has(spec.id),
					instances: 0,
					running: 0,
					calls: 0,
					failures: 0,
					lastRun: null,
					durationMs: 0,
					state: 'Idle'
				});
			const instance: Instance = { spec, start };
			instances.add(instance);
			reconcile(instance);
			let disposed = false;
			return () => {
				if (disposed) return;
				disposed = true;
				stop(instance);
				instances.delete(instance);
				update(spec.id);
			};
		},
		setEnabled(id: string, enabled: boolean) {
			load();
			if (definitions.get(id)?.essential) throw Error('This lifecycle guard is required for safe cleanup.');
			const next = new Set(disabled);
			if (enabled) next.delete(id);
			else next.add(id);
			const storage = options.storage?.();
			if (!storage) throw Error('Persistent activity preferences are unavailable.');
			storage.setItem(KEY, JSON.stringify([...next])); // persistence must succeed before changing live work
			disabled = next;
			for (const instance of instances) if (instance.spec.id === id) reconcile(instance);
			if (definitions.has(id)) update(id);
		},
		reload() {
			loaded = false;
			load();
			for (const instance of instances) reconcile(instance);
			for (const id of definitions.keys()) update(id);
		},
		visibilityChanged() {
			for (const instance of instances) reconcile(instance);
		},
		async run(id: string, callback: () => unknown) {
			const row = definitions.get(id),
				started = now();
			if (row) {
				row.calls++;
				row.lastRun = started;
			}
			try {
				return await callback();
			} catch (error) {
				if (row) row.failures++;
				throw error;
			} finally {
				if (row) row.durationMs += Math.max(0, now() - started);
				publish();
			}
		}
	};
	return manager;
}

export const activityManager = createActivityManager({
	storage: () => (typeof window === 'undefined' ? undefined : window.localStorage),
	hidden: () => typeof document !== 'undefined' && document.hidden,
	idle: () => userPresence()?.isIdle() ?? false,
	blocked: (spec) => !automationSwitches().allows(spec.id),
	// Coalesce UI notifications; this timer exists only while there are subscribers.
	notify: (callback) => setTimeout(callback, 250)
});
let lifecycleStarted = false;
function lifecycle() {
	if (lifecycleStarted || typeof window === 'undefined') return;
	lifecycleStarted = true;
	activityManager.register(
		{
			id: 'activity.visibility',
			title: 'Window visibility lifecycle',
			kind: 'listener',
			essential: true,
			background: true,
			detail: 'Releases hidden-view timers and restores visible-view work.'
		},
		() => {
			const changed = () => activityManager.visibilityChanged();
			document.addEventListener('visibilitychange', changed);
			return () => document.removeEventListener('visibilitychange', changed);
		}
	);
	activityManager.register(
		{
			id: 'activity.presence',
			title: 'Pause updates while nobody is using Thingtime',
			kind: 'listener',
			essential: true,
			background: true,
			detail: 'Stops network polling after two minutes without interaction and refreshes on your next interaction.'
		},
		() => userPresence()?.subscribe(() => activityManager.visibilityChanged())
	);
	activityManager.register(
		{
			id: 'activity.automation-switches',
			title: 'Administrator automation switches',
			kind: 'listener',
			essential: true,
			background: true,
			detail: 'Stops or resumes repeating network work when an administrator changes its Automation switch.'
		},
		() => automationSwitches().subscribe(() => activityManager.visibilityChanged())
	);
	activityManager.register(
		{
			id: 'activity.preferences',
			title: 'Activity preference changes',
			kind: 'listener',
			essential: true,
			background: true,
			detail: 'Applies durable disable choices across windows.'
		},
		() => {
			const changed = (event: StorageEvent) => {
				if (event.key === KEY) activityManager.reload();
			};
			window.addEventListener('storage', changed);
			return () => window.removeEventListener('storage', changed);
		}
	);
}
let nextTimer = -1;
const timers = new Map<number, () => void>();
export type ActivityIntervalOptions = { background?: boolean; local?: boolean };
/** Stable source IDs persist choices across mounts and app updates. Async
 * callbacks never overlap. Hidden windows release their actual interval, and
 * so do idle ones unless the work is `local`. Restarting after either pause
 * runs the callback at once, so returning users see current data. */
export function activityInterval(
	id: string,
	title: string,
	callback: () => unknown,
	milliseconds: number,
	options: boolean | ActivityIntervalOptions = false
): number {
	lifecycle();
	const { background = false, local = false } = typeof options === 'boolean' ? { background: options } : options;
	const token = nextTimer--;
	let inFlight = false;
	let starts = 0;
	timers.set(
		token,
		activityManager.register(
			{
				id,
				title,
				kind: 'polling',
				detail: `Repeats every ${milliseconds / 1000} seconds while its view is ${local ? 'open' : 'in use'}.`,
				background,
				local
			},
			(signal) => {
				const tick = () => {
					if (inFlight || signal.aborted) return;
					inFlight = true;
					void activityManager
						.run(id, callback)
						.catch(() => {})
						.finally(() => {
							inFlight = false;
						});
				};
				// The owner runs its own first load; later starts are resumes.
				if (starts++ > 0) tick();
				const timer = globalThis.setInterval(tick, milliseconds);
				return () => globalThis.clearInterval(timer);
			}
		)
	);
	return token;
}
export function clearActivityInterval(token: unknown) {
	const dispose = timers.get(token as number);
	if (dispose) {
		timers.delete(token as number);
		dispose();
	} else globalThis.clearInterval(token as ReturnType<typeof setInterval>);
}
export function activityListener(
	id: string,
	title: string,
	target: EventTarget,
	type: string,
	callback: EventListener,
	options?: AddEventListenerOptions | boolean
) {
	lifecycle();
	return activityManager.register({ id, title, kind: 'listener', detail: `Subscribes to ${type} events.`, background: true }, () => {
		const listener: EventListener = (event) => {
			void activityManager.run(id, () => callback(event)).catch(() => {});
		};
		target.addEventListener(type, listener, options);
		return () => target.removeEventListener(type, listener, options);
	});
}

type EventRecord = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean; dispose: () => void };
const eventRecords = new WeakMap<EventTarget, Map<string, EventRecord[]>>();
/** An explicitly imported facade keeps ordinary add/remove semantics and stable
 * source ownership; it does not replace Window/Document prototypes. */
export function activityEvents<T extends EventTarget>(target: T, id: string, title: string): Pick<T, 'addEventListener' | 'removeEventListener'> {
	let sources = eventRecords.get(target);
	if (!sources) {
		sources = new Map();
		eventRecords.set(target, sources);
	}
	let records = sources.get(id);
	if (!records) {
		records = [];
		sources.set(id, records);
	}
	const capture = (options?: boolean | AddEventListenerOptions) => (typeof options === 'boolean' ? options : !!options?.capture);
	const remove = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
		const index = records!.findIndex((row) => row.type === type && row.listener === listener && row.capture === capture(options));
		if (index < 0) return;
		const [record] = records!.splice(index, 1);
		record.dispose();
	};
	return {
		addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
			if (!listener || (typeof options === 'object' && options.signal?.aborted)) return;
			lifecycle();
			if (records!.some((row) => row.type === type && row.listener === listener && row.capture === capture(options))) return;
			const essential = ['pagehide', 'beforeunload', 'visibilitychange', 'abort'].includes(type);
			const dispose = activityManager.register(
				{
					id: `${id}:${type}`,
					title: `${title} · ${type}`,
					kind: 'listener',
					background: true,
					essential,
					detail: essential
						? 'Required lifecycle cleanup; prevents stale work or data from surviving a context change.'
						: `Subscribes to ${type} events while its owner is mounted.`
				},
				() => {
					const callback: EventListener = (event) => {
						void activityManager
							.run(`${id}:${type}`, () => (typeof listener === 'function' ? listener.call(target, event) : listener.handleEvent(event)))
							.catch(() => {});
						if (typeof options === 'object' && options.once) remove(type, listener, options);
					};
					target.addEventListener(type, callback, options);
					return () => target.removeEventListener(type, callback, options);
				}
			);
			const record = { type, listener, capture: capture(options), dispose };
			records!.push(record);
			if (typeof options === 'object' && options.signal) {
				const aborted = () => remove(type, listener, options);
				options.signal.addEventListener('abort', aborted, { once: true });
				record.dispose = () => {
					options.signal!.removeEventListener('abort', aborted);
					dispose();
				};
			}
		},
		removeEventListener: remove
	} as Pick<T, 'addEventListener' | 'removeEventListener'>;
}
