import { createContext, useContext } from 'react';
import type { AccountLocalView } from './accountApi.client';

/** Local destination only. useApi still takes remote authority from the actual
 * root identity; this context cannot select a remote database or account. */
export const LocalApiView = createContext<AccountLocalView>({});
export const useLocalApiView = () => useContext(LocalApiView);
