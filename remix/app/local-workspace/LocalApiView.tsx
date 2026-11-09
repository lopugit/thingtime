import { createContext, useContext } from 'react';
import type { AccountLocalView } from './accountApi.client';

/** Select the local destination, or opt an explicit cloud flow out of local
 * queues. Neither setting selects a different remote account or data plane. */
export const LocalApiView = createContext<AccountLocalView>({});
export const useLocalApiView = () => useContext(LocalApiView);
