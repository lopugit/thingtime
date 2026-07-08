import { Outlet, ScrollRestoration, useLoaderData, useLocation, useRevalidator } from 'react-router';
import { Analytics } from '@vercel/analytics/react';
import React from 'react';

import type { RootLoaderData } from './root-data.server';
import { GlobalStyles } from './globals/GlobalStyles';
import { Main } from './components/Layout/Main';
import { Nav } from './components/Nav/Nav';
import { DrawerSystem } from './components/Nav/Drawer/DrawerSystem';
import { useIcons } from './hooks/useIcons';
import { ChakraWrapper } from './Providers/Chakra/ChakraWrapper';
import { ThingtimeProvider } from './Providers/ThingtimeProvider';
import { DevKit } from './components/DevKit/DevKit';
import { NativeBridgeHost } from './components/NativeBridge/NativeBridgeHost';
import { VisualSettingsHost } from './components/VisualSettings/VisualSettingsHost';
import { ThemeHost } from './components/ThemeSettings/ThemeHost';
import { ConfettiCanvas } from './components/Landing/ConfettiCanvas';
import { EasterEggs } from './components/EasterEggs/EasterEggs';

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
  const { pathname } = useLocation();
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
    if (typeof document !== 'undefined') {
      const baseTitle = titlePrefix ? `${titlePrefix} Thingtime` : 'Thingtime';
      const routeTitle = pathname.startsWith('/docs/design')
        ? `${baseTitle} docs - Design mockups`
        : pathname === '/docs'
          ? `${baseTitle} docs`
          : pathname === '/feed'
            ? `${baseTitle} - Feed`
            : pathname.startsWith('/profile')
              ? `${baseTitle} - Profile`
              : pathname === '/settings'
                ? `${baseTitle} - Settings`
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

  useIcons();

  return (
    <ChakraWrapper>
      <GlobalStyles />
      <ThingtimeProvider>
        <VisualSettingsHost />
        <ThemeHost />
        {mounted ? <NativeBridgeHost /> : null}
        <DevKit />
        <Nav />
        <Main>
          <Outlet />
        </Main>
        <DrawerSystem />
        {/* App-wide confetti canvas + easter eggs (🥚 party mode, window.tt). */}
        <ConfettiCanvas />
        {mounted ? <EasterEggs /> : null}
      </ThingtimeProvider>
      <ScrollRestoration />
      {mounted ? <Analytics /> : null}
    </ChakraWrapper>
  );
}
