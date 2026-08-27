import { definePlugin } from 'nitro';

import { ensureIndexes, warnIfTransactionsUnsupported } from '../../app/api/utils/mongodb/collections';

// Cold-start warmup: start the Mongo client connect + adoption pass + index
// ensure the moment a fresh instance boots, instead of awaiting them inside
// the first user's request (the old inline `await ensureIndexes()` on hot
// paths cost every new serverless instance a ~55-command createIndex battery
// mid-request). ensureIndexes shares in-flight/successful work per process;
// hot request paths do not await it, while the true bootstrap calls that remain
// in registerUser and the admin migrations await it before constrained writes.
//
// Fire-and-forget by design: an env-less deployment (api-fallback proxy mode,
// where getMongoUri throws synchronously) or a transient Atlas outage must
// not take the instance down. A failed run logs its broken index and clears its
// memoized promise so the next awaited bootstrap call can retry immediately.
export default definePlugin(() => {
  try {
    void ensureIndexes().catch(() => {});
    // One boot-time probe that names the standalone-mongod trap (transactions
    // unsupported) with its exact fix — see warnIfTransactionsUnsupported.
    void warnIfTransactionsUnsupported().catch(() => {});
  } catch {
    // no MONGODB env: fallback-proxy deployments boot without a database
  }
});
