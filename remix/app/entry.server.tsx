import { RemixServer } from '@remix-run/react';
import type { EntryContext } from '@remix-run/react/dist/entry';
import { CacheProvider } from '@emotion/react';
import * as emotionServerModule from '@emotion/server/create-instance';
import type createEmotionServer from '@emotion/server/create-instance';
import { renderToString } from 'react-dom/server';

import { createEmotionCache } from './Providers/Chakra/createEmotionCache';
import { ServerStyleContext } from './Providers/Chakra/emotionContext';

type EmotionServerFactory = typeof createEmotionServer;

const getExport = (value: unknown, key: 'default') => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
};

const resolveEmotionServerFactory = (moduleValue: unknown) => {
  const candidates = [
    moduleValue,
    getExport(moduleValue, 'default'),
    getExport(getExport(moduleValue, 'default'), 'default'),
  ];

  return candidates.find((candidate): candidate is EmotionServerFactory => typeof candidate === 'function');
};

const createEmotionServerInstance = resolveEmotionServerFactory(emotionServerModule);

if (!createEmotionServerInstance) {
  throw new Error(
    'Emotion server factory import failed. Expected a function export from @emotion/server/create-instance.',
  );
}

export default function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, remixContext: EntryContext) {
  const cache = createEmotionCache();
  const { extractCriticalToChunks } = createEmotionServerInstance(cache);
  const html = renderToString(
    <ServerStyleContext.Provider value={null}>
      <CacheProvider value={cache}>
        <RemixServer context={remixContext} url={request.url} />
      </CacheProvider>
    </ServerStyleContext.Provider>
  );
  const chunks = extractCriticalToChunks(html);
  const markup = renderToString(
    <ServerStyleContext.Provider value={chunks.styles}>
      <CacheProvider value={cache}>
        <RemixServer context={remixContext} url={request.url} />
      </CacheProvider>
    </ServerStyleContext.Provider>
  );

  responseHeaders.set('Content-Type', 'text/html');

  return new Response(`<!DOCTYPE html>${markup}`, {
    status: responseStatusCode,
    headers: responseHeaders
  });
}
