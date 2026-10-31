export const MONGO_QUERY_COLLECTIONS = [
  'things',
  'users',
  'sessions',
  'rosters',
  'emailVerifications',
  'themes',
  'waitlist',
  'feedAlgorithms',
  'lopuMusingRateLimits',
  'settings',
  'rateLimits',
  // CI control-plane satellite (ci-* Things + ci-event history) — see
  // FUNDAMENTALS §3; queryable so admins can inspect retention/TTL behaviour
  'ciControl'
] as const;

export type MongoQueryCollection = (typeof MONGO_QUERY_COLLECTIONS)[number];

// These collections contain authentication material or globally private
// configuration. They remain queryable by admins, but aggregation and computed
// projections are disabled so a user expression cannot alias a secret before
// the response redactor sees it.
export const MONGO_SENSITIVE_QUERY_COLLECTIONS = [
  'users',
  'sessions',
  'rosters',
  'emailVerifications',
  'settings'
] as const satisfies readonly MongoQueryCollection[];

// things-era system kinds (user/theme/waitlist/…) live in `things` and carry
// credentials + PII ciphertext under root `secure`/`uniqueKeys`, and unlisted
// things carry their hidden-link bearer secret under root `linkKey`. `things`
// stays aggregable (the runner strips every protected field at every ingress —
// primary collection, $lookup, $unionWith — before any user stage runs), but
// filter/sort/projection probe checks treat it like the sensitive collections
// above.
export const MONGO_PROTECTED_FIELD_QUERY_COLLECTIONS = [
  ...MONGO_SENSITIVE_QUERY_COLLECTIONS,
  'things'
] as const satisfies readonly MongoQueryCollection[];

// The single source of truth for the things-era protected root fields — the
// probe checks (querySafety), the ingress strip stages (queryRunner), and the
// response redactor all derive from this list.
// `linkKey` is the hidden-link bearer secret (things.ts): whoever holds it may
// read that unlisted thing, logged out. Same category as the credential fields
// beside it, so it gets the same hard strip rather than the best-effort
// crystal redaction.
export const MONGO_PROTECTED_THING_FIELDS = ['secure', 'uniqueKeys', 'linkKey'] as const;

export const MONGO_QUERY_OPERATIONS = [
  { value: 'find', label: 'Find many', description: 'Return matching documents.' },
  { value: 'findOne', label: 'Find one', description: 'Return the first matching document.' },
  { value: 'countDocuments', label: 'Count exact', description: 'Count documents matching the filter.' },
  {
    value: 'estimatedDocumentCount',
    label: 'Count estimated',
    description: 'Use collection metadata for a fast approximate count.'
  },
  { value: 'distinct', label: 'Distinct values', description: 'Return unique values for one field.' },
  { value: 'aggregate', label: 'Aggregation', description: 'Run a read-only aggregation pipeline.' },
  { value: 'indexes', label: 'List indexes', description: 'Inspect the collection index definitions.' },
  { value: 'collectionStats', label: 'Collection stats', description: 'Inspect collection storage statistics.' }
] as const;

export type MongoQueryOperation = (typeof MONGO_QUERY_OPERATIONS)[number]['value'];

export const MONGO_FILTER_OPERATORS = [
  { value: '$eq', label: 'equals', group: 'Comparison' },
  { value: '$ne', label: 'does not equal', group: 'Comparison' },
  { value: '$gt', label: 'greater than', group: 'Comparison' },
  { value: '$gte', label: 'greater than or equal', group: 'Comparison' },
  { value: '$lt', label: 'less than', group: 'Comparison' },
  { value: '$lte', label: 'less than or equal', group: 'Comparison' },
  { value: '$in', label: 'is in', group: 'Comparison' },
  { value: '$nin', label: 'is not in', group: 'Comparison' },
  { value: '$exists', label: 'exists', group: 'Data type' },
  { value: '$type', label: 'has BSON type', group: 'Data type' },
  { value: '$all', label: 'array contains all', group: 'Array' },
  { value: '$elemMatch', label: 'array element matches', group: 'Array' },
  { value: '$size', label: 'array size equals', group: 'Array' },
  { value: '$regex', label: 'matches regex', group: 'Evaluation' },
  { value: '$not', label: 'does not match predicate', group: 'Logical' },
  { value: '$mod', label: 'modulo equals', group: 'Evaluation' },
  { value: '$bitsAllClear', label: 'all bits clear', group: 'Bitwise' },
  { value: '$bitsAllSet', label: 'all bits set', group: 'Bitwise' },
  { value: '$bitsAnyClear', label: 'any bit clear', group: 'Bitwise' },
  { value: '$bitsAnySet', label: 'any bit set', group: 'Bitwise' },
  { value: '$geoIntersects', label: 'geometry intersects', group: 'Geospatial' },
  { value: '$geoWithin', label: 'geometry is within', group: 'Geospatial' },
  { value: '$near', label: 'is near', group: 'Geospatial' },
  { value: '$nearSphere', label: 'is near on sphere', group: 'Geospatial' },
  { value: '$expr', label: 'expression matches', group: 'Document' },
  { value: '$jsonSchema', label: 'JSON schema matches', group: 'Document' },
  { value: '$text', label: 'text search matches', group: 'Document' }
] as const;

