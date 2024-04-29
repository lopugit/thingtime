import { useCallback, useEffect, useRef } from 'react';

import { useAsyncFetcher } from './useAsyncFetcher';

export function useApi() {
  const asyncFetcher = useAsyncFetcher();

  const v1 = {
    login: useCallback(
      async (args) => {
        const { username, password } = args;
        
        console.log('nik submitting with username', username);
        console.log('nik submitting with password', password);
        
        const ret = asyncFetcher.submit({ username, password }, { action: '/api/v1/login' });
        return ret;
      },
      [asyncFetcher]
    )
  };

  const ret = {
    v1
  };

  return ret;
}
