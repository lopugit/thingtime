import React from 'react';

import { ThingtimeURL } from '~/components/Thingtime/ThingtimeURL';

export default function Index() {
  return <ThingtimeURL></ThingtimeURL>;
}

export const action = async ({ request }) => {
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: 'Hello, World! $ Action'
    },
    cache: {
      revalidate: 60
    }
  };
};