export const MONGO_BSON_VALUE_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'null', label: 'Null' },
  { value: 'date', label: 'Date' },
  { value: 'objectId', label: 'ObjectId' },
  { value: 'regex', label: 'Regular expression' },
  { value: 'int32', label: '32-bit integer' },
  { value: 'double', label: 'Double' },
  { value: 'decimal128', label: 'Decimal128' },
  { value: 'int64', label: '64-bit integer' },
  { value: 'timestamp', label: 'Timestamp' },
  { value: 'uuid', label: 'UUID' },
  { value: 'binary', label: 'Binary (base64)' },
  { value: 'minKey', label: 'MinKey' },
  { value: 'maxKey', label: 'MaxKey' },
  { value: 'document', label: 'Document' },
  { value: 'array', label: 'Array' }
] as const;

export type MongoBsonValueType = (typeof MONGO_BSON_VALUE_TYPES)[number]['value'];

// Every collection-level aggregation stage that can produce a finite, read-only
// response. Atlas/newer-server stages stay visible: MongoDB returns a useful
// capability error when the connected deployment does not support one.
export const MONGO_READ_ONLY_AGGREGATION_STAGES = [
  '$addFields',
  '$bucket',
  '$bucketAuto',
  '$collStats',
  '$count',
  '$densify',
  '$facet',
  '$fill',
  '$geoNear',
  '$graphLookup',
  '$group',
  '$indexStats',
  '$limit',
  '$listSearchIndexes',
  '$lookup',
  '$match',
  '$project',
  '$rankFusion',
  '$redact',
  '$replaceRoot',
  '$replaceWith',
  '$sample',
  '$score',
  '$scoreFusion',
  '$search',
  '$searchMeta',
  '$set',
  '$setWindowFields',
  '$shardedDataDistribution',
  '$skip',
  '$sort',
  '$sortByCount',
  '$unionWith',
  '$unset',
  '$unwind',
  '$vectorSearch'
] as const;

export type MongoReadOnlyAggregationStage = (typeof MONGO_READ_ONLY_AGGREGATION_STAGES)[number];

export const MONGO_QUERY_LIMITS = {
  defaultLimit: 50,
  maxLimit: 250,
  defaultMaxTimeMS: 5_000,
  maxMaxTimeMS: 15_000,
  maxSkip: 10_000,
  maxBodyBytes: 256 * 1024,
  maxResponseBytes: 1_500_000,
  maxPipelineStages: 30,
  maxDocumentDepth: 12,
  maxDocumentEntries: 1_000,
  maxArrayOperatorValues: 250,
  maxRegexLength: 256,
  maxJoins: 3
} as const;

export const MONGO_BLOCKED_QUERY_KEYS = [
  '$where',
  '$function',
  '$accumulator',
  '$code',
  '$scope',
  '$out',
  '$merge',
  '$changeStream',
  '$changeStreamSplitLargeEvent',
  '$currentOp',
  '$listLocalSessions',
  '$listSessions',
  '$listSampledQueries',
  '$querySettings',
  '$queryStats',
  '$listClusterCatalog',
  '$planCacheStats'
] as const;

export type MongoQueryRequest = {
  collection?: unknown;
  operation?: unknown;
  filter?: unknown;
  projection?: unknown;
  sort?: unknown;
  pipeline?: unknown;
  distinctField?: unknown;
  limit?: unknown;
  skip?: unknown;
  maxTimeMS?: unknown;
  hint?: unknown;
  collation?: unknown;
  allowDiskUse?: unknown;
  explain?: unknown;
  query?: unknown;
};

export type MongoQuerySuccess = {
  ok: true;
  operation: MongoQueryOperation;
  collection: MongoQueryCollection;
  results: unknown[];
  resultCount: number;
  total?: number;
  durationMs: number;
  truncated: boolean;
  redactedFields: number;
  explain: boolean;
};
