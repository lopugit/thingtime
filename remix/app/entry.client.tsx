import { CacheProvider } from '@emotion/react';
// import { RemixBrowser } from "remix";
import { RemixBrowser } from '@remix-run/react';
import React, { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

import {
  createEmotionCache,
  defaultEmotionCache
} from './Providers/Chakra/createEmotionCache';
import { ClientStyleContext } from './Providers/Chakra/emotionContext';

try {
  window.process = window.process || ({ env: {} } as any);
} catch (err) {
  // nothing
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

startTransition(() => {
  hydrateRoot(
    document,
    <ClientCacheProvider>
      <RemixBrowser />
    </ClientCacheProvider>
  );
});
