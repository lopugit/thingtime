import React from 'react';

import axios from 'axios';
import { useFetcher } from '@remix-run/react';

export const useLogin = () => {
  const fetcher = useFetcher();

  const login = React.useCallback(async (email, password) => {
    try {
      fetcher.submit(
        { email, password },
        {
          method: 'post',
          action: '/api/v1/login'
        }
      );

      // const response = await axios.post('/api/v1/login', { email, password });
      // console.log('nik response', response.data);
      // return response.data;
    } catch (error) {
      return error;
    }
  }, []);

  return { login };
};
