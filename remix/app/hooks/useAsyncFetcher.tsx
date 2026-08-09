import { useCallback, useState } from 'react';

import { createApiFailure, readApiResponsePayload } from './apiFailure';

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

      const method = nextOpts.method || 'POST';
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
        if (error instanceof Error && error.name === 'AbortError') throw error;
        throw createApiFailure({ cause: error, action: nextOpts.errorContext, method });
      }
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
