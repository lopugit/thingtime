import { CacheProvider } from '@emotion/react';
// import { RemixBrowser } from "remix";
import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { createEmotionCache } from './Providers/Chakra/createEmotionCache';
import type { EmotionStyleData } from './Providers/Chakra/emotionContext';
import { ServerStyleContext } from './Providers/Chakra/emotionContext';

try {
  window.process = window.process || ({ env: {} } as any);
} catch (err) {
  // nothing
}

const emotionCache = createEmotionCache();
const serverStyleData: EmotionStyleData[] = Array.from(
  document.querySelectorAll<HTMLStyleElement>('style[data-emotion]')
).map((style) => {
  const [key, ...ids] = (style.getAttribute('data-emotion') || '').split(' ');

  return {
    key,
    ids,
    css: style.textContent || ''
  };
});

startTransition(() => {
  hydrateRoot(
    document,
    <ServerStyleContext.Provider value={serverStyleData}>
      <CacheProvider value={emotionCache}>
        <RemixBrowser />
      </CacheProvider>
    </ServerStyleContext.Provider>
  );
});
