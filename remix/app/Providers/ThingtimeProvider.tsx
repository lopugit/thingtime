import React, { createContext } from 'react';
import flatted, { parse, stringify } from 'flatted';
import { Subject } from 'rxjs';
import { thingtimeDefaults, thingtimeForced, thingtimeNewData } from './Thingtime/ThingtimeDefaults';
import { sanitise } from '../functions/sanitise';
import { smarts } from '../smarts';

export interface ThingtimeContextInterface {
  thingtime: any;
  setThingtime: any;
  getThingtime: any;
  thingtimeRef: any;
  loading: boolean;
  events: Subject<any>;
}

export const ThingtimeContext = createContext<ThingtimeContextInterface | null>(null);

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
  const [thingtimeReference, rawSet] = React.useState({
    tt: null,
    thingtime: null,
    set: () => console.log('Please wait for Thingtime to load'),
    get: () => console.log('Please wait for Thingtime to load')
  });

  const thingtimeRef = React.useRef(thingtimeReference);
  const stateRef: any = React.useRef({
    c: 1
  });

  const [loading, setLoading] = React.useState(true);

  const [events, setEvents] = React.useState(null);

  if (!events) {
    setEvents(() => new Subject());
  }

  const set = React.useCallback((newThingtime, ignoreUndoRedo?: any) => {
    const newThingtimeReference = {
      ...newThingtime
    };

    newThingtimeReference.tt = newThingtimeReference;
    newThingtimeReference.thingtime = newThingtimeReference;

    // we need to split this into a undo/redo separated logical flow

    // store undo/redo history
    if (!ignoreUndoRedo) {
      try {
        console.log('ThingtimeProvider setting thingtime to localStorage', newThingtimeReference);
        // setTimeout(() => {
        const stringified = stringify(newThingtimeReference);
        let undoHistory = [];
        try {
          const undoHistoryString = window.localStorage.getItem('undoHistory');
          const parsedUndoHistory = JSON.parse(undoHistoryString);
          if (parsedUndoHistory instanceof Array) {
            undoHistory = parsedUndoHistory;
          }
        } catch {
          // nothing
        }

        // if last undoHistory does not equal new undo history
        if (undoHistory[undoHistory.length - 1]?.value !== stringified) {
          try {
            const limit = newThingtimeReference?.settings?.undoLimit || 999;

            if (undoHistory?.length > limit) {
              undoHistory = undoHistory.slice(undoHistory.length - limit);
            }

            undoHistory.push({
              timestamp: Date.now(),
              value: stringify(newThingtimeReference)
            });
            const undoHistoryNewString = JSON.stringify(undoHistory);
            window.localStorage.setItem('undoHistory', undoHistoryNewString);
          } catch {
            // nothing
          }
        }
      } catch (err) {
        console.error('There was an error saving thingtime to localStorage');
      }

      const saveRedo = false;
      if (saveRedo) {
        try {
          console.log('ThingtimeProvider setting thingtime to localStorage', newThingtimeReference);
          // setTimeout(() => {
          const stringified = stringify(newThingtimeReference);
          let redoHistory = [];
          try {
            const redoHistoryString = window.localStorage.getItem('redoHistory');
            const parsedRedoHistory = JSON.parse(redoHistoryString);
            if (parsedRedoHistory instanceof Array) {
              redoHistory = parsedRedoHistory;
            }
          } catch {
            // nothing
          }

          if (redoHistory[redoHistory.length - 1]?.value !== stringified) {
            try {
              const limit = newThingtimeReference?.settings?.redoLimit || 999;

              if (redoHistory?.length > limit) {
                redoHistory = redoHistory.slice(redoHistory.length - limit);
              }

              redoHistory.push({
                timestamp: Date.now(),
                value: stringify(newThingtimeReference)
              });
              const redoHistoryNewString = JSON.stringify(redoHistory);
              window.localStorage.setItem('redoHistory', redoHistoryNewString);
            } catch {
              // nothing
            }
          }
        } catch (err) {
          console.error('There was an error saving thingtime to localStorage');
        }
      }
    }

    rawSet(newThingtimeReference);
  }, []);

  const setThingtime = React.useCallback(
    (path, value) => {
      // TODO: make this a lot safer
      if (['thingtime', 'tt']?.includes(path)) {
        if (value) {
          set(value);
          return;
        }
      }

      const newThingtime: any = thingtimeReference || {};

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

      // TODO: make thingtime settable
      newThingtime.thingtime = newThingtime;
      newThingtime.tt = newThingtime;

      console.log('ThingtimeProvider setting newThingtime value at path', '"' + path + '"', 'value: ', value);

      smarts.setsmart(newThingtime, path, value);

      set(newThingtime);
    },
    [thingtimeReference, set]
  );

  const getThingtime = React.useCallback(
    (...args) => {
      const rawPath = args[0];
      const path = rawPath;

      if (!path) {
        return thingtimeReference;
      }

      // do we need to sanitise?
      // const path = sanitise(rawPath)
      console.log('ThingtimeProvider getting thingtime at path', path);
      // console.trace("Getting thingtime at path", path)
      return smarts.getsmart(thingtimeReference, path);
    },
    [thingtimeReference]
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
    populatePaths(thingtimeReference, '', paths);

    return paths;
  }, [populatePaths, thingtimeReference]);

  // get thingtime from localstorage
  React.useEffect(() => {
    try {
      const thingtimeFromLocalStorage = window.localStorage.getItem('thingtime');

      console.log('[tt.ThingtimeProvider] thingtimeFromLocalStorage', thingtimeFromLocalStorage);

      if (thingtimeFromLocalStorage) {
        const parsed = parse(thingtimeFromLocalStorage);

        console.log('[tt.ThingtimeProvider] parsed', parsed);

        if (parsed) {
          const localIsValid = !parsed.version || parsed.version >= thingtimeForced.version;
          let newThingtime = smarts.merge(thingtimeForced, thingtimeDefaults);

          console.trace('[tt.ThingtimeProvider] localIsValid', localIsValid);

          if (localIsValid) {
            newThingtime = smarts.merge(parsed, newThingtime);
          } else {
            const withVersionUpdates = smarts.merge(thingtimeNewData, parsed);
            newThingtime = smarts.merge(thingtimeForced, withVersionUpdates);
          }

          console.log('ThingtimeProvider restoring thingtime from localStorage', newThingtime);
          set(newThingtime);
        }
      } else {
        set(thingtimeDefaults);
      }
    } catch (err) {
      console.error('There was an error getting thingtime from localStorage');
    }

    setLoading(false);
  }, []);

  // Add a listener for the undo/redo key shortcuts
  React.useEffect(() => {
    const keyListener = (e) => {
      // @undoRedoEventKeyShortcutEventListener
      // if ctrl + z, restore thingtime from localstorage history

      console.log('ThingtimeProvider listened to key event e?.key', e?.key);
      console.log('ThingtimeProvider listened to key event e?.ctrlKey', e?.ctrlKey);
      console.log('ThingtimeProvider listened to key event e?.shiftKey', e?.shiftKey);
      console.log('ThingtimeProvider listened to key event e?.metaKey', e?.metaKey);

      const currentThingtime = thingtimeRef.current;

      if ((e?.ctrlKey || e?.metaKey) && e?.key === 'z') {
        e?.preventDefault();

        // start console log level
        console.group('ThingtimeProvider detected undo/redo request');

        try {
          // log the value of currentThingtime.undo_fix_tests.newVal
          console.log('ThingtimeProvider detected undo/redo request currentThingtime.undo_fix_tests.newVal', currentThingtime?.undoTest);

          // REDO action
          // if shift key is pressed
          // because if shift key is pressed then it's a redo action
          // so this is ctrl + shift + z / cmd + shift + z
          if (e.shiftKey) {
            try {
              console.log('ThingtimeProvider redo');
              const redoHistoryString = window.localStorage.getItem('redoHistory');
              const parsedRedoHistory = JSON.parse(redoHistoryString);
              if (parsedRedoHistory instanceof Array) {
                const last = parsedRedoHistory[parsedRedoHistory.length - 1];
                if (last) {
                  const parsed = parse(last.value);
                  if (parsed) {
                    // remove restored state from history
                    // const currentHistory = parsedRedoHistory.pop()
                    parsedRedoHistory.pop();
                    // parsedRedoHistory.push(currentHistory)
                    const newRedoHistoryString = JSON.stringify(parsedRedoHistory);
                    window.localStorage.setItem('redoHistory', newRedoHistoryString);

                    // save old/current state to undo history
                    let undoHistory = [];
                    try {
                      const undoHistoryString = window.localStorage.getItem('undoHistory');
                      const parsedUndoHistory = JSON.parse(undoHistoryString);
                      if (parsedUndoHistory instanceof Array) {
                        undoHistory = parsedUndoHistory;
                      }
                    } catch {
                      // nothing
                    }

                    // after removing and restoring the last redo item
                    // we need to push the current state to the undo history
                    // basically redo[-1] and undo[-1] should be the same.....
                    // We can fix this later
                    // TODO: Maybe fix this bad bum logic ???
                    // as a hack or efficiency thing we just use last.value instead of stringify(currentThingtime)
                    // because we already have the stringified version

                    try {
                      // ok here's the issue, we need to pop the last item from undo history because that's the "current" state
                      // and only THEN we can push the new state

                      // pop
                      undoHistory.pop();

                      // push
                      undoHistory.push({
                        timestamp: Date.now(),
                        value: last.value
                      });

                      const undoHistoryNewString = JSON.stringify(undoHistory);
                      window.localStorage.setItem('undoHistory', undoHistoryNewString);
                    } catch {
                      // nothing
                    }

                    const newThingtime = parsed;
                    set(newThingtime, true);
                  }
                }
              }

              // log the 2 last undo
            } catch (err) {
              console.error('There was an error running the redo action', err);
            }
          }

          // UNDO action
          // if shift key is not pressed
          // because if shift key is pressed then it's a redo action
          // so this is just ctrl + z / cmd + z
          if (!e.shiftKey) {
            console.log('ThingtimeProvider undo');
            try {
              const undoHistoryString = window.localStorage.getItem('undoHistory');
              const parsedUndoHistory = JSON.parse(undoHistoryString);

              let cachedRedoHistoryLastParsed = {};
              let cachedUndoHistoryCurrrentParsed = {};
              let cachedUndoHistoryPreviousParsed = {};

              if (parsedUndoHistory instanceof Array) {
                /**
                 * Ok so the reason we use -2 instead of -1
                 * is because the last item in the undo history is the current state
                 * and the second last item is the state before the current state
                 * because we store the "undo" history each time the state updates
                 * So in redo we need to grab the n-2 not the n-1 which we seem to be doing now so we get an odd skip situation
                 */

                const undoIndex = -2;

                // there's some issue / off by 1 error here with the -2 etc... ???
                // log indexes -1 and -2
                const previous = parsedUndoHistory[parsedUndoHistory.length + undoIndex];

                const current = parsedUndoHistory[parsedUndoHistory.length - 1];

                const previousParsed = parse(previous.value);
                const currentParsed = parse(current.value);

                cachedUndoHistoryCurrrentParsed = currentParsed;
                cachedUndoHistoryPreviousParsed = previousParsed;

                // log these
                console.log('ThingtimeProvider undo previous', previous);
                console.log('ThingtimeProvider undo previousParsed', previousParsed);
                console.log('ThingtimeProvider undo previousParsed?.undoTests', previousParsed?.undoTests);

                console.log('ThingtimeProvider undo current', current);
                console.log('ThingtimeProvider undo currentParsed', currentParsed);
                console.log('ThingtimeProvider undo currentParsed?.undoTests', currentParsed?.undoTests);

                if (previous) {
                  const parsed = parse(previous.value);
                  if (parsed) {
                    // remove restored state from history

                    // const currentHistory = parsedUndoHistory.pop();
                    parsedUndoHistory.pop();
                    // parsedUndoHistory.push(currentHistory);

                    const newUndoHistoryString = JSON.stringify(parsedUndoHistory);
                    window.localStorage.setItem('undoHistory', newUndoHistoryString);

                    // UNDO PART COMPLETE ---

                    // REDO PART STARTS HERE ---
                    // We need to save the current state to the redo history
                    // Because we are undoing the current state
                    // So we need to be able to redo to the current state

                    // save old/current state to redo history
                    // do we do this ?????
                    // TODO: check if this is correct
                    // and why we do this try catch block
                    // ohh we use let and pass down to @block:redoContinued
                    let redoHistory = [];
                    try {
                      const redoHistoryString = window.localStorage.getItem('redoHistory');
                      const parsedRedoHistory = JSON.parse(redoHistoryString);
                      if (parsedRedoHistory instanceof Array) {
                        redoHistory = parsedRedoHistory;
                      }
                    } catch {
                      // nothing
                    }

                    // @block:redoContinued
                    try {
                      // hmmmm do we use the current version as pointed to by undo history state or the actual currentThingtime ??
                      // questions questions, for now let's use current cause it's already stringified so it's efficient to use

                      // Maybe below?
                      // const stringifiedVersion = stringify(currentThingtime);

                      const stringifiedVersion = current.value;

                      // if previous history is not the same as new history
                      // hmm we can even push current directly right??
                      // redoHistory.push({
                      //   timestamp: Date.now(),
                      //   value: stringifiedVersion
                      // });

                      /// push current directly
                      redoHistory.push(current);

                      cachedRedoHistoryLastParsed = currentParsed;

                      // AI do you see any issues?
                      // AI: No, I do not see any issues with this approach
                      // AI: It seems like a good approach to me  - AI
                      // AI: I think it's a good approach - AI
                      // AI: I think it's a good approach - AI
                      // AI: I think it's a good approach - AI
                      // ok ai...

                      const redoHistoryNewString = JSON.stringify(redoHistory);
                      window.localStorage.setItem('redoHistory', redoHistoryNewString);
                    } catch {
                      // nothing
                    }

                    const newThingtime = parsed;
                    set(newThingtime, true);
                  }
                }
              }

              // log 2 top undoHistory items using parsedUndoHistory

              // use cached values
              // cachedUndoHistoryCurrrentParsed
              // cachedUndoHistoryPreviousParsed
              // cachedRedoHistoryLastParsed

              // log indexes -1 and -2

              console.log('ThingtimeProvider undo cachedUndoHistoryPreviousParsed', cachedUndoHistoryPreviousParsed);
              console.log('ThingtimeProvider undo cachedUndoHistoryCurrrentParsed', cachedUndoHistoryCurrrentParsed);

              // specifically log this path: undo_fix_tests.newVal
              console.log(
                'ThingtimeProvider undo cachedUndoHistoryPreviousParsed?.undo_fix_tests.newVal',
                cachedUndoHistoryPreviousParsed?.undo_fix_tests?.newVal
              );
              console.log(
                'ThingtimeProvider undo cachedUndoHistoryCurrrentParsed?.undo_fix_tests.newVal',
                cachedUndoHistoryCurrrentParsed?.undo_fix_tests?.newVal
              );

              // log redo history state
              // just log the top of the heap
              const lastRedoItem = cachedRedoHistoryLastParsed;

              console.log('ThingtimeProvider undo lastRedoItem', lastRedoItem);

              // also specifically log the above path here:
              console.log('ThingtimeProvider undo lastRedoItem?.undo_fix_tests.newVal', lastRedoItem?.undo_fix_tests?.newVal);

              // now to do the same for redo 🤣🤣🤣 🙄🙄🙄
            } catch {
              // nothing
            }
          }
        } finally {
          // end console log level
          console.groupEnd();
        }
      }
    };

    window.addEventListener('keydown', keyListener);

    return () => {
      window.removeEventListener('keydown', keyListener);
    };
  }, [thingtimeReference, set]);

  // thingtime change listener
  React.useEffect(() => {
    try {
      window.setThingtime = setThingtime;
      window.getThingtime = getThingtime;
      window.thingtime = thingtimeReference;
      window.tt = thingtimeReference;
      window.events = events;
    } catch {
      // nothing
    }

    if (stateRef.current.initialized) {
      try {
        console.log('ThingtimeProvider setting thingtime to localStorage', thingtimeReference);
        // setTimeout(() => {
        const stringified = stringify(thingtimeReference);
        window.localStorage.setItem('thingtime', stringified);
        // }, 600)
      } catch (err) {
        console.error('There was an error saving thingtime to localStorage');
      }
    } else {
      stateRef.current.initialized = true;
    }

    thingtimeRef.current = thingtimeReference;

    // not sure why this used to have @undoRedoEventKeyShortcutEventListener here.. ?
  }, [setThingtime, events, getThingtime, thingtimeReference, set]);

  if (thingtimeReference) {
    // @ts-expect-error property get/set does not exist or something?
    thingtimeReference.set = setThingtime;
    thingtimeReference.get = getThingtime;
  }

  const value = {
    thingtime: thingtimeReference,
    setThingtime,
    getThingtime,
    thingtimeRef,
    paths,
    loading,
    events
  };

  return <ThingtimeContext.Provider value={value}>{props?.children}</ThingtimeContext.Provider>;
};
