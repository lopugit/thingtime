// Relocation of CI control-plane rows out of `things` and into the ciControl
// satellite, plus the in-place index rebuild that reclaims their storage.
// PURE over injected collection handles so the batch logic is unit-testable
// with fakes (the migrations themselves wire the real handles).
//
// Production context (measured 2026-09-02): things_v2 held 1,824,527 docs of
// which 1,820,014 were ci-* rows (ci-event 1.37M, ci-workflow-run 434k), all
// written since August, growing ~270k/day. Every one of the collection's 64
// indexes paid an entry per row: 3.15 GB of index for ~4.5k content docs.

import { ciExpiresAt, ciRetentionPolicy, type CiRetentionPolicy } from '../ciControl/retentionCore';

export type RelocationCursor = {
  sort(spec: Record<string, 1 | -1>): RelocationCursor;
  limit(n: number): RelocationCursor;
  toArray(): Promise<any[]>;
};

export type RelocationSource = {
  find(filter: Record<string, unknown>, options?: Record<string, unknown>): RelocationCursor;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
};

export type RelocationTarget = {
  bulkWrite(operations: any[], options?: Record<string, unknown>): Promise<unknown>;
};

export type RelocationOptions = {
  source: RelocationSource;
  target: RelocationTarget;
  kinds: readonly string[];
  targetSchemaVersion: number;
  dryRun: boolean;
  policy?: CiRetentionPolicy;
  now?: Date;
  batchSize?: number;
  // wall-clock budget for ONE run: the admin endpoint runs inside a serverless
  // function, so a run must return well inside the platform limit and report
  // what is left; re-running is idempotent and continues where it stopped
  budgetMs?: number;
  assertLease?: () => Promise<void>;
};

export type RelocationReport = {
  matched: number;
  copied: number;
  expired: number;
  deleted: number;
  // true when the source has no more matching rows (the run drained it);
  // false when the time budget stopped it early
  drained: boolean;
  byKind: Record<string, { matched: number; copied: number; expired: number }>;
};

export const DEFAULT_RELOCATION_BATCH = 500;
export const DEFAULT_RELOCATION_BUDGET_MS = 120_000;

const baseTimeOf = (doc: any, now: Date): Date => {
  for (const candidate of [doc?.updatedAt, doc?.createdAt]) {
    if (candidate instanceof Date && Number.isFinite(candidate.getTime())) return candidate;
  }
  return now;
};

// The satellite copy of a things row: same Thing envelope, ciControl schema
// version, root expiresAt from the retention policy (measured from the row's
// last update so already-old telemetry is not resurrected for a full window).
// Returns null when the row's window has ALREADY closed — such a row is not
// worth copying only for TTL to delete it moments later.
export const relocatedCiDoc = (
  doc: any,
  options: { targetSchemaVersion: number; policy: CiRetentionPolicy; now: Date }
): Record<string, unknown> | null => {
  const { _id, expiresAt: _staleExpiry, ...rest } = doc ?? {};
  const kind = Array.isArray(rest.thingtime) ? String(rest.thingtime[0] ?? '') : String(rest.thingtime ?? '');
  const externalId = typeof rest.crystal?.externalId === 'string' ? rest.crystal.externalId : null;
  const expiresAt = ciExpiresAt(kind, externalId, baseTimeOf(rest, options.now), options.policy);
  if (expiresAt && expiresAt.getTime() <= options.now.getTime()) return null;
  return {
    ...rest,
    schemaVersion: options.targetSchemaVersion,
    ...(expiresAt ? { expiresAt } : {})
  };
};

