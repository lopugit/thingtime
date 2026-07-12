import { getThingtimeDb } from './collections';
import { MONGO_QUERY_LIMITS, type MongoQueryRequest, type MongoQuerySuccess } from './queryContract';
import {
  mongoQueryCapabilities,
  normalizeMongoQueryRequest,
  redactMongoValue,
  safeMongoError,
  type NormalizedMongoQuery
} from './querySafety';

export { mongoQueryCapabilities, normalizeMongoQueryRequest, redactMongoValue } from './querySafety';

type Fail = { ok: false; status: number; error: string };

const baseOptions = (query: NormalizedMongoQuery, signal?: AbortSignal) => ({
  maxTimeMS: query.maxTimeMS,
  ...(query.collation ? { collation: query.collation } : {}),
  ...(query.hint ? { hint: query.hint } : {}),
  ...(signal ? { signal } : {}),
  comment: 'thingtime-raw'
});

const collectValues = async (
  values: AsyncIterable<unknown> | Iterable<unknown>,
  maxValues: number,
  signal?: AbortSignal
) => {
  const results: unknown[] = [];
  const state = { count: 0, seen: new WeakSet<object>() };
  let bytes = 2;
  let truncated = false;
  const closeable = values as { close?: () => Promise<void> | void };
  const abort = () => {
    void closeable.close?.();
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    if (signal?.aborted) throw signal.reason || new Error('Query cancelled');
    for await (const value of values) {
      if (signal?.aborted) throw signal.reason || new Error('Query cancelled');
      if (results.length >= maxValues) {
        truncated = true;
        break;
      }
      const safe = redactMongoValue(value, state).value;
      const encoded = JSON.stringify(safe);
      const nextBytes = new TextEncoder().encode(encoded).byteLength + (results.length ? 1 : 0);
      if (bytes + nextBytes > MONGO_QUERY_LIMITS.maxResponseBytes) {
        truncated = true;
        break;
      }
      results.push(safe);
      bytes += nextBytes;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }

  return { results, truncated, redactedFields: state.count };
};

const boundedDistinctPipeline = (query: NormalizedMongoQuery) => [
  { $match: query.filter },
  {
    $project: {
      _value: `$${query.distinctField}`,
      _present: { $ne: [{ $type: `$${query.distinctField}` }, 'missing'] }
    }
  },
  { $match: { _present: true } },
  { $unwind: { path: '$_value', preserveNullAndEmptyArrays: true } },
  { $match: { $expr: { $ne: [{ $type: '$_value' }, 'missing'] } } },
  { $group: { _id: '$_value' } },
  { $limit: query.limit + 1 }
];

export const runMongoQuery = async (
  body: MongoQueryRequest,
  signal?: AbortSignal
): Promise<Fail | MongoQuerySuccess> => {
  const normalized = await normalizeMongoQueryRequest(body || {});
  if ('status' in normalized) return normalized;

  const started = performance.now();
  try {
    const db = await getThingtimeDb();
    const collection = db.collection(normalized.collection);
    const options = baseOptions(normalized, signal) as any;
    let values: AsyncIterable<unknown> | Iterable<unknown> = [];
    let total: number | undefined;

    if (normalized.explain) {
      if (normalized.operation === 'aggregate') {
        values = [
          await collection
            .aggregate(normalized.pipeline, { ...options, allowDiskUse: normalized.allowDiskUse })
            .explain('executionStats')
        ];
      } else if (normalized.operation === 'countDocuments') {
        values = [
          await collection
            .aggregate([{ $match: normalized.filter }, { $count: 'count' }], { ...options, allowDiskUse: false })
            .explain('executionStats')
        ];
      } else if (normalized.operation === 'distinct') {
        values = [
          await collection
            .aggregate(boundedDistinctPipeline(normalized), { ...options, allowDiskUse: false })
            .explain('executionStats')
        ];
      } else {
        values = [
          await collection
            .find(normalized.filter, {
              ...options,
              projection: normalized.projection,
              sort: normalized.sort,
              skip: normalized.skip,
              limit: normalized.operation === 'findOne' ? 1 : normalized.limit + 1
            })
            .explain('executionStats')
        ];
      }
    } else if (normalized.operation === 'find' || normalized.operation === 'findOne') {
      values = collection.find(normalized.filter, {
        ...options,
        projection: normalized.projection,
        sort: normalized.sort,
        skip: normalized.skip,
        limit: normalized.operation === 'findOne' ? 1 : normalized.limit + 1,
        batchSize: Math.min(normalized.limit, 100)
      });
    } else if (normalized.operation === 'countDocuments') {
      total = await collection.countDocuments(normalized.filter, options);
      values = [{ count: total }];
    } else if (normalized.operation === 'estimatedDocumentCount') {
      total = await collection.estimatedDocumentCount(options);
      values = [{ count: total, estimated: true }];
    } else if (normalized.operation === 'distinct') {
      values = collection
        .aggregate(boundedDistinctPipeline(normalized), { ...options, allowDiskUse: false })
        .map((row: { _id: unknown }) => row._id);
    } else if (normalized.operation === 'aggregate') {
      values = collection.aggregate(normalized.pipeline, {
        ...options,
        allowDiskUse: normalized.allowDiskUse,
        batchSize: Math.min(normalized.limit, 100)
      });
    } else if (normalized.operation === 'indexes') {
      values = collection.listIndexes({ batchSize: Math.min(normalized.limit, 100), maxTimeMS: normalized.maxTimeMS });
    } else if (normalized.operation === 'collectionStats') {
      values = [
        await db.command(
          { collStats: normalized.collection, scale: 1, maxTimeMS: normalized.maxTimeMS },
          signal ? { signal } : undefined
        )
      ];
    }

    const collected = await collectValues(values, normalized.operation === 'findOne' ? 1 : normalized.limit, signal);
    return {
      ok: true,
      operation: normalized.operation,
      collection: normalized.collection,
      results: collected.results,
      resultCount: collected.results.length,
      ...(total === undefined ? {} : { total }),
      durationMs: Math.max(0, Math.round((performance.now() - started) * 10) / 10),
      truncated: collected.truncated,
      redactedFields: collected.redactedFields,
      explain: normalized.explain
    };
  } catch (error) {
    if (signal?.aborted) return { ok: false, status: 499, error: 'Query cancelled' };
    const unavailable =
      error instanceof Error &&
      ['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError'].includes(error.name);
    return { ok: false, status: unavailable ? 503 : 400, error: safeMongoError(error) };
  }
};
