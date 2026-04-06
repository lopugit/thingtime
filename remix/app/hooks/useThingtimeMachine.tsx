import React from 'react';
import { smarts } from '../smarts';
import localforage from 'localforage';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { parse, stringify } from 'flatted';

// @ts-ignore
const undoRedoLogger = console?.with?.({ context: 'undo' }) || console;

try {
	window.eventchain = window.eventchain || [];
} catch (err) {}

// event type
// basically this:
// path: path,
// value: value,
// namespace: options?.namespace,
// fromValue: smarts.getsmart(thingtimeState, path),
// timestamp: time

export type PathArray = string | string[];

export interface TimelineEvent {
	path: PathArray;
	value: any;
	namespace?: string;
	fromValue?: any;
	timestamp?: number;
	// additional properties can be added as needed
}

// ™
export const useThingtimeLine = (Everything) => {
	// NOTE:
	// { thingtime } = Everything !== Everything.thingtime in all cases
	// Use Everything.thingtime
	// const { thingtime } = Everything;

	console.info('[tt][useThingtimeLine.tsx/useThingtimeLine()] NEW 🔥 CYCLE Everything:', Everything);
	console.info('[tt][useThingtimeLine.tsx/useThingtimeLine()] NEW 🔥 CYCLE Everything.thingtime:', Everything.thingtime);

	const shortcuts = React.useState({
		undo: {
			key: 'z',
			ctrlKey: true,
			shiftKey: false
		},
		redo: {
			key: 'z',
			ctrlKey: true,
			shiftKey: true
		}
	});

	const addTimelineEvent = React.useCallback(async (thingtimeWeAreAddingTimelineEventToo, event: TimelineEvent) => {
		try {
			// what caused addTimelineEvent to be called?
			console.info('[tt][useThingtimeLine.tsx/addTimelineEvent] called');

			console.info('[tt][useThingtimeLine.tsx/addTimelineEvent] event', event);
			console.info('[tt][useThingtimeLine.tsx/addTimelineEvent] PRE-wrap thingtime.timemachine', thingtimeWeAreAddingTimelineEventToo.timemachine);
			const timemachine = ThingtimeLine(thingtimeWeAreAddingTimelineEventToo.timemachine);

			console.info('[tt][useThingtimeLine.tsx/addTimelineEvent] POST-wrap timemachine', timemachine);
			console.info('[tt][useThingtimeLine.tsx/addTimelineEvent] event.namespace', event?.namespace);
			const timeline = timemachine.getTimeline(event?.namespace || 'default');

			console.info('[tt][useThingtimeLine.tsx/addTimelineEvent] timeline', timeline);
			// return;

			timeline.addEvent(event);

			thingtimeWeAreAddingTimelineEventToo.timemachine = timemachine;

			// log timemachine and timeline

			thingtimeWeAreAddingTimelineEventToo.set('timemachine', timemachine, {
				ignoreUndoRedo: true
			});
		} catch (err) {
			undoRedoLogger.error('[tt][useThingtimeline.tsx] There was an error adding new state to the undoRedo object', err);
		}
	}, []);

	// Add a listener for the undo/redo key shortcuts
	React.useEffect(() => {
		const keyListener = (e) => {
			// @undoRedoEventKeyShortcutEventListener
			// if ctrl + z, restore thingtime from localstorage timeline

			if ((e?.ctrlKey || e?.metaKey) && e?.key === 'z') {
				e?.preventDefault();

				const eventType = e.shiftKey ? 'redo' : 'undo';
				const undoEvent = eventType === 'undo';
				const redoEvent = eventType === 'redo';
				const eventName = `thingtime.${eventType}`;
				// TODO: pull this from thingtime settings
				const namespace = 'user';

				// // start console log level
				// console.group('ThingtimeProvider detected', eventType);

				try {
					// REDO action
					// if shift key is pressed
					// because if shift key is pressed then it's a redo action
					// so this is ctrl + shift + z / cmd + shift + z
					if (redoEvent) {
						undoRedoLogger.log('[tt][useThingtimeline.tsx] running redo');
						redo(namespace);
					}

					// UNDO action
					// if shift key is not pressed
					// because if shift key is pressed then it's a redo action
					// so this is just ctrl + z / cmd + z
					if (undoEvent) {
						undoRedoLogger.log('[tt][useThingtimeline.tsx] running undo');
						undo(namespace);
					}
				} catch (err) {
					undoRedoLogger.error('[tt][useThingtimeline.tsx] There was an error running the  action', err);
				}
			}
		};

		window.addEventListener('keydown', keyListener);

		return () => {
			window.removeEventListener('keydown', keyListener);
		};
	}, [Everything]);

	const undo = React.useCallback(
		async (namespace: string = 'user') => {
			try {
				window.undoThingtime = window.undoThingtime || Everything.thingtime;
				// undoRedoLogger.log('[tt][useThingtimeline.tsx] undo function thingtime', Everything.thingtime);
				const timemachine = ThingtimeLine(Everything.thingtime.timemachine);
				const gottenTimeline = timemachine.getTimeline(namespace);
				console.info(
					'[tt][useThingtimeline.tsx][undo = useCallback] gottenTimeline:',
					gottenTimeline,
					'for namespace:',
					namespace,
					'and thingtime:',
					Everything.thingtime
				);

				// return;

				const timeline = newTimeline(namespace, gottenTimeline);

				const past = timeline.past;
				const present = timeline.present;
				const future = timeline.future;

				// log past , present, future
				console.info('[tt][useThingtimeline.tsx][undo = useCallback] past:', past);
				console.info('[tt][useThingtimeline.tsx][undo = useCallback] present:', present);
				console.info('[tt][useThingtimeline.tsx][undo = useCallback] future:', future);

				if (past.length === 0) {
					undoRedoLogger.warn('[tt][useThingtimeline.tsx] No past states to undo to');
					return;
				}
				undoRedoLogger.log('[tt][useThingtimeline.tsx] current timeline:', timeline);

				// TODO: this has not been changed to the new event
				// with a path based system for efficiency increase

				// Get the last state from the past
				// const newThingtime: any = past[past.length - 1];
				// ^^^ Instead of doing this, we have switched to a new event schema which includes a "path"
				const pastEvent: TimelineEvent = past[past.length - 1];
				// Remove the last state from the past
				const newPast = past.slice(0, -1);

				timeline.past = newPast;

				// Set the present state to the last state
				timeline.present = pastEvent;
				// timeline.past = past.slice(0, -1);
				// Add the current present state to the future
				future.push(present);

				timemachine.addTimeline(namespace, timeline);

				// log the timeline passed and the timemachine object
				console.info('[tt][useThingtimeline.tsx] new timeline:', timeline);
				console.info('[tt][useThingtimeline.tsx] new timemachine:', timemachine);

				// get path, value from pastEvent
				// use this event, we run a set to restore
				// the paths value at this undo/redo state
				// we use value here because we fetched a pastEvent not current
				// even though on current the fromValue would be the same
				// you can use either, but the undo / redo stack
				// will not be properly affected if you just use the present state fromValue to step backwards
				// this helps implemented linked list rather than solid state undo/redo stack
				// log the pastEvent.path and pastEvent.value at this moment
				console.info('[tt][useThingtimeline.tsx] pastEvent.path:', pastEvent.path);
				console.info('[tt][useThingtimeline.tsx] pastEvent.value:', pastEvent.value);
				console.info('[tt][useThingtimeline.tsx] pastEvent.fromValue:', pastEvent.fromValue);
				Everything.thingtime.set(pastEvent.path, pastEvent.value, {
					ignoreUndoRedo: true,
					namespace: 'undoRedo'
				});

				// log the new past present future
				console.info('[tt][useThingtimeline.tsx] new timeline.past:', timeline.past);
				console.info('[tt][useThingtimeline.tsx] new timeline.present:', timeline.present);
				console.info('[tt][useThingtimeline.tsx] new timeline.future:', timeline.future);

				// log the newThingtime
				undoRedoLogger.log('[tt][useThingtimeline.tsx] pastEvent:', pastEvent);
				undoRedoLogger.log('[tt][useThingtimeline.tsx] Everything:', Everything);
				undoRedoLogger.log('[tt][useThingtimeline.tsx] Everything.thingtime:', Everything.thingtime);

				const debugUuid = Math.random().toString(36).substring(2, 15);
				// log the timemachine update value

				// setThingtime without undoRedo
				Everything.thingtime.set('timemachine', timemachine, {
					ignoreUndoRedo: true,
					namespace: 'undoRedo'
				});

				undoRedoLogger.log('[tt][useThingtimeline.tsx] Undo action completed');
			} catch (err) {
				// nothing
				console.error('[tt][useThingtimeline.tsx] There was an error running the undo action', err, err?.stack);
			}
			undoRedoLogger.log('[tt][useThingtimeline.tsx] undo action completed');
			undoRedoLogger.log('[tt][useThingtimeline.tsx]');
		},
		[Everything]
	);

	const redo = React.useCallback(
		async (namespace: string = 'user') => {
			try {
				window.redoThingtime = window.redoThingtime || Everything.thingtime;
				// undoRedoLogger.log('[tt][useThingtimeline.tsx] redo function thingtime', Everything.thingtime);
				const timemachine = ThingtimeLine(Everything.thingtime.timemachine);
				const gottenTimeline = timemachine.getTimeline(namespace);
				console.info(
					'[tt][useThingtimeline.tsx][redo = useCallback] gottenTimeline:',
					gottenTimeline,
					'for namespace:',
					namespace,
					'and thingtime:',
					Everything.thingtime
				);

				// return;

				const timeline = newTimeline(namespace, gottenTimeline);

				const past = timeline.past;
				const present = timeline.present;
				const future = timeline.future;

				// log past , present, future
				console.info('[tt][useThingtimeline.tsx][redo = useCallback] past:', past);
				console.info('[tt][useThingtimeline.tsx][redo = useCallback] present:', present);
				console.info('[tt][useThingtimeline.tsx][redo = useCallback] future:', future);
				// flip past/future for redo
				// if (past.length === 0) {
				if (future.length === 0) {
					undoRedoLogger.warn('[tt][useThingtimeline.tsx] No future states to redo to');
					return;
				}
				undoRedoLogger.log('[tt][useThingtimeline.tsx] current timeline:', timeline);

				// TODO: this has not been changed to the new event
				// with a path based system for efficiency increase

				// Get the last state from the future
				// const newThingtime: any = future[future.length - 1];
				// ^^^ Instead of doing this, we have switched to a new event schema which includes a "path"
				const futureEvent: TimelineEvent = future[future.length - 1];
				// Remove the last state from the future
				const newFuture = future.slice(0, -1);

				timeline.future = newFuture;

				// Set the present state to the last state
				timeline.present = futureEvent;
				// timeline.past = past.slice(0, -1);

				// Add the current present state to the past
				past.push(present);
				// future.push(present);

				timemachine.addTimeline(namespace, timeline);

				// log the timeline passed and the timemachine object
				console.info('[tt][useThingtimeline.tsx] new timeline:', timeline);
				console.info('[tt][useThingtimeline.tsx] new timemachine:', timemachine);

				// get path, value from futureEvent
				// use this event, we run a set to restore
				// the paths value at this undo/redo state
				// we use value here because we fetched a futureEvent not current
				// even though on current the fromValue would be the same
				// you can use either, but the undo / redo stack
				// will not be properly affected if you just use the present state fromValue to step backwards
				// this helps implemented linked list rather than solid state undo/redo stack
				// log the futureEvent.path and futureEvent.value at this moment
				console.info('[tt][useThingtimeline.tsx] futureEvent.path:', futureEvent.path);
				console.info('[tt][useThingtimeline.tsx] futureEvent.value:', futureEvent.value);
				console.info('[tt][useThingtimeline.tsx] futureEvent.fromValue:', futureEvent.fromValue);
				Everything.thingtime.set(futureEvent.path, futureEvent.value, {
					ignoreUndoRedo: true,
					namespace: 'undoRedo'
				});

				// log the new past present future
				console.info('[tt][useThingtimeline.tsx] new timeline.past:', timeline.past);
				console.info('[tt][useThingtimeline.tsx] new timeline.present:', timeline.present);
				console.info('[tt][useThingtimeline.tsx] new timeline.future:', timeline.future);

				// log the newThingtime
				undoRedoLogger.log('[tt][useThingtimeline.tsx] futureEvent:', futureEvent);
				undoRedoLogger.log('[tt][useThingtimeline.tsx] Everything:', Everything);
				undoRedoLogger.log('[tt][useThingtimeline.tsx] Everything.thingtime:', Everything.thingtime);

				const debugUuid = Math.random().toString(36).substring(2, 15);
				// log the timemachine update value

				// setThingtime without undoRedo
				Everything.thingtime.set('timemachine', timemachine, {
					ignoreUndoRedo: true,
					namespace: 'undoRedo'
				});

				undoRedoLogger.log('[tt][useThingtimeline.tsx] Undo action completed');
			} catch (err) {
				// nothing
				console.error('[tt][useThingtimeline.tsx] There was an error running the undo action', err, err?.stack);
			}
			undoRedoLogger.log('[tt][useThingtimeline.tsx] undo action completed');
			undoRedoLogger.log('[tt][useThingtimeline.tsx]');
		},
		[Everything]
	);

	const returnRef = React.useRef({
		undo,
		redo,
		addTimelineEvent
	});

	returnRef.current.undo = undo;
	returnRef.current.redo = redo;
	returnRef.current.addTimelineEvent = addTimelineEvent;

	return returnRef;
};

