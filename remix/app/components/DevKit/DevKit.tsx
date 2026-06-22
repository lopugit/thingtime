import { Box, Flex, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { useNavigate, useRevalidator } from '@remix-run/react';
import React from 'react';

import { useThingtime } from '../Thingtime/useThingtime';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useApi } from '~/hooks/useApi';
import { useLopu, useLopuStream } from '../Lopu/useLopu';
import { RAINBOW } from '../User/UserCard';
import { Icon } from '../Icon/Icon';

// injected by vite `define` — 'development' | 'preview' | 'production'
declare const __TT_DEPLOY_ENV__: string;

// Rotating conic rainbow for the hydration badge. A conic gradient whose first
// and last colour match spins with no seam (a linear gradient tiles with a hard
// diagonal line — this avoids that entirely).
const RAINBOW_CONIC = 'conic-gradient(from 0deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)';
const spin = keyframes`from { transform: rotate(0deg) } to { transform: rotate(360deg) }`;

const getQueryParams: any = () => {
  try {
    return new URLSearchParams(window.location.search);
  } catch (err) {}

  return {};
};

// A single menu row in the DevKit window.
const DevAction = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <Box
    as="button"
    type="button"
    onClick={onClick}
    textAlign="left"
    width="100%"
    px={3}
    py={2}
    borderRadius="8px"
    fontSize="sm"
    _hover={{ bg: 'gray.100' }}
    transition="background 120ms"
  >
    {children}
  </Box>
);

