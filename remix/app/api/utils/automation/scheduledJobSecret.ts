import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

// Adapt a verified controller invocation to the existing, local-only loader
// contract. Never send this request over the network or install a process key.
const invocation = new AsyncLocalStorage<string>();
export const scheduledJobSecret = () => invocation.getStore() ?? process.env.CRON_SECRET;
export function withVerifiedScheduledRequest(request: Request, run: (request: Request) => Promise<Response>) {
  const key = randomBytes(32).toString('hex');
  const local = new Request(request.url, { headers: { authorization: 'Bearer ' + key }, signal: request.signal });
  return invocation.run(key, () => run(local));
}
