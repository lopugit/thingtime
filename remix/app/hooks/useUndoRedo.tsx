import React from 'react';
import { parse } from 'flatted';
import { smarts } from '../smarts';
import localforage from 'localforage';

// @ts-ignore
const undoLogger = console?.with?.({ context: 'undo' }) || console;

export const useUndoRedo = (args: { thingtimeReference: any; set: any; thingtimeRef: any }) => {
  const { thingtimeReference, set, thingtimeRef } = args;

  // Add a listener for the undo/redo key shortcuts
  React.useEffect(() => {
    const keyListener = (e) => {
      // @undoRedoEventKeyShortcutEventListener
      // if ctrl + z, restore thingtime from localstorage history

      const currentThingtime = thingtimeRef.current;

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
            undoLogger.log('[tt][undo] running redo');
            redo();
          }

          // UNDO action
          // if shift key is not pressed
          // because if shift key is pressed then it's a redo action
          // so this is just ctrl + z / cmd + z
          if (undoEvent) {
            undoLogger.log('[tt][undo] running undo');
            undo();
          }
        } catch (err) {
          undoLogger.error('[tt][undo] There was an error running the  action', err);
        }
      }
    };

    window.addEventListener('keydown', keyListener);

    return () => {
      window.removeEventListener('keydown', keyListener);
    };
  }, [thingtimeReference, set]);

  // return the undo/redo function

  const undo = React.useCallback(async () => {
    try {
      // const undoHistoryString = await localforage.getItem('undoHistory');
      const storageUndoHistory = await localforage.getItem('undoHistory');
      const undoHistoryString = typeof storageUndoHistory === 'string' ? storageUndoHistory : '';

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

        if (previous) {
          const parsed = parse(previous.value);
          if (parsed) {
            // remove restored state from history

            // const currentHistory = parsedUndoHistory.pop();
            parsedUndoHistory.pop();
            // parsedUndoHistory.push(currentHistory);

            const newUndoHistoryString = JSON.stringify(parsedUndoHistory);
            await localforage.setItem('undoHistory', newUndoHistoryString);

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
              const storageRedoHistory = await localforage.getItem('redoHistory');
              const redoHistoryString = typeof storageRedoHistory === 'string' ? storageRedoHistory : '';
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
              await localforage.setItem('redoHistory', redoHistoryNewString);
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

      // grab the most recently modified path value from
      // window.eventchain[window.eventchain.length - 1].path
      // and log that from cached and etc..
      const lastModifiedPath = window.eventchain[window.eventchain.length - 1]?.path;
      undoLogger.log('[tt][undo] recently modified path:', lastModifiedPath);

      undoLogger.log('[tt][undo] undo cachedUndoHistoryPreviousParsed', cachedUndoHistoryPreviousParsed);
      undoLogger.log('[tt][undo] undo cachedUndoHistoryCurrrentParsed', cachedUndoHistoryCurrrentParsed);

      undoLogger.log(
        '[tt][undo] undo cachedUndoHistoryPreviousParsed',
        lastModifiedPath,
        smarts.getsmart(cachedUndoHistoryPreviousParsed, lastModifiedPath)
      );
      undoLogger.log(
        '[tt][undo] undo cachedUndoHistoryCurrrentParsed',
        lastModifiedPath,
        smarts.getsmart(cachedUndoHistoryCurrrentParsed, lastModifiedPath)
      );

      // log redo history state
      // just log the top of the heap
      const lastRedoItem = cachedRedoHistoryLastParsed;

      undoLogger.log('[tt][undo] undo lastRedoItem', lastRedoItem);

      // also specifically log the above path here:
      undoLogger.log('[tt][undo] undo lastRedoItem', lastModifiedPath, smarts.getsmart(lastRedoItem, lastModifiedPath));

      // now to do the same for redo 🤣🤣🤣 🙄🙄🙄
    } catch {
      // nothing
    }
    console.log('[tt][undo] undo action completed');
    console.log('[tt][undo]');
  }, [thingtimeReference, set, thingtimeRef]);

  const redo = React.useCallback(async () => {
    try {
      const storageRedoHistory = await localforage.getItem('redoHistory');
      const redoHistoryString = typeof storageRedoHistory === 'string' ? storageRedoHistory : '';
      const parsedRedoHistory = JSON.parse(redoHistoryString);

      let cachedRedoHistoryCurrrentParsed = {};
      let cachedRedoHistoryPreviousParsed = {};
      let cachedUndoHistoryCurrrentParsed = {};
      let cachedUndoHistoryPreviousParsed = {};

      if (parsedRedoHistory instanceof Array) {
        const last = parsedRedoHistory[parsedRedoHistory.length - 1];
        const secondLast = parsedRedoHistory[parsedRedoHistory.length - 2];
        if (last) {
          const parsed = parse(last.value);
          if (parsed) {
            // parse 2nd last too
            cachedRedoHistoryCurrrentParsed = parsed;
            cachedRedoHistoryPreviousParsed = parse(secondLast.value);
            // remove restored state from history
            // const currentHistory = parsedRedoHistory.pop()
            parsedRedoHistory.pop();
            // parsedRedoHistory.push(currentHistory)
            const newRedoHistoryString = JSON.stringify(parsedRedoHistory);
            await localforage.setItem('redoHistory', newRedoHistoryString);

            // save old/current state to undo history
            let undoHistory = [];
            try {
              const storageUndoHistory = await localforage.getItem('undoHistory');
              const undoHistoryString = typeof storageUndoHistory === 'string' ? storageUndoHistory : '';

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

              const newUndoHistoryTop = {
                timestamp: Date.now(),
                value: last.value
              };

              // push
              undoHistory.push(newUndoHistoryTop);

              cachedUndoHistoryCurrrentParsed = parse(last.value);
              // now it is actually -2 again haha cause we just pushed
              cachedUndoHistoryPreviousParsed = parse(undoHistory[undoHistory.length - 2]?.value);

              const undoHistoryNewString = JSON.stringify(undoHistory);
              await localforage.setItem('undoHistory', undoHistoryNewString);
            } catch {
              // nothing
            }

            const newThingtime = parsed;
            set(newThingtime, true);
          }
        }
      }

      // log the 2 last undo

      // do the same logging here as in undo
      // use cached values
      // cachedRedoHistoryLastParsed
      // cachedRedoHistoryCurrrentParsed
      // cachedRedoHistoryPreviousParsed
      // cachedUndoHistoryCurrrentParsed
      // cachedUndoHistoryPreviousParsed
      // log indexes -1 and -2
      // grab the most recently modified path value from
      // window.eventchain[window.eventchain.length - 1].path
      // and log that from cached and etc..
      const lastModifiedPath = window.eventchain[window.eventchain.length - 1]?.path;
      undoLogger.log('[tt][undo] recently modified path:', lastModifiedPath);
      undoLogger.log('[tt][undo] redo cachedUndoHistoryPreviousParsed', cachedUndoHistoryPreviousParsed);
      undoLogger.log('[tt][undo] redo cachedUndoHistoryCurrrentParsed', cachedUndoHistoryCurrrentParsed);
      undoLogger.log('[tt][undo] redo cachedRedoHistoryPreviousParsed', cachedRedoHistoryPreviousParsed);
      undoLogger.log('[tt][undo] redo cachedRedoHistoryCurrrentParsed', cachedRedoHistoryCurrrentParsed);
      undoLogger.log(
        '[tt][undo] redo cachedRedoHistoryCurrrentParsed',
        lastModifiedPath,
        smarts.getsmart(cachedRedoHistoryCurrrentParsed, lastModifiedPath)
      );
      undoLogger.log('[tt][undo] redo cachedUndoHistoryCurrrentParsed', cachedUndoHistoryCurrrentParsed);
      undoLogger.log('[tt][undo] redo cachedUndoHistoryPreviousParsed', cachedUndoHistoryPreviousParsed);
      undoLogger.log(
        '[tt][undo] redo cachedUndoHistoryCurrrentParsed',
        lastModifiedPath,
        smarts.getsmart(cachedUndoHistoryCurrrentParsed, lastModifiedPath)
      );
      undoLogger.log(
        '[tt][undo] redo cachedUndoHistoryPreviousParsed',
        lastModifiedPath,
        smarts.getsmart(cachedUndoHistoryPreviousParsed, lastModifiedPath)
      );

      // log redo history state
      // just log the top of the heap
      const lastRedoItem = cachedRedoHistoryCurrrentParsed;
      undoLogger.log('[tt][undo] redo lastRedoItem', lastRedoItem);
      // also specifically log the above path here:
      undoLogger.log('[tt][undo] redo lastRedoItem', lastModifiedPath, smarts.getsmart(lastRedoItem, lastModifiedPath));
      // also log the last redo item

      // now to do the same for undo 🤣🤣🤣 🙄🙄🙄
      // JK WE DONE IT HAHAHAHAHA 🤡
    } catch (err) {
      console.error('There was an error running the redo action', err);
    }
  }, [thingtimeReference, set, thingtimeRef]);

  return {
    undo,
    redo
  };
};
