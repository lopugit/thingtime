import { definePlugin } from 'nitro';

import { ensureIndexes } from '../../app/api/utils/mongodb/collections';

// Cold-start warmup: start the Mongo client connect + adoption pass + index
// ensure the moment a fresh instance boots, instead of awaiting them inside
// the first user's request (the old inline `await ensureIndexes()` on hot
// paths cost every new serverless instance a ~55-command createIndex battery
// mid-request). ensureIndexes memoises per process, so request paths that
// race this warmup simply await the same promise-in-flight via their own
// collection getters; index CREATION is otherwise guaranteed by the awaited
// bootstrap calls that remain in registerUser and the admin migrations.
//
// Fire-and-forget by design: an env-less deployment (api-fallback proxy mode,
// where getMongoUri throws synchronously) or a transient Atlas outage must
// not take the instance down — request paths surface real errors themselves
// the moment they touch the db.
export default definePlugin(() => {
  try {
    void ensureIndexes().catch(() => {});
  } catch {
    // no MONGODB env: fallback-proxy deployments boot without a database
  }
});
