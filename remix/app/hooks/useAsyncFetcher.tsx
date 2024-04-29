import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';

export function useAsyncFetcher() {
  let resolveRef = useRef<any>();
  let promiseRef = useRef<Promise<any>>();
  let fetcher = useFetcher();

  if (!promiseRef.current) {
    promiseRef.current = new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }

  const resetResolver = useCallback(() => {
    promiseRef.current = new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, [promiseRef, resolveRef]);
  
  const [defaultOpts, setDefaultOpts] = useState({
    method: 'POST',
    encType: 'application/json'
  })

  const submit = useCallback(
    async (data, opts) => {
      // @ts-ignore
      fetcher.submit(data, { ...defaultOpts, ...opts });
      return promiseRef.current;
    },
    [fetcher, promiseRef]
  );

  useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') {
      resolveRef.current(fetcher.data);
      resetResolver();
    }
  }, [fetcher, resetResolver]);
  
  
  return { ...fetcher, submit };
}
