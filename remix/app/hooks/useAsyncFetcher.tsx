import { useCallback, useState } from 'react';

import { recordApiCall } from './apiRequestLog';

export function useAsyncFetcher() {
  const [defaultOpts, setDefaultOpts] = useState({
    method: 'POST',
    encType: 'application/json'
  });

  const submit = useCallback(
    async (data, opts: { action: string; method?: string; encType?: string; signal?: AbortSignal }) => {
      const nextOpts = { ...defaultOpts, ...opts };
      const headers = new Headers();
      let body: BodyInit | undefined;

      if (nextOpts.encType === 'application/json') {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(data || {});
      } else {
        const formData = new FormData();
        Object.entries(data || {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            formData.set(key, String(value));
          }
        });
        body = formData;
      }

      // DevKit request log: every mutation is timed + recorded (body is
      // redacted by the recorder before it is stored)
      const loggedBody = nextOpts.encType === 'application/json' ? data || {} : undefined;
      const started = performance.now();
      let response: Response;
      try {
        response = await fetch(nextOpts.action, {
          method: nextOpts.method || 'POST',
          credentials: 'include',
          headers,
          body,
          signal: nextOpts.signal
        });
      } catch (err) {
        recordApiCall({
          at: Date.now(),
          method: nextOpts.method || 'POST',
          url: nextOpts.action,
          status: 0,
          ok: false,
          durationMs: Math.round(performance.now() - started),
          body: loggedBody
        });
        throw err;
      }
      recordApiCall({
        at: Date.now(),
        method: nextOpts.method || 'POST',
        url: nextOpts.action,
        status: response.status,
        ok: response.ok,
        durationMs: Math.round(performance.now() - started),
        body: loggedBody
      });
      const contentType = response.headers.get('Content-Type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        throw payload;
      }

      return payload;
    },
    [defaultOpts]
  );

  return { submit, setDefaultOpts };
}
