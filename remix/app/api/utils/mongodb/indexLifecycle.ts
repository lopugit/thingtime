import { createHash, randomUUID } from 'node:crypto';

// Increment for bootstrap/backfill changes or incompatible index-plan changes.
// Higher completed versions reject older workers instead of restoring old specs.
export const INDEX_MAINTENANCE_VERSION = 1;
export const INDEX_COMMAND_MAX_TIME_MS = 15_000;
export type IndexExecutionOptions = { commandMaxTimeMS?: number; leaseMs?: number; waitMs?: number };
export const indexExecutionPolicy = (options: IndexExecutionOptions = {}) => {
  const policy = { commandMaxTimeMS: options.commandMaxTimeMS ?? INDEX_COMMAND_MAX_TIME_MS,
    leaseMs: options.leaseMs ?? 300_000, waitMs: options.waitMs ?? 120_000 };
  if (!Object.values(policy).every(value => Number.isSafeInteger(value) && value > 0) ||
      policy.leaseMs < 60_000 || policy.commandMaxTimeMS + 5_000 > policy.leaseMs / 3)
    throw new Error('Index command timeout plus 5s must fit within one third of a lease of at least 60s.');
  return policy;
};
export const INDEX_LIFECYCLE_ID = 'Thingtime.IndexLifecycle.v1';
export type IndexSpec = { collection: string; keys: Record<string, unknown>; options: Record<string, unknown> };
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const indexPlanFingerprint = (specs: IndexSpec[], context: unknown) => createHash('sha256').update(JSON.stringify({
  maintenance: INDEX_MAINTENANCE_VERSION, context: stable(context),
  // Compound key order is meaningful; option/property object order is not.
  specs: specs.map(spec => ({ collection: spec.collection, keys: Object.entries(spec.keys), options: stable(spec.options) }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
})).digest('hex');

export const recordIndexPlan = async (plan: (db: any) => Promise<unknown>[]): Promise<IndexSpec[]> => {
  const specs: IndexSpec[] = [];
  const db = { collection: (collection: string) => ({
    createIndex: async (keys: Record<string, unknown>, options: Record<string, unknown> = {}) => {
      specs.push({ collection, keys, options });
      return options.name || Object.entries(keys).map(([key, direction]) => `${key}_${direction}`).join('_');
    },
    dropIndex: async () => undefined
  }) };
  await Promise.all(plan(db));
  return specs;
};

// Limit commands, rather than the promises returned by the eager plan builders.
// Each collection has its own serial lane so swaps never compete with a sibling
// create/drop; two different collections can still make progress together.
export const budgetIndexCommands = (db: any, assertLease: () => Promise<void> = async () => {}, concurrency = 2, commandMaxTimeMS = INDEX_COMMAND_MAX_TIME_MS) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Index command concurrency must be positive.');
  let active = 0;
  let stopped = false;
  let failure: unknown;
  const queue: Array<() => void> = [];
  const lanes = new Map<string, Promise<unknown>>();
  const pending = new Set<Promise<unknown>>();
  const pump = () => { while (active < concurrency && queue.length) queue.shift()!(); };
  const schedule = (run: () => Promise<unknown>) => new Promise((resolve, reject) => {
    queue.push(() => {
      active++;
      Promise.resolve().then(async () => {
        if (stopped) throw failure;
        await assertLease();
        return run();
      }).then(resolve, reject).finally(() => { active--; pump(); });
    });
    pump();
  });
  return {
    db: { collection: (name: string) => {
      const collection = db.collection(name);
      return new Proxy(collection, { get(target, property) {
        const value = target[property];
        if (['createIndex', 'dropIndex', 'updateMany', 'bulkWrite'].includes(String(property))) return (...args: any[]) => {
          const method = String(property);
          const optionPosition = method === 'updateMany' ? 2 : 1;
          // maxTimeMS is interrupt-point based, not a hard server-stop guarantee.
          // CSOT also bounds the client wait (and overrides the pool's socket
          // timeout for an explicitly longer supervised build).
          args[optionPosition] = { ...args[optionPosition], maxTimeMS: commandMaxTimeMS, timeoutMS: commandMaxTimeMS + 5_000 };
          const command = (lanes.get(name) || Promise.resolve()).catch(() => undefined).then(() => schedule(() => value.apply(target, args)));
          // Recoverable absent/conflicting-index errors may be handled by the plan.
          // Its outer failure stops queued work; drain waits for issued commands.
          lanes.set(name, command);
          pending.add(command);
          void command.finally(() => pending.delete(command)).catch(() => {});
          return command;
        };
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } },
    stop: (error: unknown) => { stopped = true; failure = error; },
    drain: async () => { while (pending.size) await Promise.allSettled([...pending]); }
  };
};

const duplicate = (error: any) => error?.code === 11000;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// `_id` already has MongoDB's unique index: no bootstrap DDL is needed to elect
// an owner. Server time governs expiry, so different deployment clocks cannot
// steal a valid lease. The marker stores no URI or account data.
export const runDurableIndexPlan = async ({ settings, fingerprint, run, leaseMs = 300_000, waitMs = 120_000, pause = sleep, commandSafetyMs = INDEX_COMMAND_MAX_TIME_MS + 5_000, planVersion = INDEX_MAINTENANCE_VERSION }: {
  settings: any; fingerprint: string; run: (assertLease: () => Promise<void>) => Promise<void>;
  planVersion?: number; commandSafetyMs?: number;
  leaseMs?: number; waitMs?: number; pause?: (ms: number) => Promise<void>;
}): Promise<void> => {
  const owner = randomUUID();
  const deadline = Date.now() + waitMs;
  let attempt = 0;
  let acquiredAt = 0;
  let generation = 0;
  for (;;) {
    const marker = await settings.findOne({ _id: INDEX_LIFECYCLE_ID });
    if ((marker?.planVersion || 0) > planVersion) throw new Error('MongoDB index plan belongs to a newer deployment; use the current API gateway.');
    if (marker?.readyFingerprint === fingerprint && !marker?.owner) return;
    if (!marker) {
      try {
        await settings.updateOne({ _id: INDEX_LIFECYCLE_ID }, { $setOnInsert: {
          key: INDEX_LIFECYCLE_ID, leaseUntil: new Date(0), generation: 0
        } }, { upsert: true });
      } catch (error) { if (!duplicate(error)) throw error; }
    }
    const started = Date.now();
    let claimed: any;
    try {
      claimed = await settings.findOneAndUpdate({ _id: INDEX_LIFECYCLE_ID, readyFingerprint: { $ne: fingerprint },
        $or: [{ planVersion: { $exists: false } }, { planVersion: { $lte: planVersion } }],
        $expr: { $lte: [{ $ifNull: ['$leaseUntil', new Date(0)] }, '$$NOW'] }
      }, [{ $set: { key: INDEX_LIFECYCLE_ID, owner, planVersion, leaseUntil: { $add: ['$$NOW', leaseMs] }, generation: { $ifNull: ['$generation', 0] }, readyFingerprint: null } }],
      { returnDocument: 'after', includeResultMetadata: false });
    } catch (error) { if (!duplicate(error)) throw error; }
    if (claimed?.owner === owner) { acquiredAt = started; generation = claimed.generation; break; }
    if (Date.now() >= deadline) throw new Error('MongoDB index initialization is still leased; retry after the active plan completes.');
    await pause(Math.min(250 * 2 ** Math.min(attempt++, 3), Math.max(1, deadline - Date.now())));
  }
  let lost: unknown;
  let renewing: Promise<void> | null = null;
  const renew = () => {
    if (renewing || lost) return renewing;
    const started = Date.now();
    renewing = (async () => {
      const result = await settings.updateOne({ _id: INDEX_LIFECYCLE_ID, owner, generation,
        $expr: { $gt: ['$leaseUntil', '$$NOW'] }
      }, [{ $set: { leaseUntil: { $add: ['$$NOW', leaseMs] } } }]);
      if (result.matchedCount !== 1) throw new Error('MongoDB index initialization lease lost.');
      acquiredAt = started;
    })().catch(error => { lost = error; }).finally(() => { renewing = null; });
    return renewing;
  };
  const assertLease = async () => {
    await renew();
    if (lost) throw lost;
    if (Date.now() - acquiredAt + commandSafetyMs >= leaseMs)
      throw new Error('MongoDB index initialization lease expired or command safety window unavailable.');
  };
  const timer = setInterval(renew, Math.max(1, Math.floor(leaseMs / 3)));
  timer.unref?.();
  try {
    await run(assertLease);
    clearInterval(timer);
    await renewing;
    await assertLease();
    const result = await settings.updateOne({ _id: INDEX_LIFECYCLE_ID, owner, generation,
      $expr: { $gt: ['$leaseUntil', '$$NOW'] }
    }, { $set: { readyFingerprint: fingerprint }, $unset: { owner: '', leaseUntil: '' }, $currentDate: { completedAt: true } });
    if (result.matchedCount !== 1) throw new Error('MongoDB index initialization lease lost before completion.');
  } finally {
    clearInterval(timer);
    await renewing;
    // Release only our lease. A failed run deliberately leaves no ready marker.
    await settings.updateOne({ _id: INDEX_LIFECYCLE_ID, owner }, { $unset: { owner: '', leaseUntil: '' } }).catch(() => {});
  }
};

export const invalidateDurableIndexPlan = (settings: any) => settings.updateOne(
  { _id: INDEX_LIFECYCLE_ID }, { $inc: { generation: 1 }, $unset: { readyFingerprint: '' } }
);
