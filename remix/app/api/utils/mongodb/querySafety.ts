// @ts-ignore Node 24's direct TypeScript test runner requires the extension.
import { safeErrorText } from '../errors/safeError.ts';
// @ts-ignore Node 24's direct TypeScript test runner requires the extension.
import {
  MONGO_BLOCKED_QUERY_KEYS,
  MONGO_BSON_VALUE_TYPES,
  MONGO_FILTER_OPERATORS,
  MONGO_QUERY_COLLECTIONS,
  MONGO_QUERY_LIMITS,
  MONGO_QUERY_OPERATIONS,
  MONGO_READ_ONLY_AGGREGATION_STAGES,
  MONGO_SENSITIVE_QUERY_COLLECTIONS,
  type MongoQueryCollection,
  type MongoQueryOperation,
  type MongoQueryRequest
} from './queryContract.ts';

export type MongoQueryFail = { ok: false; status: number; error: string };

export type NormalizedMongoQuery = {
  collection: MongoQueryCollection;
  operation: MongoQueryOperation;
  filter: Record<string, unknown>;
  projection: Record<string, unknown>;
  sort: Record<string, unknown>;
  pipeline: Record<string, unknown>[];
  distinctField: string;
  limit: number;
  skip: number;
  maxTimeMS: number;
  hint?: string | Record<string, unknown>;
  collation?: Record<string, unknown>;
  allowDiskUse: boolean;
  explain: boolean;
};

type RedactionState = { count: number; seen: WeakSet<object> };

const collectionSet = new Set<string>(MONGO_QUERY_COLLECTIONS);
const operationSet = new Set<string>(MONGO_QUERY_OPERATIONS.map((entry) => entry.value));
const aggregationStageSet = new Set<string>(MONGO_READ_ONLY_AGGREGATION_STAGES);
const blockedKeySet = new Set<string>(MONGO_BLOCKED_QUERY_KEYS);
const sensitiveCollectionSet = new Set<string>(MONGO_SENSITIVE_QUERY_COLLECTIONS);

const fail = (status: number, error: string): MongoQueryFail => ({ ok: false, status, error });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const isSafeFieldPath = (value: string) =>
  value.length > 0 && value.length <= 200 && !value.includes('\0') && !value.startsWith('$');

const shouldRedactKey = (key: string) => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('privatekey') ||
    normalized === 'jwt' ||
    normalized === 'jti' ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'sessionid' ||
    normalized === 'sessionjti' ||
    normalized === 'rosterid'
  );
};

const isSensitiveFieldPath = (path: string) => path.split('.').some(shouldRedactKey);

const findSensitiveQueryReference = (value: unknown, depth = 0): string | null => {
  if (depth > MONGO_QUERY_LIMITS.maxDocumentDepth) return null;
  if (typeof value === 'string') {
    const fieldReference = value.startsWith('$$') ? value.slice(2) : value.startsWith('$') ? value.slice(1) : '';
    return fieldReference && isSensitiveFieldPath(fieldReference) ? value : null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findSensitiveQueryReference(child, depth + 1);
      if (match) return match;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!key.startsWith('$') && isSensitiveFieldPath(key)) return key;
    // These whole-document predicates can reveal protected values through
    // repeated yes/no probes even when response fields are redacted.
    if (key === '$expr' || key === '$jsonSchema' || key === '$text') return key;
    const match = findSensitiveQueryReference(child, depth + 1);
    if (match) return match;
  }
  return null;
};

