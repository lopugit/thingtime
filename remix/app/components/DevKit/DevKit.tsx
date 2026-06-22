import { Box, Flex } from '@chakra-ui/react';
import { useRouteLoaderData } from '@remix-run/react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Icon } from '../Icon/Icon';
import React from 'react';

export const DevKit = (props) => {
  const { thingtime } = useThingtime();
  const rootData = useRouteLoaderData('root') as any;
  const env = React.useMemo(() => rootData?.devKitEnv || {}, [rootData?.devKitEnv]);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);

    try {
      window.env = env;
    } catch (error) {
      // dont worry
      // be happy
    }
  }, [env]);

  const dev = env.NODE_ENV === 'development';

  const devKit = (dev || env.devKit) && env.devKit !== false;

  const devMode = thingtime?.devKit?.devMode;

  const setDevMode = React.useCallback(() => {}, []);

  if (!mounted) {
    return null;
  }

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
