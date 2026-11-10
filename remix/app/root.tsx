import { LopuInstructionsSync } from './local-workspace/lopuInstructions.client';
import { CharacterContentRoute } from './components/Characters/CharacterContentScope';
import { LocalMediaDiagnostics } from './local-workspace/media.client';
import { AccountSyncStatus } from './local-workspace/AccountSyncStatus';
import { BrowserExtensionAccountBridge } from './components/Passwords/BrowserExtensionAccountBridge';
import { ThingDraftsProvider } from './drafts/ThingDrafts';
import { MobileDevicePresenceBootstrap } from './components/Devices/MobileDevicePresenceBootstrap';
import { NativeSyncBootstrap } from './fileSync/NativeSyncBootstrap';
import { RemoteSyncBootstrap } from './fileSync/RemoteSyncBootstrap';
import { PAGE_VIEWPORT_CSS } from './components/Layout/pageViewport';
import { LOPU_WINDOW_Z } from './components/Nav/Drawer/useDrawer';
import { useBackgroundRefresh } from '~/hooks/useBackgroundRefresh';
import { Outlet, ScrollRestoration, useLoaderData, useLocation, useRevalidator } from 'react-router';
import { Box } from '@chakra-ui/react';
import { Analytics } from '@vercel/analytics/react';
import React from 'react';
import { pageTitle } from './utils/pageTitle';

import type { ClientRootData } from './local-workspace/rootFallback';
import { LOCAL_WORKSPACE_OWNER } from './local-workspace/runtime.client';
import { GlobalStyles } from './globals/GlobalStyles';
import { Main } from './components/Layout/Main';
import { Nav } from './components/Nav/Nav';
import { DrawerSystem } from './components/Nav/Drawer/DrawerSystem';
import { ChakraWrapper } from './Providers/Chakra/ChakraWrapper';
import { LocalApiView } from './local-workspace/LocalApiView';
import { WorkspaceThingtimeProvider } from './local-workspace/WorkspaceThingtimeProvider';
import { SharePreviewHost } from './components/Sharing/SharePreviewHost';
import { TimelineHost } from './components/Timeline/TimelineHost';
import { ThingReplicaSyncHost } from './storage/ThingReplicaSyncHost';
import { TimelineProvider } from './timeline/TimelineProvider';
import { CurrentPageBuilderProvider, CurrentPageBuilderToggle } from './components/Builder/CurrentPageBuilder';
import { BUILDER_OVERLAY_CHROME_CSS } from './components/Builder/BuilderOverlayHost';
import { DevKit } from './components/DevKit/DevKit';
import { ElectronBridgeHost } from './components/Electron/ElectronBridgeHost';
import { NativeBridgeHost } from './components/NativeBridge/NativeBridgeHost';
import { LidarScanProvider } from './components/NativeBridge/LidarScanProvider';
import { VisualSettingsHost } from './components/VisualSettings/VisualSettingsHost';
import { ThemeHost } from './components/ThemeSettings/ThemeHost';
import { ConfettiCanvas } from './components/Landing/ConfettiCanvas';
import { EasterEggs } from './components/EasterEggs/EasterEggs';
import { LopuPositionSync } from './components/Lopu/useLopuPosition';
import { MessengerNotifications } from './components/Messenger/MessengerNotifications';
import { AutoLoginPopup } from './components/Account/AutoLoginPopup';
import { WatchPendingApprovals } from './components/Watch/WatchPendingApprovals';
import { SiteBlocksHost } from './components/Builder/SiteBlocksHost';
import { LopuPageTracker } from './components/Lopu/useLopuPages';
import { LopuHost } from './components/Lopu/LopuHost';
import { rememberAuthReturnTo } from './utils/authReturn';
import { bindTransferIdentity } from './utils/thingTransfer/intent';
import { rootIdentity } from './utils/rootIdentity';
import { RootRecovery } from './components/Layout/RootRecovery';

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

const incomingShareApiView = { cloudOnly: true } as const;