export const DevKit = (props) => {
  const { thingtime, setThingtime } = useThingtime();
  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const lopu = useLopu();
  const pushLopuMusing = useLopuStream();

  const urlParams = getQueryParams();
  const params = {};
  try {
    for (const [key, value] of urlParams) {
      params[key] = value;
    }
  } catch (error) {
    // dont worry, be happy
  }

  const env: any = { NODE_ENV: process.env.NODE_ENV, ...params };
  try {
    window.env = env;
  } catch (error) {
    // dont worry, be happy
  }

  // baked in at build time: 'development' | 'preview' | 'production'
  const deployEnv = typeof __TT_DEPLOY_ENV__ !== 'undefined' ? __TT_DEPLOY_ENV__ : env.NODE_ENV;
  const explicitlyOff = env.devKit === false || env.devKit === 'false';
  const devKit = !explicitlyOff && (deployEnv !== 'production' || !!env.devKit);

  const [open, setOpen] = React.useState(false);

  // hydration indicator: green once React hydrates + runs effects
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // draggable window position (set on first open, client-side)
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  React.useEffect(() => {
    if (open && pos === null && typeof window !== 'undefined') {
      setPos({ left: Math.max(12, window.innerWidth - 292), top: 80 });
    }
  }, [open, pos]);

  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    dragRef.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const left = Math.min(Math.max(0, e.clientX - dragRef.current.dx), window.innerWidth - 60);
    const top = Math.min(Math.max(0, e.clientY - dragRef.current.dy), window.innerHeight - 40);
    setPos({ left, top });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // --- dev actions ---------------------------------------------------------
  const prefillRegister = React.useCallback(() => {
    // crypto RNG for a fresh, unique dev-user suffix (full uint32, no modulo)
    const rand = crypto.getRandomValues(new Uint32Array(1))[0];
    setThingtime('devKit.registerPrefill', {
      username: `rick.deckard${rand}`,
      email: `rick.deckard+${rand}@thingtime.com`,
      password: 'password1',
      _ts: Date.now()
    });
  }, [setThingtime]);

  const prefillLogin = React.useCallback(() => {
    setThingtime('devKit.loginPrefill', { username: 'rick.deckard', password: 'password1', _ts: Date.now() });
  }, [setThingtime]);

  const verifyEmailDev = React.useCallback(async () => {
    if (!user) {
      lopu({ title: 'Log in first 🙂', status: 'info' });
      return;
    }
    const resp = await api.v1.auth.resendVerification({ email: user.email });
    if (resp?.verificationLink) {
      try {
        await fetch(resp.verificationLink); // GET consumes the token → verified
      } catch {}
      revalidator.revalidate();
      lopu({ title: 'Email verified (dev) ✅', description: user.email, status: 'success' });
    } else {
      lopu({ title: 'Already verified ✨', status: 'info' });
    }
  }, [user, api, revalidator, lopu]);

  const handleLogout = React.useCallback(async () => {
    await api.v1.auth.logout();
    navigate('/login');
  }, [api, navigate]);

  // Streams the musing in live: the toast pops instantly ("Lopu is thinking…")
  // then types the response in, à la modern AI chat.
  const pushMusing = React.useCallback(() => {
    pushLopuMusing('/api/v1/lopu/musing');
  }, [pushLopuMusing]);

  if (!devKit) return null;

  return (
    <>
      {/* draggable DevKit window */}
      {open && pos ? (
        <Box
          position="fixed"
          left={`${pos.left}px`}
          top={`${pos.top}px`}
          zIndex={100000}
          width="260px"
          bg="white"
          borderRadius="14px"
          boxShadow="0 12px 38px rgba(0,0,0,0.22)"
          border="1px solid"
          borderColor="gray.200"
          overflow="hidden"
        >
          {/* title bar — drag handle */}
          <Flex
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            align="center"
            gap={2}
            px={3}
            py={2}
            backgroundImage={RAINBOW}
            color="white"
            cursor="grab"
            _active={{ cursor: 'grabbing' }}
            sx={{ userSelect: 'none', touchAction: 'none' }}
          >
            <Text fontSize="sm" fontWeight="800">
              🦄 DevKit
            </Text>
            <Box flex={1} />
            <Box
              as="button"
              type="button"
              onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
              onClick={() => setOpen(false)}
              aria-label="Close"
              fontSize="sm"
              opacity={0.85}
              _hover={{ opacity: 1 }}
            >
              ✕
            </Box>
          </Flex>

          {/* menu actions */}
          <Flex direction="column" p={2} gap={1}>
            <Text px={3} pt={1} fontSize="10px" fontWeight="700" color="gray.400" textTransform="uppercase">
              Forms
            </Text>
            <DevAction onClick={prefillRegister}>📝 Prefill register form</DevAction>
            <DevAction onClick={prefillLogin}>🔑 Prefill login form</DevAction>

            <Text px={3} pt={2} fontSize="10px" fontWeight="700" color="gray.400" textTransform="uppercase">
              Lopu
            </Text>
            <DevAction onClick={pushMusing}>🔮 Push a Lopu musing</DevAction>

            <Text px={3} pt={2} fontSize="10px" fontWeight="700" color="gray.400" textTransform="uppercase">
              Account {user ? `· ${user.username}` : ''}
            </Text>
            {user ? (
              <>
                {!user.emailVerified && <DevAction onClick={verifyEmailDev}>✉️ Verify my email (dev)</DevAction>}
                <DevAction onClick={() => navigate('/profile')}>🌈 Profile</DevAction>
                <DevAction onClick={() => navigate('/welcome')}>🎉 Welcome page</DevAction>
                <DevAction onClick={handleLogout}>🗝️ Log out</DevAction>
              </>
            ) : (
              <>
                <DevAction onClick={() => navigate('/login')}>→ Login</DevAction>
                <DevAction onClick={() => navigate('/register')}>＋ Register</DevAction>
              </>
            )}
          </Flex>
        </Box>
      ) : null}

      {/* floating launcher icon (bottom-right, clear of mobile bars) */}
      <Box
        className="tt.devKit"
        position="fixed"
        zIndex={99999}
        bottom="calc(env(safe-area-inset-bottom, 0px) + 20px)"
        right="calc(env(safe-area-inset-right, 0px) + 20px)"
      >
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
          {/* hydration badge: shimmering rainbow once React hydrates, else grey */}
          <Box
            position="absolute"
            top="-2px"
            right="-2px"
            width="14px"
            height="14px"
            borderRadius="full"
            border="2px solid"
            borderColor="white"
            backgroundImage={mounted ? RAINBOW_CONIC : 'none'}
            bg={mounted ? undefined : 'gray.400'}
            boxShadow={mounted ? '0 0 8px rgba(165,85,232,0.7)' : 'none'}
            sx={mounted ? { animation: `${spin} 4s linear infinite` } : undefined}
          />
        </Flex>
      </Box>
    </>
  );
};
