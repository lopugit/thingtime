import { Box, Flex, Button, Text } from '@chakra-ui/react';
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

  const [open, setOpen] = React.useState(false);

  // Push generated test data into shared thingtime state; the forms watch
  // devKit.registerPrefill / devKit.loginPrefill (by _ts) and fill themselves.
  const prefillRegister = React.useCallback(() => {
    // rounded random so every prefill is a fresh, unique user
    const rand = Math.floor(Math.random() * 100000);
    setThingtime('devKit.registerPrefill', {
      username: `rick.deckard${rand}`,
      email: `rick.deckard+${rand}@thingtime.com`,
      password: 'password1',
      _ts: Date.now()
    });
  }, [setThingtime]);

  const prefillLogin = React.useCallback(() => {
    setThingtime('devKit.loginPrefill', {
      username: 'rick.deckard',
      password: 'password1',
      _ts: Date.now()
    });
  }, [setThingtime]);

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
        flexDirection="column"
        alignItems="flex-end"
      >
        {open ? (
          <Box mb={2} mr={3} bg="gray.800" color="white" borderRadius="md" p={3} boxShadow="lg" minWidth="220px" fontSize="sm">
            <Text fontWeight="bold" mb={2}>
              👨‍💻 DevKit
            </Text>
            <Button size="sm" width="100%" mb={2} colorScheme="purple" onClick={prefillRegister}>
              Prefill register form
            </Button>
            <Button size="sm" width="100%" colorScheme="blue" onClick={prefillLogin}>
              Prefill login form
            </Button>
          </Box>
        ) : null}

        {/* floating icon toggles the DevKit panel */}
        <Flex onClick={() => setOpen((o) => !o)} cursor={'pointer'} opacity={open ? 1 : 0.6}>
          <Box p={4}>
            <Icon name="👨‍💻"></Icon>
          </Box>
        </Flex>
      </Flex>
    </Flex>
  ) : null;
};
