import { useCallback, useState } from 'react';

import { createApiFailure, readApiResponsePayload } from './apiFailure';
import { recordApiCall } from './apiRequestLog';

export function useAsyncFetcher() {
  const [defaultOpts, setDefaultOpts] = useState({
    method: 'POST',
    encType: 'application/json'
  });

  const submit = useCallback(
    async (
      data,
      opts: { action: string; method?: string; encType?: string; signal?: AbortSignal; errorContext?: string }
    ) => {
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
      const method = nextOpts.method || 'POST';
      const started = performance.now();
      let response: Response;
      try {
        response = await fetch(nextOpts.action, {
          method,
          credentials: 'include',
          headers,
          body,
          signal: nextOpts.signal
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        recordApiCall({
          at: Date.now(),
          method,
          url: nextOpts.action,
          status: 0,
          ok: false,
          aborted,
          durationMs: Math.round(performance.now() - started),
          body: loggedBody
        });
        if (aborted) throw error;
        throw createApiFailure({ cause: error, action: nextOpts.errorContext, method });
      }
      recordApiCall({
        at: Date.now(),
        method,
        url: nextOpts.action,
        status: response.status,
        ok: response.ok,
        durationMs: Math.round(performance.now() - started),
        body: loggedBody
      });
      const payload = await readApiResponsePayload(response, {
        action: nextOpts.errorContext,
        method
      });

      if (!response.ok) {
        throw createApiFailure({
          payload,
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
          action: nextOpts.errorContext,
          method
        });
      }

      return payload;
    },
    [defaultOpts]
  );

  return { submit, setDefaultOpts };
}