export const relocateCiControlRows = async (options: RelocationOptions): Promise<RelocationReport> => {
  const policy = options.policy ?? ciRetentionPolicy();
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_RELOCATION_BATCH));
  const budgetMs = Math.max(1_000, Math.floor(options.budgetMs ?? DEFAULT_RELOCATION_BUDGET_MS));
  const startedAt = Date.now();
  const report: RelocationReport = { matched: 0, copied: 0, expired: 0, deleted: 0, drained: false, byKind: {} };
  const bump = (kind: string, field: 'matched' | 'copied' | 'expired') => {
    const entry = report.byKind[kind] || (report.byKind[kind] = { matched: 0, copied: 0, expired: 0 });
    entry[field] += 1;
    report[field] += 1;
  };

  let lastId: unknown = null;
  for (;;) {
    if (options.assertLease) await options.assertLease();
    const filter: Record<string, unknown> = { thingtime: { $in: [...options.kinds] } };
    if (lastId !== null) filter._id = { $gt: lastId };
    const batch = await options.source.find(filter).sort({ _id: 1 }).limit(batchSize).toArray();
    if (!batch.length) {
      report.drained = true;
      return report;
    }
    const copies: any[] = [];
    for (const doc of batch) {
      const kind = Array.isArray(doc?.thingtime) ? String(doc.thingtime[0] ?? '') : String(doc?.thingtime ?? '');
      bump(kind, 'matched');
      const relocated = relocatedCiDoc(doc, { targetSchemaVersion: options.targetSchemaVersion, policy, now });
      if (!relocated) {
        bump(kind, 'expired');
        continue;
      }
      bump(kind, 'copied');
      // Insert-if-absent by deterministic shareId: a row the LIVE writers have
      // already re-created on the satellite (same shareId, newer state) must
      // never be overwritten by its stale things-era copy.
      copies.push({ updateOne: { filter: { shareId: relocated.shareId }, update: { $setOnInsert: relocated }, upsert: true } });
    }
    lastId = batch[batch.length - 1]._id;
    if (!options.dryRun) {
      if (copies.length) await options.target.bulkWrite(copies, { ordered: false });
      const deleted = await options.source.deleteMany({ _id: { $in: batch.map((doc) => doc._id) } });
      report.deleted += deleted?.deletedCount ?? batch.length;
    }
    if (batch.length < batchSize) {
      report.drained = true;
      return report;
    }
    if (Date.now() - startedAt >= budgetMs) return report;
  }
};

// ---------------------------------------------------------------------------
// Index rebuild. Deleting 1.8M rows leaves every index file at its old size
// (WiredTiger keeps freed pages inside the file); only dropping the index
// releases the disk, and the boot-time ensure only creates what is MISSING.
// Rebuilding drops each plan-owned index and recreates it from the plan.
//
// Unique constraints never lapse: before dropping a unique index, a same-key
// twin with an equivalent-or-narrower partial filter is created (MongoDB
// allows same-key indexes that differ by partialFilterExpression — verified
// on 8.0), so a racing insert still hits E11000 throughout; the twin goes
// once the rebuilt original is back.

export type IndexDefinition = { name: string; key: Record<string, unknown>; unique?: boolean; sparse?: boolean; partialFilterExpression?: Record<string, unknown> };

export const rebuildTwinName = (name: string) => `${name}__rebuild`;

// Twin options for a unique index: same key + uniqueness, a partial filter
// that differs from the original (so the two may coexist) yet still covers
// every document the original constrains.
export const rebuildTwinOptions = (definition: IndexDefinition): Record<string, unknown> => {
  const base: Record<string, unknown> = { name: rebuildTwinName(definition.name), unique: true };
  const fields = Object.keys(definition.key);
  if (definition.partialFilterExpression) {
    base.partialFilterExpression = { $and: [definition.partialFilterExpression, { _id: { $exists: true } }] };
  } else if (definition.sparse) {
    // sparse ≈ "the first key exists"; a partial filter on that is the
    // narrowest faithful equivalent and legal beside the sparse original
    base.partialFilterExpression = { [fields[0]]: { $exists: true } };
  } else {
    base.partialFilterExpression = { _id: { $exists: true } };
  }
  return base;
};

