import { PassThrough } from 'node:stream';

import { createReadableStreamFromReadable } from '@remix-run/node';
import { RemixServer } from '@remix-run/react';
import type { EntryContext } from '@remix-run/react/dist/entry';
import { renderToPipeableStream } from 'react-dom/server';

const ABORT_DELAY = 5000;

// Single Fetch (v3_singleFetch) streams loader data to the client via
// `window.__remixContext.stream`. That stream is only enqueued + CLOSED while
// React streams the response, so the server MUST use a streaming renderer.
// The old synchronous renderToString never closed the stream, so the client
// hydration suspended forever (page rendered, but no event handlers attached).
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;

    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} />,
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set('Content-Type', 'text/html');

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            // log streaming errors that happen after the shell flushed
            console.error(error);
          }
        }
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
