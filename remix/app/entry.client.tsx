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
  const currentEmotionKeys = new Set(
    Array.from(document.querySelectorAll('style[data-emotion]')).map((style) =>
      style.getAttribute('data-emotion')
    )
  );

  for (const style of serverEmotionStyles) {
    const emotionKey = style.getAttribute('data-emotion');

    if (emotionKey && !currentEmotionKeys.has(emotionKey)) {
      document.head.appendChild(style.cloneNode(true));
      currentEmotionKeys.add(emotionKey);
    }
  }
};

const preserveServerEmotionStyles = () => {
  restoreServerEmotionStyles();

  const interval = window.setInterval(restoreServerEmotionStyles, 100);
  window.setTimeout(() => window.clearInterval(interval), 10000);
};

startTransition(() => {
  createRoot(document).render(
    <CacheProvider value={createEmotionCache()}>
      <RemixBrowser />
    </CacheProvider>
  );

  queueMicrotask(preserveServerEmotionStyles);
  requestAnimationFrame(preserveServerEmotionStyles);
  setTimeout(preserveServerEmotionStyles, 50);
});
