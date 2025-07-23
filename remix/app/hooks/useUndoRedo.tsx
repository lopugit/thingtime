import React from 'react';
import { smarts } from '../smarts';
import localforage from 'localforage';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { parse, stringify } from 'flatted';

// timemachine type
export interface Timemachine {
  timelines: { [key: string]: any };
  addTimeline: (key: string, timeline?: any) => void;
  getTimeline: (key?: string) => any;
}

export interface TimemachineScaffold {
  timelines?: { [key: string]: any };
  addTimeline?: (key?: string, timeline?: any) => void;
  getTimeline?: (key?: string) => any;
}

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
// currentValue: smarts.getsmart(thingtimeState, path),
// timestamp: time

export interface TimelineEvent {
  path: string;
  value: any;
  namespace?: string;
  currentValue?: any;
  timestamp?: number;
  // additional properties can be added as needed
}

export const useUndoRedo = (Everything) => {
  const { thingtime } = Everything;

  console.log('nik[useUndoRedo.tsx/useUndoRedo()x] { thingtime } = Everything', thingtime);

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

  const addTimelineEvent = React.useCallback(async (thingtime, event: TimelineEvent) => {
    try {
      // what caused addTimelineEvent to be called?
      console.log('[tt][undo] addTimelineEvent called');

      const timemachine = newTimemachine(thingtime.timemachine);
      const timeline = timemachine.getTimeline(event?.namespace || 'default');

      timeline.addEvent(event);

      thingtime.timemachine = timemachine;

      // log timemachine and timeline
      console.log('nik timemachine:', timemachine);
      console.log('nik timeline:', timeline);

      thingtime.set('timemachine', timemachine, {
        ignoreUndoRedo: true
      });
    } catch (err) {
      undoRedoLogger.error('[tt][undo] There was an error adding new state to the undoRedo object', err);
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

        // // start console log level
        // console.group('ThingtimeProvider detected', eventType);

        try {
          // REDO action
          // if shift key is pressed
          // because if shift key is pressed then it's a redo action
          // so this is ctrl + shift + z / cmd + shift + z
          if (redoEvent) {
            undoRedoLogger.log('[tt][undo] running redo');
            redo();
          }

          // UNDO action
          // if shift key is not pressed
          // because if shift key is pressed then it's a redo action
          // so this is just ctrl + z / cmd + z
          if (undoEvent) {
            undoRedoLogger.log('[tt][undo] running undo');
            undo();
          }
        } catch (err) {
          undoRedoLogger.error('[tt][undo] There was an error running the  action', err);
        }
      }
    };

    window.addEventListener('keydown', keyListener);

    return () => {
      window.removeEventListener('keydown', keyListener);
    };
  }, [thingtime]);

  const undo = React.useCallback(
    async (namespace: string = 'default') => {
      try {
        undoRedoLogger.log('[tt][undo] undo function thingtime', thingtime);
        const timemachine = newTimemachine(thingtime.timemachine);
        const gottenTimeline = timemachine.getTimeline(namespace);
        console.log('nik gottenTimeline', gottenTimeline);
        const timeline = newTimeline(namespace, gottenTimeline);

        const past = timeline.past;
        const present = timeline.present;
        const future = timeline.future;

        if (past.length === 0) {
          undoRedoLogger.warn('[tt][undo] No past states to undo to');
          return;
        }
        undoRedoLogger.log('[tt][undo] current timeline:', timeline);
        // Get the last state from the past
        const newThingtime: any = past[past.length - 1];
        // log the newThingtime
        undoRedoLogger.log('[tt][undo] newThingtime:', newThingtime);
        // Set the present state to the last state
        timeline.present = newThingtime;
        // log new thingtime.undo_fix_tests
        undoRedoLogger.log('[tt][undo] newThingtime.undo_fix_tests:', newThingtime?.undo_fix_tests);
        // Remove the last state from the past
        timeline.past = past.slice(0, -1);
        // Add the current present state to the future
        future.push(present);

        timemachine.addTimeline(namespace, timeline);

        // setThingtime without undoRedo
        thingtime.set('timemachine', timemachine, {
          ignoreUndoRedo: true
        });

        undoRedoLogger.log('[tt][undo] Undo action completed');
      } catch (err) {
        // nothing
        console.error('[tt][undo] There was an error running the undo action', err, err?.stack);
      }
      undoRedoLogger.log('[tt][undo] undo action completed');
      undoRedoLogger.log('[tt][undo]');
    },
    [thingtime]
  );

  const redo = React.useCallback(async () => {
    try {
    } catch (err) {
      console.error('There was an error running the redo action', err);
    }
  }, [thingtime]);

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

      console.log('nik timeline in addEvent', timeline);

      // add current present to past
      if (timeline.present) {
        console.log('nik adding present to past', timeline.past, timeline.present);
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

  console.log('nik scaffold is', scaffold);
  console.log('nik returning new scaffolded timeline', timeline);

  return timeline;
};

export const newTimemachine = (scaffold?: TimemachineScaffold) => {
  // this is "instances" of timelines with keys
  const timemachine: Timemachine = {
    timelines: {
      default: newTimeline('default')
    },
    addTimeline: (key: string = 'default', timeline: any) => {
      // don't overwrite existing timelines
      if (timemachine.timelines[key]) {
        console.warn(`[tt][timemachine] Timeline with key "${key}" already exists. Not overwriting.`);
        return;
      }
      if (!timeline) {
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

  // if there's a scaffold, just make sure we add any timelines from the scaffold
  if (scaffold) {
    if (scaffold.timelines) {
      console.log('nik[tt.useUndoRedo.tsx/newTimemachine] found scaffold.timelines | scaffold:', scaffold);
      Object.keys(scaffold.timelines).forEach((key) => {
        timemachine.addTimeline(key, scaffold.timelines[key]);
      });
    }
  }

  return timemachine;
};
