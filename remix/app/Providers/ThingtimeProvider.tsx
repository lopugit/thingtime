import React, { createContext } from 'react';
// @ts-ignore
import flatted, { parse, stringify } from 'flatted';
import { Subject } from 'rxjs';
import { thingtimeDefaults, thingtimeMinimumValues, thingtimeNewData, thingtimeOverwriteAll } from './Thingtime/ThingtimeDefaults';
import { sanitise } from '../functions/sanitise';
import { smarts } from '../smarts';
import { useUndoRedo } from '~/hooks/useUndoRedo';

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
  // TODO: work out why we are doing thingtimeReference and thingtimeRef ...... ? 😂
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

  useUndoRedo({
    set,
    thingtimeReference,
    thingtimeRef
  });

  const setThingtime = React.useCallback(
    (path, value) => {
      // TODO: make this a lot safer
      if (['thingtime', 'tt']?.includes(path)) {
        if (value) {
          set(value);
          return;
        }
      }

      // log the event in the window.eventchain to store history
      window.eventchain = window.eventchain || [];
      window.eventchain.push({
        path,
        value,
        currentValue: smarts.getsmart(thingtimeReference, path),
        timestamp: Date.now()
      });

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
          const localIsValid = !parsed.version || parsed.version >= thingtimeMinimumValues.version;
          let newThingtime = smarts.merge(thingtimeMinimumValues, thingtimeDefaults);

          console.trace('[tt.ThingtimeProvider] localIsValid', localIsValid);

          if (localIsValid) {
            newThingtime = smarts.merge(parsed, newThingtime);
          } else {
            const withVersionUpdates = smarts.merge(thingtimeNewData, parsed);
            newThingtime = smarts.merge(thingtimeMinimumValues, withVersionUpdates);
          }

          newThingtime = smarts.merge(newThingtime, thingtimeOverwriteAll, {
            overwriteAll: true
          });

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