export type RebuildCollection = {
  indexes(): Promise<IndexDefinition[]>;
  createIndex(keys: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  dropIndex(name: string): Promise<unknown>;
};

export type RebuildReport = { rebuilt: string[]; skipped: string[]; twins: string[]; unprotected: string[]; recovered: string[] };

export const MONGODB_INDEX_LIMIT = 64;

// listIndexes output → the (keys, options) createIndex needs to recreate the
// same index. Server-managed fields (v, ns, background, *IndexVersion) are
// dropped; a text index is listed as {_fts,_ftsx} and must be rebuilt from its
// weights map (every weighted path, including `$**`, is a text key).
export const indexCreateSpecFromDefinition = (definition: Record<string, any>): { keys: Record<string, unknown>; options: Record<string, unknown> } => {
  const { v: _v, ns: _ns, background: _bg, textIndexVersion: _tv, '2dsphereIndexVersion': _sv, key, ...rest } = definition;
  if (key && typeof key === 'object' && '_fts' in key) {
    const weights = (rest.weights && typeof rest.weights === 'object' ? rest.weights : {}) as Record<string, number>;
    const keys: Record<string, unknown> = {};
    for (const [field, direction] of Object.entries(key as Record<string, unknown>)) {
      if (field === '_fts' || field === '_ftsx') continue;
      keys[field] = direction; // non-text prefix/suffix keys of a compound text index
    }
    for (const field of Object.keys(weights)) keys[field] = 'text';
    return { keys, options: rest };
  }
  return { keys: { ...(key as Record<string, unknown>) }, options: rest };
};

// A previous run that stopped mid-way (deploy timeout, cap error) leaves
// `__rebuild` twins behind, possibly without their originals. Restore the
// plan first: twins whose original is back are simply dropped; orphan twins
// are dropped and the plan recreates the originals (a brief window, taken
// only on recovery — the normal path below never opens one).
export const reconcileRebuildTwins = async (options: {
  collection: RebuildCollection;
  ensurePlan: () => Promise<unknown>;
  assertLease?: () => Promise<void>;
}): Promise<string[]> => {
  const existing = await options.collection.indexes();
  const names = new Set(existing.map((index) => index.name));
  const twins = existing.filter((index) => index.name.endsWith('__rebuild'));
  if (!twins.length) return [];
  const recovered: string[] = [];
  let orphaned = false;
  for (const twin of twins) {
    if (options.assertLease) await options.assertLease();
    const original = twin.name.slice(0, -'__rebuild'.length);
    if (!names.has(original)) orphaned = true;
    await options.collection.dropIndex(twin.name);
    recovered.push(twin.name);
  }
  if (orphaned) await options.ensurePlan();
  return recovered;
};

// planNames: the index names the current code plan owns for this collection.
// Anything else (another deployment's residue, an operator's ad-hoc index) is
// left untouched and reported, never silently dropped.
//
// One index at a time, so the collection never holds more than ONE extra
// index (the twin) beyond its steady state — a collection parked near the
// 64-index cap rebuilds without tripping CannotCreateIndex. When there is no
// free slot at all, a unique index is rebuilt without a twin and reported as
// `unprotected` (a brief constraint window, taken only in that degenerate
// state).
export const rebuildPlanIndexes = async (options: {
  collection: RebuildCollection;
  planNames: ReadonlySet<string>;
  ensurePlan: () => Promise<unknown>;
  dryRun: boolean;
  assertLease?: () => Promise<void>;
  indexLimit?: number;
}): Promise<RebuildReport> => {
  const limit = options.indexLimit ?? MONGODB_INDEX_LIMIT;
  const report: RebuildReport = { rebuilt: [], skipped: [], twins: [], unprotected: [], recovered: [] };
  if (!options.dryRun) {
    report.recovered = await reconcileRebuildTwins({ collection: options.collection, ensurePlan: options.ensurePlan, assertLease: options.assertLease });
  }
  const existing = (await options.collection.indexes()).filter((index) => index.name !== '_id_');
  const owned = existing.filter((index) => options.planNames.has(index.name));
  report.skipped = existing.filter((index) => !options.planNames.has(index.name) && !index.name.endsWith('__rebuild')).map((index) => index.name);
  let count = existing.length + 1; // + _id_
  if (options.dryRun) {
    report.rebuilt = owned.map((index) => index.name);
    report.twins = owned.filter((index) => index.unique).map((index) => rebuildTwinName(index.name));
    if (count >= limit) report.unprotected = owned.filter((index) => index.unique).map((index) => index.name);
    return report;
  }
  for (const index of owned) {
    if (options.assertLease) await options.assertLease();
    const spec = indexCreateSpecFromDefinition(index as Record<string, any>);
    let twin: Record<string, unknown> | null = null;
    if (index.unique) {
      if (count < limit) {
        twin = rebuildTwinOptions(index);
        await options.collection.createIndex(index.key, twin);
        count += 1;
        report.twins.push(String(twin.name));
      } else {
        report.unprotected.push(index.name);
      }
    }
    await options.collection.dropIndex(index.name);
    count -= 1;
    await options.collection.createIndex(spec.keys, spec.options);
    count += 1;
    report.rebuilt.push(index.name);
    if (twin) {
      await options.collection.dropIndex(String(twin.name));
      count -= 1;
    }
  }
  // safety net: anything the plan owns that is still missing (it cannot be
  // after the loop above, but the plan is the source of truth)
  await options.ensurePlan();
  return report;
};
