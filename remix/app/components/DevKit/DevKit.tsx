import { Box, Flex, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { useNavigate, useRevalidator, useRouteLoaderData } from 'react-router';
import React from 'react';

import { Icon } from '../Icon/Icon';
import { useLopu, useLopuStream } from '../Lopu/useLopu';
import { useThingtime } from '../Thingtime/useThingtime';
import { useApi } from '~/hooks/useApi';
import {
  buildCurlForEntry,
  describeApiStatus,
  getApiCalls,
  subscribeApiCalls,
  type ApiLogEntry,
  type ApiStatusTone
} from '~/hooks/apiRequestLog';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { RAINBOW, RAINBOW_CONIC } from '~/theme/rainbow';
import { LOGIN_TO_CLAIM_LABEL, getUserDisplayName } from '~/utils/userIdentity';

const spin = keyframes`from { transform: rotate(0deg) } to { transform: rotate(360deg) }`;
const DEVKIT_TRIGGER_STORAGE_KEY = 'thingtime.devKit.triggerPosition';
const DEVKIT_TRIGGER_SIZE = 52;
const DEVKIT_MARGIN = 8;
const DEVKIT_PANEL_WIDTH = 260;
const DEVKIT_PANEL_ESTIMATED_HEIGHT = 360;
const DEVKIT_NATIVE_BOTTOM_MIN_OFFSET = 36;

type FixedPosition = { left: number; top: number };

const clamp = (value: number, min: number, max: number) => {
  const upper = Math.max(min, max);
  return Math.min(Math.max(value, min), upper);
};

const readRootPixelValue = (propertyName: string) => {
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();
  const parsed = Number.parseFloat(raw);

  return Number.isFinite(parsed) ? parsed : 0;
};

const getViewportSize = () => ({
  width: window.visualViewport?.width || window.innerWidth,
  height: window.visualViewport?.height || window.innerHeight
});

const isNativeWebView = () => document.documentElement.classList.contains('thingtime-native-webview');

// stable server-snapshot for useSyncExternalStore (a fresh [] every call would loop)
const EMPTY_API_CALLS: ApiLogEntry[] = [];
const getEmptyApiCalls = () => EMPTY_API_CALLS;

const API_TONE_COLOR: Record<ApiStatusTone, string> = {
  ok: 'var(--tt-rainbow-3, #58ca70)',
  warn: '#b8860b',
  danger: 'var(--tt-danger, #d6455a)',
  muted: 'var(--tt-muted, #9a9aa6)'
};

const getDevKitBottomGuard = () => {
  const safeAreaBottom = readRootPixelValue('--thingtime-safe-area-bottom');
  const native = isNativeWebView();
  const configuredOffset = native
    ? readRootPixelValue('--thingtime-visual-devkit-bottom-offset') || readRootPixelValue('--thingtime-devkit-bottom-offset')
    : readRootPixelValue('--thingtime-devkit-bottom-offset');
  const minimumOffset = native ? DEVKIT_NATIVE_BOTTOM_MIN_OFFSET : DEVKIT_MARGIN;
  const offset = Math.max(configuredOffset, minimumOffset);

  return Math.max(DEVKIT_MARGIN, safeAreaBottom + offset);
};

const getDevKitRightGuard = () => {
  const safeAreaRight = readRootPixelValue('--thingtime-safe-area-right');

  return Math.max(DEVKIT_MARGIN, safeAreaRight + DEVKIT_MARGIN);
};

const clampTriggerPosition = (position: FixedPosition): FixedPosition => {
  const viewport = getViewportSize();

  return {
    left: clamp(position.left, DEVKIT_MARGIN, viewport.width - DEVKIT_TRIGGER_SIZE - getDevKitRightGuard()),
    top: clamp(position.top, DEVKIT_MARGIN, viewport.height - DEVKIT_TRIGGER_SIZE - getDevKitBottomGuard())
  };
};

const clampPanelPosition = (position: FixedPosition): FixedPosition => ({
  left: clamp(position.left, 12, getViewportSize().width - DEVKIT_PANEL_WIDTH - 12),
  top: clamp(position.top, 12, getViewportSize().height - 80)
});

const panelPositionNearTrigger = (triggerPos: FixedPosition | null): FixedPosition => {
  if (!triggerPos) {
    return { left: Math.max(12, window.innerWidth - 292), top: 80 };
  }

  return clampPanelPosition({
    left: triggerPos.left - DEVKIT_PANEL_WIDTH + DEVKIT_TRIGGER_SIZE,
    top: clamp(triggerPos.top - 8, 12, window.innerHeight - DEVKIT_PANEL_ESTIMATED_HEIGHT)
  });
};

const readStoredTriggerPosition = () => {
  try {
    const raw = window.localStorage.getItem(DEVKIT_TRIGGER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (typeof parsed?.left !== 'number' || typeof parsed?.top !== 'number') return null;

    return clampTriggerPosition({ left: parsed.left, top: parsed.top });
  } catch {
    return null;
  }
};

const DevAction = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <Box
    as="button"
    type="button"
    onClick={onClick}
    textAlign="left"
    width="100%"
    px={3}
    py={2}
    borderRadius="var(--tt-radius-sm, 9px)"
    fontSize="sm"
    _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
    transition="background 140ms ease"
  >
    {children}
  </Box>
);

export const DevKit = (_props) => {
  const { setThingtime } = useThingtime();
  const rootData = useRouteLoaderData('root') as any;
  const env = React.useMemo(() => rootData?.devKitEnv || {}, [rootData?.devKitEnv]);
  const envFromCookie = rootData?.envFromCookie || {};
  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const lopu = useLopu();
  const pushLopuMusing = useLopuStream();

  // request log (claude-todo/10 ⌨️): live view of the useApi ring buffer
  const apiCalls = React.useSyncExternalStore(subscribeApiCalls, getApiCalls, getEmptyApiCalls);

  const copyRequestAsCurl = React.useCallback(
    async (entry: ApiLogEntry) => {
      const curl = buildCurlForEntry(entry, window.location.origin);
      try {
        await navigator.clipboard.writeText(curl);
        lopu({
          title: 'curl copied 📋',
          description: 'The session cookie ships as a placeholder — it is httpOnly, grab it from devtools if needed.',
          status: 'success',
          duration: 6000
        });
      } catch {
        lopu({ title: 'Copy blocked — here it is', description: curl, status: 'info' });
      }
    },
    [lopu]
  );
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const [triggerPos, setTriggerPos] = React.useState<FixedPosition | null>(null);

  React.useEffect(() => {
    setMounted(true);
    setTriggerPos(readStoredTriggerPosition());

    try {
      window.env = env;
    } catch (error) {
      // dont worry, be happy
    }
  }, [env]);

  React.useEffect(() => {
    if (open && pos === null && typeof window !== 'undefined') {
      setPos(panelPositionNearTrigger(triggerPos));
    }
  }, [open, pos, triggerPos]);

  React.useEffect(() => {
    if (!mounted || !triggerPos) return;

    try {
      window.localStorage.setItem(DEVKIT_TRIGGER_STORAGE_KEY, JSON.stringify(triggerPos));
    } catch {}
  }, [mounted, triggerPos]);

  React.useEffect(() => {
    if (!mounted) return undefined;

    const clampVisiblePositions = () => {
      setTriggerPos((current) => (current ? clampTriggerPosition(current) : current));
      setPos((current) => (current ? clampPanelPosition(current) : current));
    };

    window.addEventListener('resize', clampVisiblePositions);
    window.addEventListener('thingtime:native-bridge-ready', clampVisiblePositions);
    window.addEventListener('thingtime:native-message', clampVisiblePositions);
    window.addEventListener('thingtime:visual-settings-change', clampVisiblePositions);
    window.visualViewport?.addEventListener('resize', clampVisiblePositions);
    window.visualViewport?.addEventListener('scroll', clampVisiblePositions);

    const reclampTimers = [
      window.setTimeout(clampVisiblePositions, 0),
      window.setTimeout(clampVisiblePositions, 150),
      window.setTimeout(clampVisiblePositions, 600)
    ];

    return () => {
      window.removeEventListener('resize', clampVisiblePositions);
      window.removeEventListener('thingtime:native-bridge-ready', clampVisiblePositions);
      window.removeEventListener('thingtime:native-message', clampVisiblePositions);
      window.removeEventListener('thingtime:visual-settings-change', clampVisiblePositions);
      window.visualViewport?.removeEventListener('resize', clampVisiblePositions);
      window.visualViewport?.removeEventListener('scroll', clampVisiblePositions);
      reclampTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [mounted]);

  const deployEnv = envFromCookie.THINGTIME_VERCEL_ENV || env.NODE_ENV;
  const explicitlyOff = env.devKit === false || env.devKit === 'false';
  const devKit = !explicitlyOff && (deployEnv !== 'production' || !!env.devKit);

  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const triggerRef = React.useRef<HTMLDivElement | null>(null);
  const triggerDragRef = React.useRef<{
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
  } | null>(null);
  const suppressTriggerClickRef = React.useRef(false);

  const startTriggerDrag = React.useCallback((clientX: number, clientY: number) => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    triggerDragRef.current = {
      startX: clientX,
      startY: clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false
    };
  }, []);

  const moveTriggerDrag = React.useCallback((clientX: number, clientY: number) => {
    const drag = triggerDragRef.current;
    if (!drag) return;

    const deltaX = clientX - drag.startX;
    const deltaY = clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;

    drag.moved = true;
    setTriggerPos(clampTriggerPosition({ left: drag.originLeft + deltaX, top: drag.originTop + deltaY }));
  }, []);

  const endTriggerDrag = React.useCallback(() => {
    const moved = !!triggerDragRef.current?.moved;
    triggerDragRef.current = null;

    if (moved) {
      suppressTriggerClickRef.current = true;
      window.setTimeout(() => {
        suppressTriggerClickRef.current = false;
      }, 0);
    }
  }, []);

  React.useEffect(() => {
    if (!mounted) return undefined;

    const onWindowMouseMove = (event: MouseEvent) => moveTriggerDrag(event.clientX, event.clientY);
    const onWindowMouseUp = () => endTriggerDrag();

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [endTriggerDrag, mounted, moveTriggerDrag]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    dragRef.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos(clampPanelPosition({ left: e.clientX - dragRef.current.dx, top: e.clientY - dragRef.current.dy }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onTriggerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startTriggerDrag(e.clientX, e.clientY);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const onTriggerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    moveTriggerDrag(e.clientX, e.clientY);
  };

  const onTriggerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    endTriggerDrag();
  };

  const onTriggerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (triggerDragRef.current) return;
    startTriggerDrag(e.clientX, e.clientY);
  };

  const toggleOpenFromTrigger = React.useCallback(
    (event?: React.MouseEvent | React.KeyboardEvent) => {
      if (suppressTriggerClickRef.current) {
        event?.preventDefault();
        return;
      }

      if (!open && pos === null) {
        setPos(panelPositionNearTrigger(triggerPos));
      }

      setOpen((current) => !current);
    },
    [open, pos, triggerPos]
  );

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggleOpenFromTrigger(e);
  };

  // tabLocal: a prefill fills the form in front of THIS DevKit, so it is an
  // instruction to one viewport, not shared state. Login/Register consume it
  // from an effect keyed on `_ts`, which is a fresh Date.now() every click — so
  // broadcast, one click here overwrites the username/email/password a peer tab
  // has typed into its own form and flips that tab's password field to visible.
  // Persisted as before (the same DevKit still prefills after a reload); only
  // the broadcast is suppressed. Passing options replaces setThingtime's default
  // object, so restate the namespace these writes have always used.
  const prefillRegister = React.useCallback(() => {
    const rand = crypto.getRandomValues(new Uint32Array(1))[0];
    setThingtime(
      'devKit.registerPrefill',
      {
        username: `rick.deckard${rand}`,
        email: `rick.deckard+${rand}@thingtime.com`,
        password: 'password1',
        _ts: Date.now()
      },
      { namespace: 'default', tabLocal: true }
    );
  }, [setThingtime]);

  const prefillLogin = React.useCallback(() => {
    setThingtime(
      'devKit.loginPrefill',
      { username: 'rick.deckard', password: 'password1', _ts: Date.now() },
      { namespace: 'default', tabLocal: true }
    );
  }, [setThingtime]);

  const verifyEmailDev = React.useCallback(async () => {
    if (!user) {
      lopu({ title: 'Log in first 🙂', status: 'info' });
      return;
    }
    const resp = await api.v1.auth.resendVerification({ email: user.email });
    if (resp?.verificationLink) {
      try {
        await fetch(resp.verificationLink);
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

  const pushMusing = React.useCallback(() => {
    pushLopuMusing('/api/v1/lopu/musing');
  }, [pushLopuMusing]);

  if (!mounted || !devKit) return null;

  return (
    <>
      {open && pos ? (
        <Box
          position="fixed"
          left={`${pos.left}px`}
          top={`${pos.top}px`}
          zIndex={100000}
          width="260px"
          bg="var(--tt-card, #ffffff)"
          borderRadius="var(--tt-radius-lg, 16px)"
          boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20,20,40,0.3))"
          border="1px solid var(--tt-border, #ececef)"
          overflow="hidden"
        >
          <Flex
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            align="center"
            gap={2}
            px={3}
            py={2}
            background={RAINBOW}
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
              onClick={() => {
                // reset: forget the dragged spot, close the panel, and let the
                // trigger fall back to its default bottom-right corner
                try {
                  window.localStorage.removeItem(DEVKIT_TRIGGER_STORAGE_KEY);
                } catch {
                  // storage may be unavailable (private mode) — reset anyway
                }
                setTriggerPos(null);
                setPos(null);
                setOpen(false);
              }}
              aria-label="Reset position"
              title="Reset position — close and send the button back to bottom-right"
              fontSize="sm"
              opacity={0.85}
              marginRight={2}
              _hover={{ opacity: 1 }}
            >
              🎯
            </Box>
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

          <Flex direction="column" p={2} gap={1}>
            <Text
              px={3}
              pt={1}
              fontFamily="mono"
              fontSize="10px"
              fontWeight="700"
              letterSpacing="0.12em"
              color="var(--tt-muted, #9a9aa6)"
              textTransform="uppercase"
            >
              Forms
            </Text>
            <DevAction onClick={prefillRegister}>📝 Prefill register form</DevAction>
            <DevAction onClick={prefillLogin}>🔑 Prefill login form</DevAction>

            <Text
              px={3}
              pt={2}
              fontFamily="mono"
              fontSize="10px"
              fontWeight="700"
              letterSpacing="0.12em"
              color="var(--tt-muted, #9a9aa6)"
              textTransform="uppercase"
            >
              Lopu
            </Text>
            <DevAction onClick={pushMusing}>🔮 Push a Lopu musing</DevAction>

            <Text
              px={3}
              pt={2}
              fontFamily="mono"
              fontSize="10px"
              fontWeight="700"
              letterSpacing="0.12em"
              color="var(--tt-muted, #9a9aa6)"
              textTransform="uppercase"
            >
              Requests · tap to copy curl
            </Text>
            {apiCalls.length === 0 ? (
              <Text px={3} fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                No API calls yet — browse around 🌐
              </Text>
            ) : (
              apiCalls.slice(0, 8).map((entry) => {
                const status = describeApiStatus(entry);
                return (
                  <Flex
                    key={entry.id}
                    as="button"
                    type="button"
                    onClick={() => copyRequestAsCurl(entry)}
                    align="center"
                    gap={2}
                    px={3}
                    py="3px"
                    borderRadius="var(--tt-radius-sm, 9px)"
                    textAlign="left"
                    title={`${entry.method} ${entry.url} — copy as curl`}
                    _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
                  >
                    <Text as="span" fontFamily="mono" fontSize="10px" fontWeight="800" flexShrink={0}>
                      {entry.method}
                    </Text>
                    <Text
                      as="span"
                      fontFamily="mono"
                      fontSize="10px"
                      color="var(--tt-text, #5a5a66)"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                      flex={1}
                      minW={0}
                    >
                      {entry.url.replace('/api/v1', '')}
                    </Text>
                    <Text as="span" fontFamily="mono" fontSize="10px" fontWeight="700" flexShrink={0} color={API_TONE_COLOR[status.tone]}>
                      {status.label} · {entry.durationMs}ms
                    </Text>
                  </Flex>
                );
              })
            )}

            <Text
              px={3}
              pt={2}
              fontFamily="mono"
              fontSize="10px"
              fontWeight="700"
              letterSpacing="0.12em"
              color="var(--tt-muted, #9a9aa6)"
              textTransform="uppercase"
            >
              Account {user ? `· ${getUserDisplayName(user)}` : ''}
            </Text>
            {user ? (
              <>
                {!user.emailVerified && !user.temporary && <DevAction onClick={verifyEmailDev}>✉️ Verify my email (dev)</DevAction>}
                <DevAction onClick={() => navigate(user.temporary ? '/login' : '/profile')}>
                  {user.temporary ? `→ ${LOGIN_TO_CLAIM_LABEL}` : '🌈 Profile'}
                </DevAction>
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

      <Box
        className="tt.devKit"
        position="fixed"
        zIndex={99999}
        left={triggerPos ? `${triggerPos.left}px` : undefined}
        top={triggerPos ? `${triggerPos.top}px` : undefined}
        bottom={
          triggerPos
            ? undefined
            : 'calc(var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)) + var(--thingtime-devkit-bottom-offset, 20px))'
        }
        right={triggerPos ? undefined : 'calc(var(--thingtime-safe-area-right, env(safe-area-inset-right, 0px)) + 20px)'}
      >
        <Flex
          ref={triggerRef}
          role="button"
          tabIndex={0}
          aria-label="Move or open DevKit"
          aria-pressed={open}
          onClick={toggleOpenFromTrigger}
          onKeyDown={onTriggerKeyDown}
          onPointerDown={onTriggerPointerDown}
          onPointerMove={onTriggerPointerMove}
          onPointerUp={onTriggerPointerUp}
          onPointerCancel={onTriggerPointerUp}
          onMouseDown={onTriggerMouseDown}
          cursor="grab"
          position="relative"
          width="52px"
          height="52px"
          borderRadius="full"
          bg="var(--tt-ink, #16161a)"
          boxShadow="lg"
          alignItems="center"
          justifyContent="center"
          opacity={open ? 1 : 0.9}
          _active={{ transform: 'scale(0.92)' }}
          transition="transform 100ms ease"
          sx={{ userSelect: 'none', touchAction: 'none' }}
        >
          <Icon name="👨‍💻"></Icon>
          <Box
            position="absolute"
            top="-2px"
            right="-2px"
            width="14px"
            height="14px"
            borderRadius="full"
            border="2px solid"
            borderColor="white"
            background={mounted ? RAINBOW_CONIC : 'none'}
            bg={mounted ? undefined : 'gray.400'}
            boxShadow={mounted ? '0 0 8px rgba(165,85,232,0.7)' : 'none'}
            sx={mounted ? { animation: `${spin} 4s linear infinite` } : undefined}
          />
        </Flex>
      </Box>
    </>
  );
};
