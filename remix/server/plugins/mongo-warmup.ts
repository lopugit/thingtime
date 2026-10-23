import { definePlugin } from 'nitro';
import { agentTestEnvironment } from '../../app/api/utils/agentTesting';
import { hasSelfHostedApiEnv } from '../utils/apiFallback';

import { ensureIndexes, warnIfTransactionsUnsupported } from '../../app/api/utils/mongodb/collections';

// Cold-start warmup: start the Mongo client connect + adoption pass + index
// ensure the moment a fresh instance boots, instead of awaiting them inside
// the first user's request (the old inline `await ensureIndexes()` on hot
// paths cost every new serverless instance a ~55-command createIndex battery
// mid-request). ensureIndexes shares in-flight/successful work per process;
// hot request paths do not await it, while the true bootstrap calls that remain
// in registerUser and the admin migrations await it before constrained writes.
//
// An incomplete server must not connect or create indexes before the request
// guard can reject it. Explicit desktop bridges also skip local DB warmup.
export default definePlugin(() => {
  // A malformed isolated test must never connect or adopt remote storage.
  agentTestEnvironment();
  if (!hasSelfHostedApiEnv()) return;
  try {
    void ensureIndexes().catch(() => {});
    // One boot-time probe that names the standalone-mongod trap (transactions
    // unsupported) with its exact fix — see warnIfTransactionsUnsupported.
    void warnIfTransactionsUnsupported().catch(() => {});
  } catch {
    // A configured but unavailable database must not crash static serving.
  }
});
