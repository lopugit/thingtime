import './components/Timeline/timelineBrowser.css';
import { registerMediaCache } from './utils/mediaCache.client';
import { CacheProvider } from '@emotion/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import {
  createEmotionCache,
  defaultEmotionCache
} from './Providers/Chakra/createEmotionCache';
import { ClientStyleContext } from './Providers/Chakra/emotionContext';
import { router } from './routes';
import { PersistedThingMenuLoaderContext } from './components/Thingtime/ContextMenu/PersistedThingContextMenu';
import { bindRootIdentityChannel, rootIdentity } from './utils/rootIdentity';
import { watchDesktopBundleActivation } from './utils/desktopBundleActivation';
import { getElectronBridge } from './utils/electronBridge';
import { createDesktopRendererBootHealth, watchDesktopRendererReady } from './utils/desktopRendererReady';
import {
  clearStaleChunkReloadGuard,
  reloadForStaleChunk,
  STALE_CHUNK_GUARD_RESET_MS
} from './utils/staleChunkRecovery';

const loadPersistedThingMenu = () => import('./components/Thingtime/ContextMenu/PersistedThingMenuController');

try {
  window.process = window.process || ({ env: {} } as any);
} catch (err) {
  // nothing
}

try {
  const identityChannel = new BroadcastChannel('thingtime:root-identity');
  const unbind = bindRootIdentityChannel(rootIdentity, identityChannel, () => { void router.revalidate(); });
  import.meta.hot?.dispose(() => { unbind(); identityChannel.close(); });
} catch {
  // Restricted browser contexts may disable cross-tab messaging.
}

// Stale-chunk self-heal: after a redeploy, an already-open tab still holds the
// OLD index.html, whose lazy route imports point at chunk hashes the new
// deployment no longer serves — navigation then dies with "Failed to fetch
// dynamically imported module". Vite surfaces exactly that as
// `vite:preloadError`; one hard reload fetches the fresh HTML + chunk graph.
// A session guard (cleared on success) stops a reload loop when the network
// itself is broken.
window.addEventListener('vite:preloadError', (event) => {
  // Prevent Vite's default error surface only when this tab successfully
  // claimed its one guarded recovery reload.
  reloadForStaleChunk(() => event.preventDefault());
});
// A page that stayed healthy for a while clears the guard so the NEXT redeploy
// can heal too. Clearing at boot would let a truly broken deploy reload forever
// (fail -> reload -> clear -> fail ...).
window.setTimeout(clearStaleChunkReloadGuard, STALE_CHUNK_GUARD_RESET_MS);

function ClientCacheProvider({ children }: { children: React.ReactNode }) {
  const [cache, setCache] = React.useState(defaultEmotionCache);

  const reset = React.useCallback(() => {
    setCache(createEmotionCache());
  }, []);
  const contextValue = React.useMemo(() => ({ reset }), [reset]);

  return (
    <ClientStyleContext.Provider value={contextValue}>
      <CacheProvider value={cache}>{children}</CacheProvider>
    </ClientStyleContext.Provider>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Thingtime root element was not found.');
}

const desktopBootHealth = createDesktopRendererBootHealth();
function DesktopRendererReady() {
  React.useEffect(() => watchDesktopRendererReady({ router, root: root!, bridge: getElectronBridge(), isHealthy: desktopBootHealth.isHealthy }), []);
  React.useEffect(() => watchDesktopBundleActivation({ router, bridge: getElectronBridge(), isHealthy: desktopBootHealth.isHealthy }), []);
  return null;
}

createRoot(root).render(
  <React.StrictMode>
    <ClientCacheProvider>
      <PersistedThingMenuLoaderContext.Provider value={loadPersistedThingMenu}>
        <RouterProvider router={router} onError={error => { desktopBootHealth.onError(); console.error(error); }} />
        <DesktopRendererReady />
      </PersistedThingMenuLoaderContext.Provider>
    </ClientCacheProvider>
  </React.StrictMode>
);

void registerMediaCache();
