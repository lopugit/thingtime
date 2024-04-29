import { useContext } from 'react';

import { ThingtimeContext } from '~/providers/ThingtimeProvider';

const getGlobal = () => {
  try {
    return window;
  } catch {
    return globalThis;
  }
};

export const useThingtime = (props?: any): any => {
  const value = useContext(ThingtimeContext);

  // const { thingtime, setThingtime, getThingtime, thingtimeRef } = value

  return value;
};