export default function App() {
  const rootData = useLoaderData() as ClientRootData & { clientIdentityGeneration: number };
  const contentOwnerId = rootData.offlineWorkspace?.ownerId || (rootData.user && !rootData.user.temporary ? rootData.user.id : undefined);
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  React.useLayoutEffect(() => { rootIdentity.confirm(rootData.clientIdentityGeneration); }, [rootData.clientIdentityGeneration]);
  const { envFromCookie, titlePrefix } = rootData;
  const { pathname, search, hash } = useLocation();
  const isStandalonePage = pathname.startsWith('/t/');
  const isPasswordSurface = pathname === '/passwords' || pathname === '/settings/passwords';
  const isAuthorizePopup = isStandalonePage || pathname === '/share' || pathname === '/invite' || pathname === '/authorize' || pathname === '/passwords/provider' || pathname === '/watch/pair' || pathname.startsWith('/pair/');
  const revalidator = useRevalidator();
  const [mounted, setMounted] = React.useState(false);
  React.useLayoutEffect(() => bindTransferIdentity(rootIdentity, contentOwnerId || LOCAL_WORKSPACE_OWNER, rootData.clientIdentityGeneration),
    [contentOwnerId, rootData.dataPlane, rootData.clientIdentityGeneration]);

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
    // Invite fragments are bearer credentials, never persist them as return-to hints.
    if (pathname === '/invite') return;
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

  useBackgroundRefresh('root-data', () => revalidator.state === 'idle' ? revalidator.revalidate() : undefined, 60_000, false);

  if (identity.pending && rootData.clientIdentityGeneration !== identity.generation) return <RootRecovery refreshing />;

  const nativeOwner = !identity.pending && rootData.dataPlane === 'home' && rootData.user?.accountKind === 'user' &&
    !rootData.user.temporary && !rootData.user.isCharacter ? rootData.user.id : undefined;

  return (
    <ChakraWrapper>
      <GlobalStyles />
      <style>{`
        ${PAGE_VIEWPORT_CSS}
        ${BUILDER_OVERLAY_CHROME_CSS}
        html[data-lopu-docked] #lopuPageViewport:not([data-lopu-split]) [data-testid="site-edit-pill"],
        html[data-lopu-docked] #lopuPageViewport:not([data-lopu-split]) [class~="tt.devKit"],
        html[data-lopu-sheet="open"] [data-testid="site-edit-pill"] { z-index: ${LOPU_WINDOW_Z - 1} !important; }
      `}</style>
      <WorkspaceThingtimeProvider>
        <CurrentPageBuilderProvider>
        <ThingDraftsProvider>
         <TimelineProvider>
         <LidarScanProvider ownerId={nativeOwner} generation={identity.generation}>
         {mounted && !isAuthorizePopup ? <><TimelineHost /><ThingReplicaSyncHost ownerId={nativeOwner} generation={identity.generation} dataPlane={rootData.dataPlane} /><SharePreviewHost /></> : null}
        <VisualSettingsHost />
        {mounted ? <BrowserExtensionAccountBridge /> : null}
        <LopuPageTracker />
        <ThemeHost />
        {/* Mirrors settings.lopu.position into the cache useLopu reads at fire time. */}
        <LopuPositionSync />
        {mounted ? <ElectronBridgeHost /> : null}
        {mounted && nativeOwner ?
          <><MobileDevicePresenceBootstrap ownerId={nativeOwner} generation={identity.generation} />
          <NativeSyncBootstrap ownerId={nativeOwner} generation={identity.generation} />
          <RemoteSyncBootstrap ownerId={nativeOwner} generation={identity.generation} /></> : null}
        {mounted ? <NativeBridgeHost /> : null}
        {/* Invite signup and authorization/pairing use a focused auth
            surface with their own chrome, so the app shell (nav, drawer trigger,
            DevKit bubble, Main's footer + its 900px spacer) stays out of it. */}
        <div id="lopuPageViewport">
        {isAuthorizePopup || isPasswordSurface ? null : <DevKit />}
        {isAuthorizePopup ? null : <Nav />}
        <div id="lopuPageScroll">
        {isAuthorizePopup ? (
          <>
            {pathname === '/passwords/provider' && nativeOwner ? (
              <Box display="flex" justifyContent="flex-end" px={4} pt={2}>
                <CurrentPageBuilderToggle />
              </Box>
            ) : null}
            {pathname === '/share' ? <LocalApiView.Provider value={incomingShareApiView}><Outlet /></LocalApiView.Provider> : <Outlet />}
          </>
        ) : (
          <Main>
            <AccountSyncStatus />
            <LopuInstructionsSync />
            <LocalMediaDiagnostics />
            {/* Per-route and global blocks render around the native screen. */}
            <SiteBlocksHost>
              <CharacterContentRoute><Outlet /></CharacterContentRoute>
            </SiteBlocksHost>
          </Main>
        )}
        </div>
        {isAuthorizePopup ? null : <DrawerSystem />}
        </div>
        {/* 🦄 Lopu: global floating launcher + draggable chat window (hidden on /lopu). */}
        {mounted && !isAuthorizePopup && !isPasswordSurface ? <LopuHost /> : null}
        {/* ⌘K quick switcher — global palette; renders nothing until opened. */}
        {/* Messenger: global new-message watcher (Lopu toasts + unread badge). */}
        {mounted && !isAuthorizePopup ? <MessengerNotifications /> : null}
        {mounted && !isAuthorizePopup ? <WatchPendingApprovals /> : null}
        {/* Signed out here but signed in on another Thingtime deployment →
            "continue as" suggestions (cross-deployment auto-login). */}
        {mounted && !isAuthorizePopup ? <AutoLoginPopup /> : null}
        {/* App-wide confetti canvas + easter eggs (🥚 party mode, window.tt). */}
        {!isStandalonePage ? <ConfettiCanvas /> : null}
        {mounted && !isStandalonePage ? <EasterEggs /> : null}
         </LidarScanProvider>
         </TimelineProvider>
        </ThingDraftsProvider>
        </CurrentPageBuilderProvider>
      </WorkspaceThingtimeProvider>
      <ScrollRestoration />
      {/* Only Vercel deployments serve the insights script. Local/fork and
          offline shells must not parse their SPA fallback as JavaScript. */}
      {mounted && envFromCookie.THINGTIME_VERCEL_URL && envFromCookie.THINGTIME_VERCEL_ENV !== 'development' ? <Analytics /> : null}
    </ChakraWrapper>
  );
}