export interface Timeline {
	key: string;
	uuid: string; // unique identifier for the timeline
	past: TimelineEvent[];
	present: TimelineEvent | null;
	future: TimelineEvent[];
	addEvent: (event: TimelineEvent) => void;
}

export interface TimelineScaffold {
	key?: string;
	uuid?: string; // unique identifier for the timeline
	past?: TimelineEvent[];
	present?: TimelineEvent | null;
	future?: TimelineEvent[];
	addEvent?: (event: TimelineEvent) => void;
}

export const newTimeline = (key: string = 'default', scaffold?: TimelineScaffold) => {
	const timeline: Timeline = {
		key: key,
		uuid: Math.random().toString(36).substring(2, 15), // generate a random UUID
		past: [],
		present: null,
		future: [],
		addEvent: (event: TimelineEvent) => {
			if (!event) {
				console.warn('[tt][timemachine] No event provided to addEvent');
				return;
			}
			if (!event.path) {
				console.warn('[tt][timemachine] No path provided in event to addEvent');
				return;
			}
			if (!event.namespace) {
				event.namespace = 'default';
			}
			if (!event.timestamp) {
				event.timestamp = Date.now();
			}

			// don't log if namespace is default
			if (event.namespace !== 'default') {
				console.log('[tt][useThingtimeLine.tsx/ThingtimeLine.timeline.addEvent] 🕰️ Adding event:', event, 'to timeline', timeline);
			}
			// add current present to past
			if (timeline.present) {
				timeline.past.push(timeline.present);
			}

			// set the present to the new event
			timeline.present = event;
		}
	};

	if (scaffold) {
		// if scaffold has past, present, future, set them
		if (scaffold.past) {
			timeline.past = scaffold.past;
		}
		if (scaffold.present) {
			timeline.present = scaffold.present;
		}
		if (scaffold.future) {
			timeline.future = scaffold.future;
		}

		// if scaffold has key, set it
		if (scaffold.key) {
			timeline.key = scaffold.key;
		}
	}

	console.info('[tt][useThingtimeLine.tsx] scaffold is', scaffold);
	console.info('[tt][useThingtimeLine.tsx] returning new scaffolded timeline', timeline);

	return timeline;
};

