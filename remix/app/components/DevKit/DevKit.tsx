import { Box, Flex, Button, Text } from '@chakra-ui/react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Icon } from '../Icon/Icon';
import React from 'react';

// injected by vite `define` — 'development' | 'preview' | 'production'
declare const __TT_DEPLOY_ENV__: string;

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

  // baked in at build time: 'development' | 'preview' | 'production'
  const deployEnv = typeof __TT_DEPLOY_ENV__ !== 'undefined' ? __TT_DEPLOY_ENV__ : env.NODE_ENV;

  // Auto-show on dev + Vercel preview (anything that isn't production). The
  // ?devKit query param can still force it on (e.g. on production) or off
  // (?devKit=false).
  const explicitlyOff = env.devKit === false || env.devKit === 'false';
  const devKit = !explicitlyOff && (deployEnv !== 'production' || !!env.devKit);

  const devMode = thingtime?.devKit?.devMode;

  const [open, setOpen] = React.useState(false);

  // hydration indicator: flips true only once React hydrates + runs effects on
  // the client. Green dot on the icon = hydrated (handlers work); grey = not.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Push generated test data into shared thingtime state; the forms watch
  // devKit.registerPrefill / devKit.loginPrefill (by _ts) and fill themselves.
  const prefillRegister = React.useCallback(() => {
    // crypto RNG for a fresh, unique dev-user suffix — full uint32 (no modulo,
    // to avoid bias warnings). Not security-sensitive; just keeps test users unique.
    const rand = crypto.getRandomValues(new Uint32Array(1))[0];
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
    // Compact fixed container at bottom-right (no full-viewport overlay, so no
    // pointer-events gymnastics). Safe-area offset keeps it clear of mobile
    // browser bars.
    <Box
      className="tt.devKit"
      position="fixed"
      zIndex={99999}
      bottom="calc(env(safe-area-inset-bottom, 0px) + 20px)"
      right="calc(env(safe-area-inset-right, 0px) + 20px)"
      display="flex"
      flexDirection="column"
      alignItems="flex-end"
      gap={2}
      sx={{ '*': { whiteSpace: 'pre-wrap' } }}
    >
      {open ? (
        <Box bg="gray.800" color="white" borderRadius="md" p={3} boxShadow="lg" minWidth="220px" fontSize="sm">
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

      {/* floating icon toggles the panel; the dot turns green once hydrated */}
      <Flex
        onClick={() => setOpen((o) => !o)}
        cursor="pointer"
        position="relative"
        width="52px"
        height="52px"
        borderRadius="full"
        bg="gray.800"
        boxShadow="lg"
        alignItems="center"
        justifyContent="center"
        opacity={open ? 1 : 0.9}
        _active={{ transform: 'scale(0.92)' }}
        transition="transform 100ms ease"
      >
        <Icon name="👨‍💻"></Icon>
        <Box
          position="absolute"
          top="2px"
          right="2px"
          width="12px"
          height="12px"
          borderRadius="full"
          border="2px solid"
          borderColor="gray.800"
          bg={mounted ? 'green.400' : 'gray.500'}
        />
      </Flex>
    </Box>
  ) : null;
};