const validateStructure = (value: unknown): string | null => {
  let entries = 0;
  let joins = 0;
  const seen = new WeakSet<object>();

  const visit = (next: unknown, depth: number): string | null => {
    if (depth > MONGO_QUERY_LIMITS.maxDocumentDepth) return 'Query document is nested too deeply';
    if (!next || typeof next !== 'object') return null;
    if (seen.has(next as object)) return 'Query document contains a cycle';
    seen.add(next as object);

    if (Array.isArray(next)) {
      entries += next.length;
      if (entries > MONGO_QUERY_LIMITS.maxDocumentEntries) return 'Query document has too many values';
      for (const item of next) {
        const error = visit(item, depth + 1);
        if (error) return error;
      }
      return null;
    }

    for (const [key, child] of Object.entries(next)) {
      entries += 1;
      if (entries > MONGO_QUERY_LIMITS.maxDocumentEntries) return 'Query document has too many fields';
      if (key.includes('\0')) return 'MongoDB field names cannot contain a null byte';
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') return `Unsafe document key: ${key}`;
      if (blockedKeySet.has(key)) return `${key} is disabled in the read-only query workbench`;
      if (
        (key === '$in' || key === '$nin' || key === '$all') &&
        Array.isArray(child) &&
        child.length > MONGO_QUERY_LIMITS.maxArrayOperatorValues
      ) {
        return `${key} is limited to ${MONGO_QUERY_LIMITS.maxArrayOperatorValues} values`;
      }
      if (key === '$regex' && typeof child === 'string' && child.length > MONGO_QUERY_LIMITS.maxRegexLength) {
        return `$regex patterns are limited to ${MONGO_QUERY_LIMITS.maxRegexLength} characters`;
      }
      if (key === '$options' && (typeof child !== 'string' || !/^[imsx]*$/.test(child))) {
        return '$options can only use i, m, s, and x';
      }
      if (key === '$regularExpression' && isRecord(child)) {
        if (typeof child.pattern !== 'string' || child.pattern.length > MONGO_QUERY_LIMITS.maxRegexLength) {
          return `$regularExpression patterns are limited to ${MONGO_QUERY_LIMITS.maxRegexLength} characters`;
        }
        if (typeof child.options !== 'string' || !/^[imsx]*$/.test(child.options)) {
          return '$regularExpression options can only use i, m, s, and x';
        }
      }

      if (key === '$lookup' && isRecord(child) && child.from !== undefined) {
        joins += 1;
        if (typeof child.from !== 'string' || !collectionSet.has(child.from)) {
          return '$lookup can only read a Thingtime collection';
        }
        if (sensitiveCollectionSet.has(child.from)) return '$lookup cannot read an authentication collection';
      }
      if (key === '$graphLookup' && isRecord(child)) {
        joins += 1;
        if (typeof child.from !== 'string' || !collectionSet.has(child.from)) {
          return '$graphLookup can only read a Thingtime collection';
        }
        if (sensitiveCollectionSet.has(child.from)) return '$graphLookup cannot read an authentication collection';
      }
      if (key === '$unionWith') {
        joins += 1;
        const target = typeof child === 'string' ? child : isRecord(child) ? child.coll : undefined;
        if (target !== undefined && (typeof target !== 'string' || !collectionSet.has(target))) {
          return '$unionWith can only read a Thingtime collection';
        }
        if (typeof target === 'string' && sensitiveCollectionSet.has(target)) {
          return '$unionWith cannot read an authentication collection';
        }
      }
      if (joins > MONGO_QUERY_LIMITS.maxJoins) return `Queries are limited to ${MONGO_QUERY_LIMITS.maxJoins} joins`;

      const error = visit(child, depth + 1);
      if (error) return error;
    }
    return null;
  };

  return visit(value, 0);
};

const deserializeExtendedJson = async (value: unknown): Promise<unknown> => {
  const { BSON } = await import('mongodb');
  return BSON.EJSON.deserialize(value, { relaxed: false });
};

