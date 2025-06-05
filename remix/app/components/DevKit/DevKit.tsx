import { Box, Flex } from '@chakra-ui/react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Icon } from '../Icon/Icon';
import React from 'react';

const getQueryParams: any = () => {
  try {
    return new URLSearchParams(window.location.search);
  } catch (err) {}

  return {};
};

export const DevKit = (props) => {
  const { thingtime, setThingtime, getThingtime, loading, events } = useThingtime();

  // get query params from url
  const urlParams = getQueryParams();
  // get all params and store in object
  const params = {};
  try {
    for (const [key, value] of urlParams) {
      params[key] = value;
    }
  } catch (error) {
    // dont worry
    // be happy
  }

  const env: any = {
    NODE_ENV: process.env.NODE_ENV,
    ...params
  };

  try {
    window.env = env;
  } catch (error) {
    // dont worry
    // be happy
  }

  const dev = env.NODE_ENV === 'development';

  const devKit = (dev || env.devKit) && env.devKit !== false;

  const devMode = thingtime?.devKit?.devMode;

  React.useEffect(() => {
    if (devKit && devMode === undefined) {
      // setThingtime('devKit.devMode', true);
    }
  }, []);

  const setDevMode = React.useCallback(
    (e) => {
      const newValue = e?.target?.value || (typeof e !== 'object' && e) || !devMode;
      // setThingtime('devKit.devMode', newValue);
    },
    [devMode]
  );

  return devKit ? (
    <Flex
      className="tt.devKit"
      zIndex={99999}
      pointerEvents={'none'}
      sx={{
        '*': {
          whiteSpace: 'pre-wrap'
        }
      }}
      position="fixed"
      top={0}
      left={0}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      overflow="hidden"
      width="100vw"
      maxWidth="100vw"
      height="100vh"
      maxHeight="100vh"
    >
      <Flex
        sx={{
          '*': {
            pointerEvents: 'all'
          }
        }}
        position={'absolute'}
        bottom={0}
        right={0}
      >
        {/* add a little icon for toggling dev mode when devKit is enabled */}
        <Flex onClick={setDevMode} cursor={'pointer'} opacity={devMode ? 1 : 0.5}>
          <Box p={4}>
            <Icon name="👨‍💻"></Icon>
          </Box>
        </Flex>
      </Flex>
    </Flex>
  ) : null;
};
