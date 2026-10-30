import { AsyncLocalStorage } from 'node:async_hooks';

// The dispatcher owns this context. No enterWith/global token cache: concurrent
// requests and account switching must never borrow another user's grant.
const requests = new AsyncLocalStorage<Request>();
export const withVaultRequest = <T>(request: Request, work: () => T): T => requests.run(request, work);
export const vaultRequest = () => requests.getStore();