export const normalizeMongoQueryRequest = async (
  body: MongoQueryRequest
): Promise<MongoQueryFail | NormalizedMongoQuery> => {
  const collection = typeof body.collection === 'string' ? body.collection : 'things';
  if (!collectionSet.has(collection)) return fail(400, 'Unknown Thingtime collection');

  const operation = typeof body.operation === 'string' ? body.operation : 'find';
  if (!operationSet.has(operation)) return fail(400, 'Unsupported read operation');
  if (operation === 'aggregate' && sensitiveCollectionSet.has(collection)) {
    return fail(400, 'Aggregation is disabled for collections that contain authentication material');
  }

  const filterInput = body.filter ?? body.query ?? {};
  const projectionInput = body.projection ?? {};
  const sortInput = body.sort ?? {};
  const pipelineInput = body.pipeline ?? [];

  if (!isRecord(filterInput)) return fail(400, 'Filter must be a document');
  if (!isRecord(projectionInput)) return fail(400, 'Projection must be a document');
  if (!isRecord(sortInput)) return fail(400, 'Sort must be a document');
  if (!Array.isArray(pipelineInput)) return fail(400, 'Pipeline must be an array');
  if (pipelineInput.length > MONGO_QUERY_LIMITS.maxPipelineStages) {
    return fail(400, `Pipelines are limited to ${MONGO_QUERY_LIMITS.maxPipelineStages} stages`);
  }

  if (sensitiveCollectionSet.has(collection)) {
    const sensitiveFilterReference = findSensitiveQueryReference(filterInput);
    if (sensitiveFilterReference) {
      return fail(400, `Queries cannot inspect protected field ${sensitiveFilterReference}`);
    }
    const sensitiveSortReference = Object.keys(sortInput).find(isSensitiveFieldPath);
    if (sensitiveSortReference) {
      return fail(400, `Queries cannot sort by protected field ${sensitiveSortReference}`);
    }
    const computedProjection = Object.values(projectionInput).some(
      (value) => value !== 0 && value !== 1 && value !== false && value !== true
    );
    if (computedProjection) {
      return fail(400, 'Computed projections are disabled for collections that contain authentication material');
    }
  }

  for (const value of [filterInput, projectionInput, sortInput, pipelineInput, body.hint, body.collation]) {
    const structureError = validateStructure(value);
    if (structureError) return fail(400, structureError);
  }

  const pipeline = pipelineInput as Record<string, unknown>[];
  for (const stage of pipeline) {
    if (!isRecord(stage) || Object.keys(stage).length !== 1) {
      return fail(400, 'Each aggregation stage must contain exactly one stage operator');
    }
    const stageName = Object.keys(stage)[0];
    if (!aggregationStageSet.has(stageName)) {
      return fail(400, `${stageName} is not available in the read-only aggregation builder`);
    }
  }

  const distinctField = typeof body.distinctField === 'string' ? body.distinctField.trim() : '';
  if (operation === 'distinct' && !isSafeFieldPath(distinctField)) {
    return fail(400, 'Choose a valid field for the distinct operation');
  }
  if (operation === 'distinct' && isSensitiveFieldPath(distinctField)) {
    return fail(400, 'That field contains authentication material and cannot be returned');
  }

  const explain = body.explain === true;
  if (explain && ['estimatedDocumentCount', 'indexes', 'collectionStats'].includes(operation)) {
    return fail(400, `Explain is not available for ${operation}`);
  }

  const supportsMatchOptions = !['estimatedDocumentCount', 'indexes', 'collectionStats'].includes(operation);
  if (
    !supportsMatchOptions &&
    ((body.hint !== undefined && body.hint !== '') || body.collation !== undefined)
  ) {
    return fail(400, `${operation} does not support hints or collation in this workbench`);
  }

  const hintInput = supportsMatchOptions ? body.hint : undefined;
  if (hintInput !== undefined && hintInput !== '' && typeof hintInput !== 'string' && !isRecord(hintInput)) {
    return fail(400, 'Hint must be an index name or key document');
  }
  const collationInput = supportsMatchOptions ? body.collation : undefined;
  if (collationInput !== undefined && !isRecord(collationInput)) return fail(400, 'Collation must be a document');

  try {
    return {
      collection: collection as MongoQueryCollection,
      operation: operation as MongoQueryOperation,
      filter: (await deserializeExtendedJson(filterInput)) as Record<string, unknown>,
      projection: (await deserializeExtendedJson(projectionInput)) as Record<string, unknown>,
      sort: (await deserializeExtendedJson(sortInput)) as Record<string, unknown>,
      pipeline: (await deserializeExtendedJson(pipelineInput)) as Record<string, unknown>[],
      distinctField,
      limit: boundedInteger(body.limit, MONGO_QUERY_LIMITS.defaultLimit, 1, MONGO_QUERY_LIMITS.maxLimit),
      skip: boundedInteger(body.skip, 0, 0, MONGO_QUERY_LIMITS.maxSkip),
      maxTimeMS: boundedInteger(
        body.maxTimeMS,
        MONGO_QUERY_LIMITS.defaultMaxTimeMS,
        100,
        MONGO_QUERY_LIMITS.maxMaxTimeMS
      ),
      hint:
        hintInput === undefined || hintInput === ''
          ? undefined
          : ((await deserializeExtendedJson(hintInput)) as string | Record<string, unknown>),
      collation:
        collationInput === undefined
          ? undefined
          : ((await deserializeExtendedJson(collationInput)) as Record<string, unknown>),
      allowDiskUse: body.allowDiskUse === true,
      explain
    };
  } catch {
    return fail(400, 'One or more typed BSON values are invalid');
  }
};

