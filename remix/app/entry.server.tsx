import { RemixServer } from '@remix-run/react';
import type { EntryContext } from '@remix-run/react/dist/entry';
import { CacheProvider } from '@emotion/react';
import createEmotionServer from '@emotion/server/create-instance';
import { renderToString } from 'react-dom/server';

import { createEmotionCache } from './Providers/Chakra/createEmotionCache';

const removeEmotionInlineStyles = (markup: string) =>
  markup.replace(/<style data-emotion="[^"]*">[\s\S]*?<\/style>/g, '');

const emotionStylesToHtml = (styles: ReturnType<ReturnType<typeof createEmotionServer>['extractCriticalToChunks']>['styles']) =>
  styles
    .map(
      (style) =>
        `<style data-emotion="${style.key} ${style.ids.join(' ')}">${style.css}</style>`
    )
    .join('');

export default function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, remixContext: EntryContext) {
  const cache = createEmotionCache();
  const { extractCriticalToChunks } = createEmotionServer(cache);
  const markup = renderToString(
    <CacheProvider value={cache}>
      <RemixServer context={remixContext} url={request.url} />
    </CacheProvider>
  );
  const chunks = extractCriticalToChunks(markup);
  const emotionStyles = emotionStylesToHtml(chunks.styles);
  const html = removeEmotionInlineStyles(markup).replace('</head>', `${emotionStyles}</head>`);

  responseHeaders.set('Content-Type', 'text/html');

  return new Response('<!DOCTYPE html>' + html, {
    status: responseStatusCode,
    headers: responseHeaders
  });
}
