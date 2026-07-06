import { useCallback, useState } from 'react';

export function useAsyncFetcher() {
  const [defaultOpts, setDefaultOpts] = useState({
    method: 'POST',
    encType: 'application/json'
  });

  const submit = useCallback(
    async (data, opts: { action: string; method?: string; encType?: string }) => {
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

      const response = await fetch(nextOpts.action, {
        method: nextOpts.method || 'POST',
        credentials: 'include',
        headers,
        body
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
