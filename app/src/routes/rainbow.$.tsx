import React from 'react';
import { Flex } from '@chakra-ui/react';
import { useLocation } from '@remix-run/react';

import { Splash } from '~/components/Splash/Splash';
import { useThingtime } from '~/components/Thingtime/useThingtime';

export default function Index() {
  const location = useLocation();
  const { pathname } = location;

  const strippedPathname = React.useMemo(() => {
    // modify /rainbow/* to just *

    const ret = pathname.split('/')[2];

    if (ret) {
      return decodeURI(ret);
    }

    return 'rainbow';
  }, [pathname]);

  const texts = React.useMemo(() => {
    const ret = [strippedPathname];

    return ret;
  }, [strippedPathname]);

  console.log('texts', texts);

  return (
    <Flex
      sx={{
        '::selection': {
          background: 'transparent'
        },
        '::-moz-selection': {
          background: 'transparent'
        },
        '*': {
          '::selection': {
            background: 'transparent'
          },
          '::-moz-selection': {
            background: 'transparent'
          }
        },
        '* grammarly-extension': {
          display: 'none !important'
        }
      }}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      maxWidth="100%"
    >
      <Splash texts={texts} ce={true}></Splash>
    </Flex>
  );
}
