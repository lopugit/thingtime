import React, { createContext } from 'react';
// @ts-ignore
import { parse as parseAux, stringify as stringifyAux } from 'flatted';
import { Subject } from 'rxjs';
import { thingtimeDefaults, thingtimeMinimumValues, thingtimeNewData, thingtimeOverwriteAll } from './Thingtime/ThingtimeDefaults';
import { sanitise } from '../functions/sanitise';
import { smarts } from '../smarts';
import { useThingtimeLine } from '~/hooks/useThingtimeMachine';
import type { PathArray, TimelineEvent } from '~/hooks/useThingtimeMachine';
import localforage from 'localforage';
import { safeJoin } from '~/utils';
import { createLatestRevisionAutosave } from './latestRevisionAutosave';
import type { LatestRevisionAutosaveCoordinator } from './latestRevisionAutosave';
import { drainThingtimeMutationQueue } from './thingtimeMutationQueue';
export interface ThingtimeTypes {
	thingtime: any;
	set: any;
	setThingtime: any;
	getThingtime: any;
	thingtimeRef: any;
	loading: boolean;
	paths: string[];
	events: Subject<any>;
}

export interface EverythingTypes {
	Everything: ThingtimeTypes;
}

export const ThingtimeContext = createContext<EverythingTypes | null>(null);

// wrap flatted parse and stringify with a function reviver and replacer

// exact Date.prototype.toISOString() shape — anything looser (e.g. "2024",
// "Post 1", "March 2024") passes lenient Date.parse and must stay a string
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const reviver = (key: string, value: any) => {
	// if value is a tagged Date, return it as a Date object
	if (value?.ttype === 'date') {
		if (typeof value.iso === 'string' && isoDatePattern.test(value.iso)) {
			return new Date(value.iso);
		}
		return value?.iso ?? value;
	}

	// legacy persisted Dates were stored as bare toISOString() strings
	if (typeof value === 'string' && isoDatePattern.test(value)) {
		return new Date(value);
	}

	// if value is a function, return it as a function
	if (value?.ttype === 'function') {
		try {
			const func = eval(value.code);
			if (typeof func === 'function') {
				if (value?.ttScope && typeof value.ttScope === 'object') {
					func.ttScope = value.ttScope;
				}

				// if the scope has keys
				// re-eval the function with these keyed values in a fake function scope
				if (Object.keys(func.ttScope || {}).length > 0) {
					const scopeKeys = Object.keys(func.ttScope);
					const newEval = `function scoper() {
						${scopeKeys.map((key) => `const ${key} = this.ttScope.${key};`).join('\n')}
						return ${value.code}
					}`;
					const scopedFunc = eval(newEval);
					scopedFunc.ttScope = func.ttScope;
					return scopedFunc;
				}

				return func;
			}
		} catch (err) {
			console.error('There was an error evaluating the function code:', err);
		}
		return function () {
			console.warn('Function could not be revived:', value.code);
		};
	}

	return value;
};

const replacer = function (this: any, key: string, value: any) {
	// flatted (like JSON.stringify) applies Date.prototype.toJSON before the
	// replacer runs, so `value` is already a string here — check the raw
	// value on the holder object instead
	const raw = this?.[key];

	// if the raw value is a Date, return it as an object with ttype and iso properties
	if (raw instanceof Date) {
		return {
			ttype: 'date',
			iso: raw.toISOString()
		};
	}

	// if value is a function, return it as an object with ttype and code properties
	if (typeof value === 'function') {
		return {
			ttype: 'function',
			code: value.toString(),
			ttScope: value?.ttScope || {}
		};
	}

	return value;
};

const parse = (text: string): any => {
	try {
		return parseAux(text, reviver);
	} catch (err) {
		console.error('There was an error parsing the thingtime data:', err);
		return null;
	}
};

const stringify = (data: any): string => {
	try {
		return stringifyAux(data, replacer);
	} catch (err) {
		console.error('There was an error stringifying the thingtime data:', err);
		return '';
	}
};

try {
	window.smarts = smarts;
	window.flatted = {
		parse,
		stringify
	};
} catch (err) {
	// nothing
}

