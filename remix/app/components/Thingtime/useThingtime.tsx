import { createContext, useContext } from 'react';

// import uuid v4
import { v4 as uuidv4 } from 'uuid';
import React from 'react';
import { Subject } from 'rxjs';
import { ThingtimeContext } from '~/Providers/ThingtimeProvider';

export interface ThingtimeTypes {
  thingtime: any;
  set: any;
  setThingtime: any;
  getThingtime: any;
  thingtimeRef: any;
  loading: boolean;
  paths: string[];
  events: Subject<any>;
  Provider?: React.Context<ThingtimeTypes> | any;
}

export interface EverythingTypes {
  Everything: ThingtimeTypes;
}

const getGlobal = () => {
  try {
    return window;
  } catch {
    return globalThis;
  }
};

let useThingtimeScope = {};
try {
  window.useThingtimeScope = window.useThingtimeScope || useThingtimeScope;
  useThingtimeScope = window.useThingtimeScope;
} catch (err) {
  // console.error('Error setting up useThingtimeScope likely no window', err);
}

// export const ThingtimeContext = createContext<EverythingTypes | null>(null);

export const useThingtime = (uuidProp?: string): ThingtimeTypes => {
  const { Everything } = useContext(ThingtimeContext);

  const [uuid, setUuid] = React.useState(`${uuidProp || ''}${uuidv4()}`);
  useThingtimeScope[uuid] = useThingtimeScope[uuid] || [];
  const useThingtimeScoperArray = useThingtimeScope[uuid];
  const objectKey = `useThingtimeLogger-${uuid}`;
  const debugObject = {
    uuid: uuid,
    value: { ...Everything },
    // timestamp in format 05:01:31.266
    timestamp: new Date().toISOString()
  };
  // console.log('[tt][useThingtime.tsx/useThingtime() debugObject', debugObject);
  useThingtimeScoperArray.push(debugObject);
  // console.log('useThingtime uuid', uuid);
  // const { thingtime, setThingtime, getThingtime, thingtimeRef } = value

  // value.useThingtimeUuid = uuid;

  // Everything.Provider = ThingtimeContext.Provider;

  return Everything;
};