// timemachine type
export interface Timemachine {
	timelines: { [key: string]: any };
	addTimeline: (key: string, timeline?: any) => void;
	getTimeline: (key?: string) => any;
	addEvent: (event: TimelineEvent, key?: string) => void;
}

export interface TimemachineScaffold {
	timelines?: { [key: string]: any };
	addTimeline?: (key?: string, timeline?: any) => void;
	getTimeline?: (key?: string) => any;
}

export const ThingtimeLine = (scaffold?: TimemachineScaffold) => {
	// This basically just makes sure that a
	// ThingtimeLine type object is returned
	// either if a scaffold is supplied
	// or not
	// this is "instances" of timelines with keys
	const timemachine: Timemachine = {
		timelines: {
			default: newTimeline('default')
		},
		addEvent: (event: TimelineEvent, key: string = 'default') => {
			// just run timemachine.timeslines[key].addEvent(event);
			if (!timemachine.timelines[key]) {
				console.warn(`[tt][useThingtimeLine.tsx/ThingtimeLine.addEvent] Timeline with key "${key}" does not exist. Creating a new one.`);
				timemachine.addTimeline(key, newTimeline(key));
			}
			const timeline = timemachine.timelines[key];
			if (event?.namespace !== 'default') {
				console.log('[tt][useThingtimeLine.tsx/ThingtimeLine.addEvent] 🕰️ Adding event to timeline', timeline, 'event:', event);
			}
			timeline.addEvent(event);
		},
		addTimeline: (key: string = 'default', timeline: any) => {
			// don't overwrite existing timelines
			// if (timemachine.timelines[key]) {
			//   console.warn(`[tt][timemachine] Timeline with key "${key}" already exists. Not overwriting.`);
			//   return;
			// }
			if (!timeline) {
				console.info(`[tt][useThingtimeLine.tsx/ThingtimeLine.addTimeline] No timeline provided for key "${key}". Creating a new one.`);
				timeline = newTimeline(key);
			}
			timemachine.timelines[key] = newTimeline(key, timeline);
		},
		getTimeline: (key: string = 'default') => {
			if (!timemachine.timelines[key]) {
				console.warn(`[tt][timemachine] Timeline with key "${key}" does not exist. Creating a new one.`);
				timemachine.addTimeline(key, newTimeline(key));
			}
			return timemachine.timelines[key];
		}
	};

	console.info('[tt][useThingtimeLine.tsx/ThingtimeLine] scaffold is:', scaffold);

	// if there's a scaffold, just make sure we add any timelines from the scaffold
	if (scaffold) {
		if (scaffold.timelines) {
			Object.keys(scaffold.timelines).forEach((key) => {
				timemachine.addTimeline(key, scaffold.timelines[key]);
			});
		}
	}

	return timemachine;
};
