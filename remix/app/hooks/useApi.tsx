import { useCallback, useEffect, useRef } from 'react';

import { useAsyncFetcher } from './useAsyncFetcher';

export function useApi() {
  const asyncFetcher = useAsyncFetcher();

  const v1 = {
    login: useCallback(
      async (args) => {
        const { username, password } = args;

        const ret = asyncFetcher.submit({ username, password }, { action: '/api/v1/login' });
        return ret;
      },
      [asyncFetcher]
    ),
    mongodb: {
      rawResults: useCallback(
        async (args) => {
          const { query } = args;

          console.log('submitting query', query);

          const ret = asyncFetcher.submit({ query }, { action: '/api/v1/mongodb/raw-results' });
          return ret;
        },
        [asyncFetcher]
      )
    }
  };

  const ret = {
    v1
  };

  return ret;
}
