import { CacheProvider } from '@emotion/react';
// import { RemixBrowser } from "remix";
import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { createRoot } from 'react-dom/client';

import { createEmotionCache } from './Providers/Chakra/createEmotionCache';

try {
  window.process = window.process || { env: {} };
} catch (err) {
  // nothing
}

const serverEmotionStyles = Array.from(document.querySelectorAll('style[data-emotion]')).map(
  (style) => style.cloneNode(true) as HTMLStyleElement
);

const restoreServerEmotionStyles = () => {
  for (const style of serverEmotionStyles) {
    const emotionKey = style.getAttribute('data-emotion');

    if (emotionKey && !document.querySelector(`style[data-emotion="${emotionKey}"]`)) {
      document.head.appendChild(style);
    }
  }
};

startTransition(() => {
  createRoot(document).render(
    <CacheProvider value={createEmotionCache()}>
      <RemixBrowser />
    </CacheProvider>
  );

  queueMicrotask(restoreServerEmotionStyles);
  requestAnimationFrame(restoreServerEmotionStyles);
  setTimeout(restoreServerEmotionStyles, 50);
  setTimeout(restoreServerEmotionStyles, 250);
});
