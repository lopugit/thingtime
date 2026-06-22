import { CacheProvider } from '@emotion/react';
// import { RemixBrowser } from "remix";
import { RemixBrowser } from '@remix-run/react';
import { hydrateRoot } from 'react-dom/client';

import { createEmotionCache } from './Providers/Chakra/createEmotionCache';

try {
  window.process = window.process || { env: {} };
} catch (err) {
  // nothing
}

hydrateRoot(
  document,
  <CacheProvider value={createEmotionCache()}>
    <RemixBrowser />
  </CacheProvider>
);
