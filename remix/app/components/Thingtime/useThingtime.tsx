import { useContext } from 'react';

import { ThingtimeContext, ThingtimeTypes } from '../../Providers/ThingtimeProvider';
// import uuid v4
import { v4 as uuidv4 } from 'uuid';
import React from 'react';

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

  return Everything;
};
