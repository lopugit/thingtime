import React from 'react';
import { Flex } from '@chakra-ui/react';
import { useRouter } from 'next/router';

import { Splash } from '~/components/Splash/Splash';
import { useThingtime } from '~/components/Thingtime/useThingtime';

export default function Index(props: any) {
  const text = props?.text;

  const location = useRouter();
  const { pathname } = location;

  console.log('nik location', location);

  const strippedPathname = React.useMemo(() => {
    // modify /rainbow/* to just *

    const ret = text;
    // const ret = pathname.split('/')[2];

    if (ret) {
      return decodeURI(ret);
    }

    return 'rainbow';
  }, [text]);

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

export async function getServerSideProps(context: any) {
  return {
    props: {
      text: context?.params?.text // Access dynamic route parameters
    }
  };
}
