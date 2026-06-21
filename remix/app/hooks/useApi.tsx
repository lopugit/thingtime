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
    auth: {
      register: useCallback(
        async (args) => {
          const { username, password, email, displayName } = args;
          const ret = asyncFetcher.submit(
            { username, password, email, displayName },
            { action: '/api/v1/auth/register' }
          );
          return ret;
        },
        [asyncFetcher]
      ),
      resendVerification: useCallback(
        async (args) => {
          const { email } = args;
          const ret = asyncFetcher.submit({ email }, { action: '/api/v1/auth/resend-verification' });
          return ret;
        },
        [asyncFetcher]
      ),
      logout: useCallback(
        async () => {
          const ret = asyncFetcher.submit({}, { action: '/api/v1/auth/logout' });
          return ret;
        },
        [asyncFetcher]
      )
    },
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
