import React, { useEffect } from 'react';

import { ThingtimeURL } from '~/components/Thingtime/ThingtimeURL';
import { useThingtime } from '~/components/Thingtime/useThingtime';

export default function Index() {
  // enable editable mode globally because we are in a thingtime URL
  const { thingtime } = useThingtime();

  useEffect(() => {
    // TODO: make thingtime.set (setThingtime)
    // use a queue so as not to intefere run before history (undo/redo)
    // is setup...

    // thingtime.set('thingtimeUrlPageVisible', true);
    return () => {
      // thingtime.set('thingtimeUrlPageVisible', false);
    };
  }, []);

  return <ThingtimeURL></ThingtimeURL>;
}

export const action = async ({ request }) => {
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: 'Hello Thingtime!'
    },
    cache: {
      revalidate: 60
    }
  };
};
