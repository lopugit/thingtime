import React, { createContext } from 'react';
// @ts-ignore
import { parse as parseAux, stringify as stringifyAux } from 'flatted';
import { Subject } from 'rxjs';
import { thingtimeDefaults, thingtimeMinimumValues, thingtimeNewData, thingtimeOverwriteAll } from './Thingtime/ThingtimeDefaults';
import { sanitise } from '../functions/sanitise';
import { smarts } from '../smarts';
import { TimelineEvent, useThingtimeLine } from '~/hooks/useThingtimeMachine';
import localforage from 'localforage';
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

const reviver = (key: string, value: any) => {
	// if value is a Date, return it as a Date object
	if (typeof value === 'string' && !isNaN(Date.parse(value))) {
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

const replacer = (key: string, value: any) => {
	// if value is a Date, return it as a string
	if (value instanceof Date) {
		return value.toISOString();
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

export const ThingtimeProvider = (props: any): JSX.Element => {
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
	const stateRef: any = React.useRef({
		c: 1
	});

	const [loading, setLoading] = React.useState(true);

	const [events, setEvents] = React.useState(null);

	if (!events) {
		setEvents(() => new Subject());
	}

	const undoRedo = useThingtimeLine(Everything);

	stateRef.current.undoRedo = undoRedo;

	const setThingtimeObjectWrapper = React.useCallback((newThingtimeArg) => {
		const newThingtime = {
			...newThingtimeArg
		};

		newThingtime.tt = newThingtime;
		newThingtime.thingtime = newThingtime;

		setThingtimeState(newThingtime);
	}, []);

	// create a setThingtime queue so we can batch process race conditions
	// instead of loosing data like before

	const [setThingtimeQueue, setThingtimeQueueSetter] = React.useState([]);

	const setThingtimeQueueRef = React.useRef(setThingtimeQueue);
	setThingtimeQueueRef.current = setThingtimeQueue;

	React.useEffect(() => {
		if (setThingtimeQueue.length > 0) {
			// process one queue item at a time
			const nextThingtime = setThingtimeQueueRef.current[0];
			setThingtimeQueueSetter((prev) => prev.slice(1));
			setThingtimeAux(nextThingtime.path, nextThingtime.value, nextThingtime.options);
		}
	}, [setThingtimeQueue, setThingtimeObjectWrapper]);

	interface setThingtimeProps {
		(
			path: string,
			value: any,
			options?: {
				ignoreUndoRedo?: boolean;
				namespace?: string;
			}
		): void;
	}

	const setThingtime = React.useCallback(
		(
			path,
			value,
			options = {
				ignoreUndoRedo: false,
				namespace: 'default'
			}
		): setThingtimeProps => {
			setThingtimeQueueSetter((prev) => [...prev, { path, value, options }]);
			return;
		},
		[]
	);

	const setThingtimeAux = React.useCallback(
		(
			path,
			value,
			options = {
				ignoreUndoRedo: false,
				namespace: 'default'
			}
		): setThingtimeProps => {
			const { ignoreUndoRedo, namespace } = options;

			// is this a security concern do we need to sanitise the object reference?
			// if path is thingtime or tt, we can set the whole thingtime object ??? 🤔

			// TODO: make this a lot safer
			if (['thingtime', 'tt']?.includes(path)) {
				if (value) {
					console.log(
						'[tt][ThingtimeProvider.tsx/setThingtime() ⚠️ called with Path:',
						path,
						'which will completely overwrite your thingtime object:',
						value
					);
					setThingtimeObjectWrapper(value);
					return;
				}
			}

			const time = Date.now();

			const newThingtime: any = thingtimeState || {};

			console.log(
				'[tt][ThingtimeProvider.tsx/setThingtime() called with Path:',
				path,
				'which will be set to this value:',
				value,
				'this is the new Thingtime:',
				newThingtime
			);

			const paths = smarts.parsePropertyPath(path);

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
					fromValue: smarts.getsmart(thingtimeState, path),
					timestamp: time
				};
				console.log('[tt][ThingtimeProvider.tsx/setThingtime() adding timeline event', event);
				console.log('[tt][ThingtimeProvider.tsx/setThingtime() undoRedo.current.addTimelineEvent(newThingtime, event)');
				undoRedo.current.addTimelineEvent(newThingtime, event);
			}

			// TODO: make thingtime settable
			newThingtime.thingtime = newThingtime;
			newThingtime.tt = newThingtime;

			smarts.setsmart(newThingtime, path, value);

			setThingtimeObjectWrapper(newThingtime);
		},
		[thingtimeState, setThingtimeObjectWrapper]
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
			console.log('[tt][ThingtimeProvider.tsx] getting thing at path', path, 'with Thingtime being: ', thingtimeState);
			// console.trace("Getting thingtime at path", path)
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
		setLoading(true);

		(async () => {
			try {
				const localStorageThingtime = await localforage.getItem('thingtime');

				console.log('[tt][ThingtimeProvider.tsx] localStorageThingtime', localStorageThingtime);

				if (localStorageThingtime) {
					const thingtimeFromLocalStorage = typeof localStorageThingtime === 'string' ? localStorageThingtime : '';
					const parsed = parse(thingtimeFromLocalStorage);

					if (parsed) {
						const localIsUptoDateVersion = !parsed.version || parsed.version >= thingtimeMinimumValues.version;
						let newThingtime = smarts.merge(thingtimeMinimumValues, thingtimeDefaults);

						if (localIsUptoDateVersion) {
							console.log('[tt][ThingtimeProvider.tsx] String 📝 Above 🔝 after converting to object: {}', parsed);
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

						console.log('[tt][ThingtimeProvider.tsx] restoring thingtime from localStorage. Thingtime: ', newThingtime);
						// TODO: does this need to
						// specifically ignore undo redo calls
						setThingtime('thingtime', newThingtime, {
							ignoreUndoRedo: true,
							namespace: 'tt.localStorage-restore'
						});
					}
				} else {
					// TODO: does this need to
					// specifically ignore undo redo calls
					setThingtime(thingtimeDefaults, {
						ignoreUndoRedo: true,
						namespace: 'tt.localStorage-restore'
					});
				}
			} catch (err) {
				console.error('There was an error getting thingtime from localStorage');
			}

			setLoading(false);
		})();
	}, []);

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

		if (stateRef.current.initialized) {
			try {
				console.log('[tt][ThingtimeProvider.tsx] setting thingtime to localStorage', thingtimeState);
				// setTimeout(() => {
				const stringified = stringify(thingtimeState);
				// TODO: check if doing this asynchronously is safe...
				// or causing issues in general....
				localforage.setItem('thingtime', stringified);
				// }, 600)
			} catch (err) {
				console.error('There was an error saving thingtime to localStorage', err);
			}
		} else {
			stateRef.current.initialized = true;
		}

		thingtimeRef.current = thingtimeState;

		// not sure why this used to have @undoRedoEventKeyShortcutEventListener here.. ?
	}, [setThingtime, events, getThingtime, thingtimeState, setThingtimeObjectWrapper]);

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

	console.log('nik Everything', Everything);

	return <ThingtimeContext.Provider value={{ Everything }}>{props?.children}</ThingtimeContext.Provider>;
};
