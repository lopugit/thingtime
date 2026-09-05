import { Outlet, ScrollRestoration, useLoaderData, useLocation, useRevalidator } from 'react-router';
import { Analytics } from '@vercel/analytics/react';
import React from 'react';

import type { RootLoaderData } from './root-data.server';
import { GlobalStyles } from './globals/GlobalStyles';
import { Main } from './components/Layout/Main';
import { Nav } from './components/Nav/Nav';
import { DrawerSystem } from './components/Nav/Drawer/DrawerSystem';
import { ChakraWrapper } from './Providers/Chakra/ChakraWrapper';
import { ThingtimeProvider } from './Providers/ThingtimeProvider';
import { DevKit } from './components/DevKit/DevKit';
import { ElectronBridgeHost } from './components/Electron/ElectronBridgeHost';
import { NativeBridgeHost } from './components/NativeBridge/NativeBridgeHost';
import { VisualSettingsHost } from './components/VisualSettings/VisualSettingsHost';
import { ThemeHost } from './components/ThemeSettings/ThemeHost';
import { ConfettiCanvas } from './components/Landing/ConfettiCanvas';
import { EasterEggs } from './components/EasterEggs/EasterEggs';
import { MessengerNotifications } from './components/Messenger/MessengerNotifications';
import { QuickSwitcher } from './components/QuickSwitcher/QuickSwitcher';
import { AutoLoginPopup } from './components/Account/AutoLoginPopup';
import { SiteBlocksHost } from './components/Builder/SiteBlocksHost';
import { rememberAuthReturnTo } from './utils/authReturn';

const setThingtime = (glob: any) => {
  try {
    glob.meta = {
      tmp: {},
      subscribers: {},
      state: {},
      db: {},
      stats: {
        db: {},
        limit: 9999,
        maxDepth: 99,
        count: 0
      },
      things: {}
    };
  } catch {
    // Global setup is best-effort in browser and server-like runtimes.
  }
};

try {
  setThingtime(window);
} catch {
  setThingtime(globalThis);
}

export default function App() {
  const rootData = useLoaderData() as RootLoaderData;
  const { envFromCookie, titlePrefix } = rootData;
  const { pathname, search, hash } = useLocation();
  const isAuthorizePopup = pathname === '/authorize' || pathname === '/watch/pair';
  const revalidator = useRevalidator();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);

    try {
      window.envFromCookie = {
        ...window.env,
        ...envFromCookie
      };
      window.env = {
        ...window.env,
        BRANCH_NAME: envFromCookie?.THINGTIME_BRANCH_NAME || 'git/unknown'
      };
    } catch {
      // Ignore non-browser runtimes.
    }
  }, [envFromCookie]);

  React.useEffect(() => {
    rememberAuthReturnTo(`${pathname}${search}${hash}`);
  }, [hash, pathname, search]);

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      const baseTitle = titlePrefix ? `${titlePrefix} Thingtime` : 'Thingtime';
      const routeTitle = pathname.startsWith('/docs/design')
        ? `${baseTitle} docs - Design mockups`
        : pathname === '/docs'
          ? `${baseTitle} docs`
          : pathname === '/feed'
            ? `${baseTitle} - Feed`
            : pathname === '/messages'
              ? `${baseTitle} - Messages`
              : pathname.startsWith('/profile')
              ? `${baseTitle} - Profile`
              : pathname === '/settings'
                ? `${baseTitle} - Settings`
                : pathname === '/admin'
                  ? `${baseTitle} - Admin`
                  : pathname === '/things'
                    ? `${baseTitle} - Things`
                    : pathname.startsWith('/builder')
                      ? `${baseTitle} - Builder`
                    : pathname.startsWith('/actions')
                      ? `${baseTitle} - Actions`
                      : pathname.startsWith('/components')
                        ? `${baseTitle} - Components`
                        : pathname === '/branding'
                          ? `${baseTitle} - Brand resources`
                          : baseTitle;

      document.title = routeTitle;
    }
  }, [pathname, titlePrefix]);

  React.useEffect(() => {
    const refreshRootData = () => {
      revalidator.revalidate();
    };

    window.addEventListener('thingtime:root-data-refresh', refreshRootData);
    return () => window.removeEventListener('thingtime:root-data-refresh', refreshRootData);
  }, [revalidator]);


  return (
    <ChakraWrapper>
      <GlobalStyles />
      <ThingtimeProvider>
        <VisualSettingsHost />
        <ThemeHost />
        {mounted ? <ElectronBridgeHost /> : null}
        {mounted ? <NativeBridgeHost /> : null}
        {/* /authorize is the "Login with Thingtime" popup — a focused embed
            surface with its own chrome, so the app shell (nav, drawer trigger,
            DevKit bubble, Main's footer + its 900px spacer) stays out of it. */}
        {isAuthorizePopup ? null : <DevKit />}
        {isAuthorizePopup ? null : <Nav />}
        {isAuthorizePopup ? (
          <Outlet />
        ) : (
          <Main>
            {/* every page is a block-based site: per-route + global blocks
                render around the native screen; the ✏️ pill enters edit mode */}
            <SiteBlocksHost>
              <Outlet />
            </SiteBlocksHost>
          </Main>
        )}
        {isAuthorizePopup ? null : <DrawerSystem />}
        {/* ⌘K quick switcher — global palette; renders nothing until opened. */}
        {mounted && !isAuthorizePopup ? <QuickSwitcher /> : null}
        {/* Messenger: global new-message watcher (Lopu toasts + unread badge). */}
        {mounted && !isAuthorizePopup ? <MessengerNotifications /> : null}
        {/* Signed out here but signed in on another Thingtime deployment →
            "continue as" suggestions (cross-deployment auto-login). */}
        {mounted && !isAuthorizePopup ? <AutoLoginPopup /> : null}
        {/* App-wide confetti canvas + easter eggs (🥚 party mode, window.tt). */}
        <ConfettiCanvas />
        {mounted ? <EasterEggs /> : null}
      </ThingtimeProvider>
      <ScrollRestoration />
      {mounted ? <Analytics /> : null}
    </ChakraWrapper>
  );
}