export const ThingtimeProvider = (props: any): React.JSX.Element => {
	const [_Everything, setEverything] = React.useState<ThingtimeTypes>({
		thingtime: null,
		set: null,
		setThingtime: null,
		getThingtime: null,
		thingtimeRef: null,
		paths: null,
		loading: null,
		events: null
	});

	const EverythingRef = React.useRef(_Everything);
	const Everything: ThingtimeTypes = EverythingRef?.current;

	// TODO: work out why we are doing thingtimeRef and thingtimeRef ...... ? 😂
	const [thingtimeState, setThingtimeState] = React.useState({
		tt: null,
		thingtime: null,
		set: () => console.log('Please wait for Thingtime to load'),
		get: () => console.log('Please wait for Thingtime to load')
	});

	const thingtimeRef = React.useRef(thingtimeState);
	const hydrationResolvedRef = React.useRef(false);
	const persistenceReadyRef = React.useRef(false);
	const persistenceRevisionRef = React.useRef(0);
	const persistenceRef = React.useRef<LatestRevisionAutosaveCoordinator<any> | null>(null);
	if (!persistenceRef.current) {
		persistenceRef.current = createLatestRevisionAutosave<any, string>({
			debounceMs: 350,
			maxWaitMs: 2_000,
			serialize: (value) => {
				const serialized = stringify(value);
				if (!serialized) throw new Error('Thingtime autosave could not serialize the current value');
				return serialized;
			},
			write: async (serialized) => {
				await localforage.setItem('thingtime', serialized);
			},
			onError: (error, context) => {
				console.error(`[tt] Thingtime autosave ${context.phase} failed at revision ${context.revision}`, error);
			}
		});
	}

	const [loading, setLoading] = React.useState(true);

	const [events] = React.useState(() => new Subject());

	const undoRedo = useThingtimeLine(Everything);

	const setThingtimeObjectWrapper = React.useCallback((newThingtimeArg) => {
		const newThingtime = {
			...newThingtimeArg
		};

		newThingtime.tt = newThingtime;
		newThingtime.thingtime = newThingtime;

		// Keep queued mutations on the latest committed working snapshot even
		// before React has rendered the state update.
		thingtimeRef.current = newThingtime;
		setThingtimeState(newThingtime);
		return newThingtime;
	}, []);

	const restoreThingtime = React.useCallback(
		(nextThingtime) => {
			const newThingtime = smarts.merge({ ...(nextThingtime || {}) }, thingtimeDefaults);

			if (!newThingtime.Content) {
				newThingtime.Content = thingtimeDefaults.Content;
			}

			setThingtimeObjectWrapper(newThingtime);
		},
		[setThingtimeObjectWrapper]
	);

	type SetThingtimeOptions = {
		ignoreUndoRedo?: boolean;
		namespace?: string;
	};

	interface SetThingtimeProps {
		(path: PathArray, value: any, options?: SetThingtimeOptions): void;
	}

	interface ApplyThingtimeUpdateProps {
		(currentThingtime: any, path: PathArray, value: any, options: SetThingtimeOptions | undefined, timestamp: number): any;
	}

	type PendingThingtimeUpdate = {
		path: PathArray;
		value: any;
		options?: SetThingtimeOptions;
		timestamp: number;
	};

	// Keep the mutation queue outside React state. A keystroke should schedule
	// one batched microtask, not render once to enqueue and again to dequeue.
	const setThingtimeQueueRef = React.useRef<PendingThingtimeUpdate[]>([]);
	const setThingtimeFlushScheduledRef = React.useRef(false);
	const applyThingtimeUpdateRef = React.useRef<ApplyThingtimeUpdateProps | null>(null);

	const applyThingtimeUpdate = React.useCallback<ApplyThingtimeUpdateProps>(
		(
			currentThingtime,
			path,
			value,
			options = {
				ignoreUndoRedo: false,
				namespace: 'default'
			},
			timestamp
		) => {
			const { ignoreUndoRedo, namespace } = options;

			// is this a security concern do we need to sanitise the object reference?
			// if path is thingtime or tt, we can set the whole thingtime object ??? 🤔

			// TODO: make this a lot safer
			if (['thingtime', 'tt']?.includes(safeJoin(path))) {
				if (value) {
					console.warn('[tt] Replacing the complete Thingtime object at path', path);
					const replacement = { ...value };
					// A following update in the same microtask still needs the current
					// stable API methods before React has decorated the replacement.
					if (!replacement.set && currentThingtime?.set) replacement.set = currentThingtime.set;
					if (!replacement.get && currentThingtime?.get) replacement.get = currentThingtime.get;
					replacement.tt = replacement;
					replacement.thingtime = replacement;
					return replacement;
				}
			}

			const newThingtime: any = currentThingtime || {};

			const paths = path instanceof Array ? path : smarts.parsePropertyPath(path);

			// find first parent where a path is undefined
			// paths is array of path parts such as ["path1", "path2", "path3"]
			// we want to create a new reference at the first object which has an undefined part of the path
			// and is an object itself
			// so that react will detect the change and re-render
			// "path1" = { ...thingtime["path1"] } if path1.path2 undefined
			// "path1.path2" = { ...thingtime["path1"]["path2"] } if path1.path2.path3 undefined
			// "path1.path2.path3" = { ...thingtime["path1"]["path2"]["path3"] }
			// etc
			let done = false;
			paths.forEach((pathPart, index) => {
				if (!done) {
					const pathParts = paths.slice(0, index + 1);
					const tmpPath = pathParts.join('.');
					const parentPath = pathParts.slice(0, -1).join('.');

					const valAtPath = smarts.getsmart(newThingtime, tmpPath);

					if (parentPath) {
						if (typeof valAtPath !== 'object' || valAtPath === null) {
							const parentVal = smarts.getsmart(newThingtime, parentPath);
							if (typeof parentVal === 'object') {
								const newParent = Array.isArray(parentVal) ? [...parentVal] : { ...parentVal };
								smarts.setsmart(newThingtime, parentPath, newParent);
							}

							done = true;
						}
					}
				}
			});

			if (!ignoreUndoRedo) {
				// store undo/redo history
				const event: TimelineEvent = {
					path: path,
					value: value,
					namespace: namespace,
					fromValue: smarts.getsmart(currentThingtime, path),
					timestamp
				};
				undoRedo.current.addTimelineEvent(newThingtime, event);
			}

			// TODO: make thingtime settable
			newThingtime.thingtime = newThingtime;
			newThingtime.tt = newThingtime;

			smarts.setsmart(newThingtime, path, value);
			return newThingtime;
		},
		[undoRedo]
	);
	applyThingtimeUpdateRef.current = applyThingtimeUpdate;

	const flushSetThingtimeQueue = React.useCallback(() => {
		if (!hydrationResolvedRef.current) {
			setThingtimeFlushScheduledRef.current = false;
			return;
		}

		const queue = setThingtimeQueueRef.current;
		const result = drainThingtimeMutationQueue(
			thingtimeRef.current,
			queue,
			(workingThingtime, nextThingtime) =>
				applyThingtimeUpdateRef.current?.(
					workingThingtime,
					nextThingtime.path,
					nextThingtime.value,
					nextThingtime.options,
					nextThingtime.timestamp
				) ?? workingThingtime,
			(error) => console.error('[tt] There was an error applying a queued Thingtime update', error)
		);
		setThingtimeFlushScheduledRef.current = false;
		if (result.applied) setThingtimeObjectWrapper(result.state);
	}, [setThingtimeObjectWrapper]);

	const setThingtime = React.useCallback<SetThingtimeProps>(
		(
			path,
			value,
			options: SetThingtimeOptions = {
				ignoreUndoRedo: false,
				namespace: 'default'
			}
		) => {
			setThingtimeQueueRef.current.push({ path, value, options, timestamp: Date.now() });
			if (setThingtimeFlushScheduledRef.current) return;
			setThingtimeFlushScheduledRef.current = true;
			queueMicrotask(flushSetThingtimeQueue);
		},
		[flushSetThingtimeQueue]
	);

	const getThingtime = React.useCallback(
		(...args) => {
			const rawPath = args[0];
			const path = rawPath;

			if (!path) {
				return thingtimeState;
			}

			// do we need to sanitise?
			// const path = sanitise(rawPath)
			return smarts.getsmart(thingtimeState, path);
		},
		[thingtimeState]
	);

	const populatePaths = React.useCallback((obj, path, paths, seen = []) => {
		try {
			Object.keys(obj).forEach((key) => {
				const val = obj[key];
				const newPath = path ? `${path}${path ? '.' : ''}${key}` : key;
				if (typeof val === 'object') {
					paths.push(newPath);
					if (!seen?.includes(val)) {
						seen.push(val);
						populatePaths(val, newPath, paths, seen);
					}
				} else {
					paths.push(newPath);
				}
			});
		} catch {
			// nothing
		}
	}, []);

	const paths = React.useMemo(() => {
		// const paths = ["tt", "thingtime", "."]
		const paths = [];

		// populatePaths(thingtime, commandPath)
		populatePaths(thingtimeState, '', paths);

		return paths;
	}, [populatePaths, thingtimeState]);

	// get thingtime from localstorage
	React.useEffect(() => {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		let retryAttempt = 0;
		setLoading(true);

		const hydrate = async () => {
			try {
				const localStorageThingtime = await localforage.getItem('thingtime');
				if (cancelled) return;

				if (localStorageThingtime) {
					const parsed = typeof localStorageThingtime === 'string' ? parse(localStorageThingtime) : localStorageThingtime;

					if (parsed) {
						const localIsUptoDateVersion = !parsed.version || parsed.version >= thingtimeMinimumValues.version;
						let newThingtime = smarts.merge(thingtimeMinimumValues, thingtimeDefaults);

						if (localIsUptoDateVersion) {
							newThingtime = smarts.merge(parsed, newThingtime);
						} else {
							// Should this be
							// thingtimeNewData, parsed
							// or
							// parsed, thingtimeNewData

							const withVersionUpdates = smarts.merge(thingtimeNewData, parsed);
							newThingtime = smarts.merge(thingtimeMinimumValues, withVersionUpdates);
						}

						newThingtime = smarts.merge(newThingtime, thingtimeOverwriteAll, {
							overwriteAll: true
						});

						restoreThingtime(newThingtime);
					} else {
						throw new Error('Stored Thingtime value could not be parsed');
					}
				} else {
					restoreThingtime(thingtimeDefaults);
				}

				persistenceReadyRef.current = true;
			} catch (err) {
				if (cancelled) return;
				console.error('There was an error getting thingtime from localStorage', err);
				retryAttempt += 1;
				const retryDelay = Math.min(250 * 2 ** (retryAttempt - 1), 5_000);
				// Do not expose an apparently editable but permanently non-persistent
				// placeholder. Keep hydration pending and retry without overwriting the
				// unread stored value; edits attempted meanwhile remain queued in order.
				retryTimer = setTimeout(() => void hydrate(), retryDelay);
				return;
			}

			if (cancelled) return;
			hydrationResolvedRef.current = true;
			setLoading(false);
			// Inputs fired during hydration were held in order. Apply them on top of
			// the restored root rather than letting a late load overwrite the edit.
			if (setThingtimeQueueRef.current.length > 0) queueMicrotask(flushSetThingtimeQueue);
		};

		void hydrate();

		return () => {
			cancelled = true;
			clearTimeout(retryTimer);
		};
	}, [flushSetThingtimeQueue, restoreThingtime]);

	// thingtime change listener
	React.useEffect(() => {
		try {
			window.setThingtime = setThingtime;
			window.getThingtime = getThingtime;
			window.thingtime = thingtimeState;
			window.tt = thingtimeState;
			window.events = events;
		} catch {
			// nothing
		}

		// Never persist the temporary pre-hydration value. In development React
		// replays effects, so a one-shot "skip the first effect" flag can otherwise
		// schedule that placeholder state before LocalForage finishes loading.
		if (!loading && persistenceReadyRef.current) {
			persistenceRevisionRef.current += 1;
			persistenceRef.current?.schedule(thingtimeState, persistenceRevisionRef.current);
		}

		thingtimeRef.current = thingtimeState;

		// not sure why this used to have @undoRedoEventKeyShortcutEventListener here.. ?
	}, [setThingtime, events, getThingtime, loading, thingtimeState, setThingtimeObjectWrapper]);

	React.useEffect(() => {
		const persistence = persistenceRef.current;
		const flushPersistence = () => {
			void persistence?.flush().catch(() => {
				// The coordinator retains dirty state and already reports the error.
			});
		};
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') flushPersistence();
		};

		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', flushPersistence);
		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('pagehide', flushPersistence);
			// React Strict Mode replays effect cleanup/setup without remounting refs.
			// Flush here, but keep the coordinator live for the replayed setup.
			if (persistence) void persistence.flush().catch(() => {});
		};
	}, []);

	if (thingtimeState) {
		// @ts-expect-error property get/set does not exist or something?
		thingtimeState.set = setThingtime;
		thingtimeState.get = getThingtime;
	}

	// watch all the exported values and reset on Everything if they change
	React.useEffect(() => {
		const newEverything = {
			thingtime: thingtimeState,
			setThingtime: setThingtime,
			getThingtime: getThingtime,
			thingtimeRef: thingtimeRef,
			paths: paths,
			loading: loading,
			events: events
		};

		// ⚠️ ORDER OF THESE OPERATIONS IS IMPORTANT ⚠️
		// 1
		Object.assign(EverythingRef.current, newEverything); // 1

		// ⚠️ ORDER OF THESE OPERATIONS IS IMPORTANT ⚠️
		// 2
		setEverything(EverythingRef.current); // 2
	}, [thingtimeState, setThingtime, getThingtime, thingtimeRef, paths, loading, events]);

	Object.assign(Everything, {
		thingtime: thingtimeState,
		setThingtime: setThingtime,
		getThingtime: getThingtime,
		thingtimeRef: thingtimeRef,
		paths: paths,
		loading: loading,
		events: events
	});

	return <ThingtimeContext.Provider value={{ Everything }}>{props?.children}</ThingtimeContext.Provider>;
};
