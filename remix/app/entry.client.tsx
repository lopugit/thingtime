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

try {
  window.process = window.process || ({ env: {} } as any);
} catch (err) {
  // nothing
}

// Stale-chunk self-heal: after a redeploy, an already-open tab still holds the
// OLD index.html, whose lazy route imports point at chunk hashes the new
// deployment no longer serves — navigation then dies with "Failed to fetch
// dynamically imported module". Vite surfaces exactly that as
// `vite:preloadError`; one hard reload fetches the fresh HTML + chunk graph.
// A session guard (cleared on success) stops a reload loop when the network
// itself is broken.
try {
  const RELOAD_FLAG = 'tt-chunk-reload';
  window.addEventListener('vite:preloadError', (event) => {
    if (sessionStorage.getItem(RELOAD_FLAG)) return; // second failure — surface it
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    (event as Event).preventDefault?.();
    window.location.reload();
  });
  // a page that stayed healthy for a while clears the guard so the NEXT
  // redeploy can heal too — clearing at boot would let a truly broken deploy
  // reload forever (fail → reload → clear → fail …)
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      // ignore
    }
  }, 10_000);
} catch (err) {
  // sessionStorage unavailable (private mode edge cases) — let errors surface
}

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

createRoot(root).render(
  <React.StrictMode>
    <ClientCacheProvider>
      <RouterProvider router={router} />
    </ClientCacheProvider>
  </React.StrictMode>
);