const sanitizeString = (value: string, state: RedactionState) => {
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    state.count += 1;
    return '[redacted-jwt]';
  }
  const sanitized = value.replace(/(mongodb(?:\+srv)?:\/\/)([^@\s/]+)@/gi, '$1***@');
  if (sanitized !== value) state.count += 1;
  return sanitized;
};

export const redactMongoValue = (value: unknown, state?: RedactionState): { value: unknown; redactedFields: number } => {
  const active = state || { count: 0, seen: new WeakSet<object>() };
  const visit = (next: unknown): unknown => {
    if (typeof next === 'string') return sanitizeString(next, active);
    if (next === null || next === undefined || typeof next !== 'object') return next;
    if (next instanceof Date) return { $date: next.toISOString() };
    if (next instanceof RegExp) return { $regularExpression: { pattern: next.source, options: next.flags } };
    if (active.seen.has(next as object)) return '[circular]';
    active.seen.add(next as object);

    const extended = (next as any).toExtendedJSON;
    if (typeof extended === 'function') return visit(extended.call(next));
    if (Array.isArray(next)) return next.map(visit);

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(next)) {
      if (shouldRedactKey(key)) {
        output[key] = '[redacted]';
        active.count += 1;
      } else {
        output[key] = visit(child);
      }
    }
    return output;
  };
  return { value: visit(value), redactedFields: active.count };
};

export const safeMongoError = (error: unknown) => {
  // Raw driver messages can embed connection strings and server internals
  // (CodeQL js/stack-trace-exposure) — respond with the error class + server
  // codeName only; the full error is logged server-side by safeErrorText.
  return safeErrorText(error, 'mongodb query', 'MongoDB query failed');
};

export const mongoQueryCapabilities = () => ({
  ok: true as const,
  schemaVersion: 1,
  database: 'thingtime',
  collections: MONGO_QUERY_COLLECTIONS,
  operations: MONGO_QUERY_OPERATIONS,
  filterOperators: MONGO_FILTER_OPERATORS,
  bsonTypes: MONGO_BSON_VALUE_TYPES,
  aggregationStages: MONGO_READ_ONLY_AGGREGATION_STAGES,
  sensitiveCollections: MONGO_SENSITIVE_QUERY_COLLECTIONS,
  blockedKeys: MONGO_BLOCKED_QUERY_KEYS,
  limits: MONGO_QUERY_LIMITS
});
