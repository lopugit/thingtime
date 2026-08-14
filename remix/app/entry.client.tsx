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
