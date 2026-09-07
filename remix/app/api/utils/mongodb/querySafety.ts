// @ts-ignore Node 24's direct TypeScript test runner requires the extension.
import { safeErrorText } from '../errors/safeError.ts';
// @ts-ignore Node 24's direct TypeScript test runner requires the extension.
import { isKnownCollection, physicalCollectionName } from './collectionNames.ts';
// @ts-ignore Node 24's direct TypeScript test runner requires the extension.
import {
  MONGO_BLOCKED_QUERY_KEYS,
  MONGO_BSON_VALUE_TYPES,
  MONGO_FILTER_OPERATORS,
  MONGO_QUERY_COLLECTIONS,
  MONGO_QUERY_LIMITS,
  MONGO_PROTECTED_FIELD_QUERY_COLLECTIONS,
  MONGO_PROTECTED_THING_FIELDS,
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
const protectedFieldCollectionSet = new Set<string>(MONGO_PROTECTED_FIELD_QUERY_COLLECTIONS);

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

// things-era protected root fields, normalized the same way keys are below.
// DERIVED from MONGO_PROTECTED_THING_FIELDS rather than spelled out, so the
// hard ingress strip, the probe/aliasing guard and the response redactor can
// never drift apart when a field joins the list.
const normalizeQueryKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const protectedThingFieldSet = new Set<string>(MONGO_PROTECTED_THING_FIELDS.map(normalizeQueryKey));

const shouldRedactKey = (key: string) => {
  const normalized = normalizeQueryKey(key);
  if (protectedThingFieldSet.has(normalized)) return true;
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

type ReferenceScanOptions = {
  matchPath: (path: string) => boolean;
  // whole-document predicates that can reveal protected values through
  // repeated yes/no probes even when response fields are redacted. $text is
  // separate: it only reads the text index, which never tokenizes the BinData
  // `secure` payloads, so it is safe on things but not on the legacy
  // sensitive collections (their secrets are plain fields).
  blockedPredicates: ReadonlySet<string>;
};

const ALL_PROBE_PREDICATES: ReadonlySet<string> = new Set(['$expr', '$jsonSchema', '$text']);
const COMPUTE_PROBE_PREDICATES: ReadonlySet<string> = new Set(['$expr', '$jsonSchema']);
const NO_PROBE_PREDICATES: ReadonlySet<string> = new Set();

const findProtectedQueryReference = (value: unknown, options: ReferenceScanOptions, depth = 0): string | null => {
  if (depth > MONGO_QUERY_LIMITS.maxDocumentDepth) return null;
  if (typeof value === 'string') {
    const fieldReference = value.startsWith('$$') ? value.slice(2) : value.startsWith('$') ? value.slice(1) : '';
    return fieldReference && options.matchPath(fieldReference) ? value : null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findProtectedQueryReference(child, options, depth + 1);
      if (match) return match;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!key.startsWith('$') && options.matchPath(key)) return key;
    if (options.blockedPredicates.has(key)) return key;
    // $getField/$setField name a field via a PLAIN (non-$) string argument
    // that the reference/key checks above would miss: { $getField: 'secure' }
    // or { $getField: { field: 'secure', … } }. A COMPUTED field argument
    // (e.g. { field: { $literal: 'apiKey' } }) can't be verified statically,
    // and there's no legitimate read-only use for a dynamic field name, so it
    // is rejected outright rather than allowed to launder a redacted value.
    if (key === '$getField' || key === '$setField') {
      const field = typeof child === 'string' ? child : isRecord(child) ? child.field : undefined;
      if (typeof field === 'string') {
        if (field && options.matchPath(field)) return `${key}:${field}`;
      } else if (field !== undefined) {
        return `${key}:<computed field>`;
      }
    }
    const match = findProtectedQueryReference(child, options, depth + 1);
    if (match) return match;
  }
  return null;
};

// legacy sensitive collections: heuristic name matching + every probe predicate
const findSensitiveQueryReference = (value: unknown): string | null =>
  findProtectedQueryReference(value, { matchPath: isSensitiveFieldPath, blockedPredicates: ALL_PROBE_PREDICATES });

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

// Enforce the read-only stage allowlist at EVERY pipeline depth, not just the
// top level — a non-allowlisted stage nested inside $lookup / $unionWith /
// $facet sub-pipelines would otherwise skip the check (validateStructure only
// recurses the blocked-key / join-target rules, not the stage allowlist).
const validatePipelineStages = (stages: unknown, depth = 0): string | null => {
  if (depth > MONGO_QUERY_LIMITS.maxDocumentDepth) return 'Pipeline is nested too deeply';
  if (!Array.isArray(stages)) return 'Pipeline must be an array';
  for (const stage of stages) {
    if (!isRecord(stage) || Object.keys(stage).length !== 1) {
      return 'Each aggregation stage must contain exactly one stage operator';
    }
    const stageName = Object.keys(stage)[0];
    if (!aggregationStageSet.has(stageName)) {
      return `${stageName} is not available in the read-only aggregation builder`;
    }
    const body = stage[stageName];
    if (stageName === '$lookup' && isRecord(body) && body.pipeline !== undefined) {
      const nested = validatePipelineStages(body.pipeline, depth + 1);
      if (nested) return nested;
    }
    if (stageName === '$unionWith') {
      const nested = isRecord(body) ? body.pipeline : undefined;
      if (nested !== undefined) {
        const error = validatePipelineStages(nested, depth + 1);
        if (error) return error;
      }
    }
    if (stageName === '$facet' && isRecord(body)) {
      for (const sub of Object.values(body)) {
        const error = validatePipelineStages(sub, depth + 1);
        if (error) return error;
      }
    }
  }
  return null;
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

  if (protectedFieldCollectionSet.has(collection)) {
    // The query guard uses the SAME predicate as the response redactor
    // (isSensitiveFieldPath → shouldRedactKey, which covers secure/uniqueKeys
    // AND the token/secret/apiKey/… heuristics). If the redactor masks a value
    // in the response, the guard must also refuse to filter/sort/project/alias
    // it — otherwise a pipeline could rename a redacted field out from under
    // the redactor. things keeps $text (its secrets are BinData the text index
    // never tokenizes, and text search is a real feature); the legacy
    // sensitive collections lose $text too (their secrets are plain fields).
    const scan: ReferenceScanOptions = sensitiveCollectionSet.has(collection)
      ? { matchPath: isSensitiveFieldPath, blockedPredicates: ALL_PROBE_PREDICATES }
      : { matchPath: isSensitiveFieldPath, blockedPredicates: COMPUTE_PROBE_PREDICATES };
    const protectedFilterReference = findProtectedQueryReference(filterInput, scan);
    if (protectedFilterReference) {
      return fail(400, `Queries cannot inspect protected field ${protectedFilterReference}`);
    }
    const protectedProjectionReference = findProtectedQueryReference(projectionInput, scan);
    if (protectedProjectionReference) {
      return fail(400, `Queries cannot project protected field ${protectedProjectionReference}`);
    }
    const protectedSortReference = Object.keys(sortInput).find(scan.matchPath);
    if (protectedSortReference) {
      return fail(400, `Queries cannot sort by protected field ${protectedSortReference}`);
    }
    // expressions in a find projection evaluate against the raw document (the
    // runner's strip cannot precede them), so computed projections stay
    // disabled on every protected collection
    const computedProjection = Object.values(projectionInput).some(
      (value) => value !== 0 && value !== 1 && value !== false && value !== true
    );
    if (computedProjection) {
      return fail(400, 'Computed projections are disabled for collections that contain protected fields');
    }
  }

  // Aliasing guard for every collection's pipeline: nothing may NAME a
  // redactor-sensitive path (e.g. `$owner.secure` after a $lookup, or
  // `$crystal.apiKey`) as an aggregation source, since renaming it into a
  // harmless output key would escape the response redactor. Uses the same
  // predicate as the redactor.
  //
  // Layered guarantee:
  //  - HARD (system credentials secure/uniqueKeys): hardenThingsQuery physically
  //    strips them at every things ingress, so no expression can reach them.
  //  - BEST-EFFORT (user-authored plaintext crystal fields named like secrets):
  //    this reference guard + the { k, v } redactor cover direct references and
  //    $objectToArray materialization; a determined admin could still
  //    reconstruct such a value through exotic expressions. That is an accepted
  //    limit for a requireAdmin-gated read-only debug tool over the user's own
  //    public crystal — the redaction is hygiene, not a trust boundary.
  const protectedPipelineReference = findProtectedQueryReference(pipelineInput, {
    matchPath: isSensitiveFieldPath,
    blockedPredicates: NO_PROBE_PREDICATES
  });
  if (protectedPipelineReference) {
    return fail(400, `Queries cannot inspect protected field ${protectedPipelineReference}`);
  }

  for (const value of [filterInput, projectionInput, sortInput, pipelineInput, body.hint, body.collation]) {
    const structureError = validateStructure(value);
    if (structureError) return fail(400, structureError);
  }

  const pipeline = pipelineInput as Record<string, unknown>[];
  const pipelineStageError = validatePipelineStages(pipeline);
  if (pipelineStageError) return fail(400, pipelineStageError);

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

    // $objectToArray turns field NAMES into VALUES under { k, v } pairs, which
    // the key-name redaction below would miss (the keys are 'k'/'v', not the
    // sensitive name). Redact `v` whenever its sibling `k` is a sensitive
    // field name, so materialize-the-subtree aggregations can't launder a
    // heuristic-sensitive value past the redactor.
    if (typeof (next as any).k === 'string' && 'v' in (next as any) && shouldRedactKey((next as any).k)) {
      active.count += 1;
      return { k: (next as any).k, v: '[redacted]' };
    }

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

// things-era system kinds (user/theme/…) keep credentials + PII ciphertext
// under root `secure`/`uniqueKeys`, and unlisted things keep their hidden-link
// bearer secret under root `linkKey`. Strip them all server-side at EVERY
// point things documents can enter a pipeline — primary collection, $lookup,
// $unionWith — so no later stage (e.g. $objectToArray over $$ROOT, which
// turns field names into values) can see them; key-based response redaction
// alone can't survive renaming. Derived from MONGO_PROTECTED_THING_FIELDS so
// the strip, the probe checks, and the redactor share one list.
const PROTECTED_THING_STRIP = {
  $project: Object.fromEntries(MONGO_PROTECTED_THING_FIELDS.map((field) => [field, 0]))
};

// Recursively inject the strip into every sub-pipeline that reads `things`.
// $graphLookup has no pipeline support, so it cannot be stripped — reject it.
const stripThingsIngress = (stages: unknown): { stages: Record<string, unknown>[] } | MongoQueryFail => {
  const output: Record<string, unknown>[] = [];
  for (const stage of Array.isArray(stages) ? stages : []) {
    if (!stage || typeof stage !== 'object') return { ok: false, status: 400, error: 'Invalid aggregation stage' };
    const entry = { ...(stage as Record<string, unknown>) };

    if (entry.$graphLookup && typeof entry.$graphLookup === 'object') {
      const from = (entry.$graphLookup as Record<string, unknown>).from;
      if (from === 'things') {
        return {
          ok: false,
          status: 400,
          error: '$graphLookup cannot read things (its documents carry protected fields) — use $lookup with a pipeline instead'
        };
      }
    }

    if (entry.$lookup && typeof entry.$lookup === 'object') {
      const lookup = { ...(entry.$lookup as Record<string, unknown>) };
      const inner = stripThingsIngress(lookup.pipeline ?? []);
      if ('status' in inner) return inner;
      if (lookup.from === 'things') {
        lookup.pipeline = [PROTECTED_THING_STRIP, ...inner.stages];
      } else if (Array.isArray(lookup.pipeline)) {
        lookup.pipeline = inner.stages;
      }
      entry.$lookup = lookup;
    }

    if (entry.$unionWith !== undefined) {
      const union = entry.$unionWith;
      const coll = typeof union === 'string' ? union : union && typeof union === 'object' ? (union as Record<string, unknown>).coll : undefined;
      const innerStages = union && typeof union === 'object' ? ((union as Record<string, unknown>).pipeline ?? []) : [];
      const inner = stripThingsIngress(innerStages);
      if ('status' in inner) return inner;
      if (coll === 'things') {
        entry.$unionWith = { coll: 'things', pipeline: [PROTECTED_THING_STRIP, ...inner.stages] };
      } else if (union && typeof union === 'object' && Array.isArray((union as Record<string, unknown>).pipeline)) {
        entry.$unionWith = { ...(union as Record<string, unknown>), pipeline: inner.stages };
      }
    }

    if (entry.$facet && typeof entry.$facet === 'object') {
      const facet: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(entry.$facet as Record<string, unknown>)) {
        const inner = stripThingsIngress(sub);
        if ('status' in inner) return inner;
        facet[key] = inner.stages;
      }
      entry.$facet = facet;
    }

    output.push(entry);
  }
  return { stages: output };
};

// Does a $match body use $text anywhere (top-level or inside $and/$or)? $text is
// only legal as the FIRST pipeline stage, so a $text $match can't be displaced by
// the protected-field strip.
const matchUsesText = (match: unknown): boolean => {
  if (!match || typeof match !== 'object') return false;
  if ('$text' in (match as Record<string, unknown>)) return true;
  for (const value of Object.values(match as Record<string, unknown>)) {
    if (Array.isArray(value) && value.some((entry) => matchUsesText(entry))) return true;
  }
  return false;
};

export const hardenThingsQuery = (query: NormalizedMongoQuery): NormalizedMongoQuery | MongoQueryFail => {
  const walked = stripThingsIngress(query.pipeline);
  if ('status' in walked) return walked;
  let pipeline = walked.stages;
  if (query.collection === 'things') {
    // The protected-field strip is an output $project, so it normally goes first.
    // But $text is only legal as the FIRST pipeline stage — prepending the strip
    // ahead of a `{ $match: { $text } }` makes MongoDB reject the whole query
    // ($text is an advertised things capability, and this PR adds the wildcard
    // text index behind it). When the pipeline opens with a $text $match we hoist
    // it ahead of the strip; the strip follows immediately, so protected fields
    // are still removed from every output doc and never reach a LATER stage.
    //
    // Security: a hoisted $match runs on RAW documents (before the strip), exactly
    // like a find-filter — so it must obey the same probe rules the find path uses
    // (COMPUTE_PROBE_PREDICATES), NOT the looser pipeline scan (NO_PROBE_PREDICATES,
    // which only blocks named references and was safe only while the strip always
    // ran first). Otherwise an admin could combine $text with a whole-document
    // probe ($expr/$objectToArray over $$ROOT) in that first stage and turn it into
    // a boolean oracle over secure/uniqueKeys before they are stripped. Reject any
    // such probe; $text itself only reads the text index and stays allowed.
    const [first, ...rest] = walked.stages;
    const firstIsTextMatch =
      !!first &&
      typeof first === 'object' &&
      '$match' in (first as Record<string, unknown>) &&
      matchUsesText((first as Record<string, unknown>).$match);
    if (firstIsTextMatch) {
      const probe = findProtectedQueryReference((first as Record<string, unknown>).$match, {
        matchPath: isSensitiveFieldPath,
        blockedPredicates: COMPUTE_PROBE_PREDICATES
      });
      if (probe) {
        return fail(
          400,
          `A $text $match on things can't also use ${probe} — it runs before the protected-field strip`
        );
      }
    }
    pipeline = firstIsTextMatch
      ? [first as Record<string, unknown>, PROTECTED_THING_STRIP, ...rest]
      : [PROTECTED_THING_STRIP, ...walked.stages];
  }

  let projection = query.projection;
  if (query.collection === 'things') {
    // Mongo's `_id` exception cuts both ways: `{ crystal: 0, _id: 1 }` is a
    // valid EXCLUSION projection (it returns everything but crystal), so
    // inclusion detection must ignore `_id`. A bare `{ _id: 1 }` is the one
    // projection where a truthy `_id` does mean inclusion — it returns only
    // `_id`, which is already safe to leave untouched. Explicitly including a
    // protected field is rejected at normalize time.
    // EJSON canonical deserialization wraps numbers (Int32 { value: 1 }), so
    // coerce numerically — Int32/Long/Double all valueOf() to number, and
    // true/false coerce to 1/0, matching Mongo's own truthiness rules
    const inclusionFlag = (value: unknown) => Number(value) === 1;
    const entries = Object.entries(projection);
    const nonId = entries.filter(([key]) => key !== '_id');
    const inclusion =
      nonId.some(([, value]) => inclusionFlag(value)) ||
      (!nonId.length && entries.some(([, value]) => inclusionFlag(value)));
    if (!inclusion) projection = { ...projection, ...PROTECTED_THING_STRIP.$project };
  }

  return { ...query, pipeline, projection };
};

// The whole validation layer above (allowlists, sensitivity checks,
// stripThingsIngress) speaks LOGICAL collection names — the client-facing
// vocabulary. Physical collections are versioned (things → things_v2, see
// collectionNames.ts), so the last step before execution maps every join
// target in the validated pipeline onto its current physical name. Recursion
// mirrors stripThingsIngress: $lookup/$unionWith sub-pipelines and $facet
// branches; $graphLookup carries a from but no sub-pipeline. Unknown strings
// are left untouched — validation has already rejected anything outside the
// allowlist, so this never invents a collection.
export const resolvePipelineCollections = (stages: unknown): Record<string, unknown>[] => {
  const resolve = (name: unknown) =>
    typeof name === 'string' && isKnownCollection(name) ? physicalCollectionName(name) : name;
  const output: Record<string, unknown>[] = [];
  for (const stage of Array.isArray(stages) ? stages : []) {
    if (!stage || typeof stage !== 'object') continue;
    const entry = { ...(stage as Record<string, unknown>) };
    if (entry.$lookup && typeof entry.$lookup === 'object') {
      const lookup = { ...(entry.$lookup as Record<string, unknown>) };
      if (lookup.from !== undefined) lookup.from = resolve(lookup.from);
      if (Array.isArray(lookup.pipeline)) lookup.pipeline = resolvePipelineCollections(lookup.pipeline);
      entry.$lookup = lookup;
    }
    if (entry.$graphLookup && typeof entry.$graphLookup === 'object') {
      const graph = { ...(entry.$graphLookup as Record<string, unknown>) };
      if (graph.from !== undefined) graph.from = resolve(graph.from);
      entry.$graphLookup = graph;
    }
    if (entry.$unionWith !== undefined) {
      const union = entry.$unionWith;
      if (typeof union === 'string') {
        entry.$unionWith = resolve(union);
      } else if (union && typeof union === 'object') {
        const copy = { ...(union as Record<string, unknown>) };
        if (copy.coll !== undefined) copy.coll = resolve(copy.coll);
        if (Array.isArray(copy.pipeline)) copy.pipeline = resolvePipelineCollections(copy.pipeline);
        entry.$unionWith = copy;
      }
    }
    if (entry.$facet && typeof entry.$facet === 'object') {
      const facet: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(entry.$facet as Record<string, unknown>)) {
        facet[key] = resolvePipelineCollections(sub);
      }
      entry.$facet = facet;
    }
    output.push(entry);
  }
  return output;
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
  // collections that additionally carry things-era protected root fields —
  // filter/sort/projection probes on those fields (and $expr/$jsonSchema
  // filters, and computed projections) return 400 there
  protectedFieldCollections: MONGO_PROTECTED_FIELD_QUERY_COLLECTIONS,
  protectedThingFields: MONGO_PROTECTED_THING_FIELDS,
  blockedKeys: MONGO_BLOCKED_QUERY_KEYS,
  limits: MONGO_QUERY_LIMITS
});
