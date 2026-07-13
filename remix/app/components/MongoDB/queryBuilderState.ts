// @ts-ignore Node 24's direct TypeScript test runner requires the extension.
import {
  MONGO_QUERY_LIMITS,
  type MongoBsonValueType,
  type MongoQueryCollection,
  type MongoQueryOperation,
  type MongoReadOnlyAggregationStage
} from '../../api/utils/mongodb/queryContract.ts';

export type BsonValueNode = {
  id: string;
  type: MongoBsonValueType;
  value: string;
  options?: string;
  entries: BsonEntry[];
};

export type BsonEntry = {
  id: string;
  key: string;
  value: BsonValueNode;
};

export type FilterRule = {
  kind: 'rule';
  id: string;
  field: string;
  operator: string;
  value: BsonValueNode;
};

export type FilterGroup = {
  kind: 'group';
  id: string;
  combinator: 'and' | 'or' | 'nor';
  children: Array<FilterRule | FilterGroup>;
};

export type ProjectionRow = { id: string; field: string; mode: 'include' | 'exclude' };
export type SortRow = { id: string; field: string; direction: 1 | -1 };
export type PipelineStage = {
  id: string;
  stage: MongoReadOnlyAggregationStage;
  enabled: boolean;
  value: BsonValueNode;
};

export type MongoWorkbenchState = {
  collection: MongoQueryCollection;
  operation: MongoQueryOperation;
  filter: FilterGroup;
  projection: ProjectionRow[];
  sort: SortRow[];
  pipeline: PipelineStage[];
  distinctField: string;
  limit: number;
  skip: number;
  maxTimeMS: number;
  hint: string;
  collationEnabled: boolean;
  collationLocale: string;
  collationStrength: number;
  collationCaseLevel: boolean;
  collationNumericOrdering: boolean;
  allowDiskUse: boolean;
};

export class QueryBuilderError extends Error {}

let eventId = 0;
export const makeBuilderId = (prefix: string) => {
  eventId += 1;
  return `${prefix}-${Date.now().toString(36)}-${eventId.toString(36)}`;
};

export const createBsonValue = (type: MongoBsonValueType = 'string', value = ''): BsonValueNode => ({
  id: makeBuilderId('value'),
  type,
  value,
  options: type === 'regex' ? '' : type === 'binary' ? '00' : undefined,
  entries: []
});

export const createBsonEntry = (key = '', type: MongoBsonValueType = 'string', value = ''): BsonEntry => ({
  id: makeBuilderId('entry'),
  key,
  value: createBsonValue(type, value)
});

export const createFilterRule = (): FilterRule => ({
  kind: 'rule',
  id: makeBuilderId('rule'),
  field: '',
  operator: '$eq',
  value: createBsonValue('string')
});

export const createFilterGroup = (combinator: FilterGroup['combinator'] = 'and'): FilterGroup => ({
  kind: 'group',
  id: makeBuilderId('group'),
  combinator,
  children: [createFilterRule()]
});

const stageDefault = (stage: MongoReadOnlyAggregationStage): BsonValueNode => {
  if (stage === '$limit' || stage === '$skip') return createBsonValue('number', stage === '$limit' ? '50' : '0');
  if (stage === '$count' || stage === '$sortByCount' || stage === '$unwind' || stage === '$unset') {
    return createBsonValue('string', stage === '$count' ? 'count' : '');
  }
  if (stage === '$sample') {
    const value = createBsonValue('document');
    value.entries = [createBsonEntry('size', 'number', '10')];
    return value;
  }
  return createBsonValue('document');
};

export const createPipelineStage = (stage: MongoReadOnlyAggregationStage = '$match'): PipelineStage => ({
  id: makeBuilderId('stage'),
  stage,
  enabled: true,
  value: stageDefault(stage)
});

export const createInitialWorkbenchState = (): MongoWorkbenchState => ({
  collection: 'things',
  operation: 'find',
  filter: createFilterGroup('and'),
  projection: [],
  sort: [],
  pipeline: [createPipelineStage('$match')],
  distinctField: '',
  limit: MONGO_QUERY_LIMITS.defaultLimit,
  skip: 0,
  maxTimeMS: MONGO_QUERY_LIMITS.defaultMaxTimeMS,
  hint: '',
  collationEnabled: false,
  collationLocale: 'en',
  collationStrength: 3,
  collationCaseLevel: false,
  collationNumericOrdering: false,
  allowDiskUse: false
});

const requireFiniteNumber = (value: string, label: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new QueryBuilderError(`${label} needs a valid number`);
  return parsed;
};

const requireInteger = (value: string, label: string) => {
  if (!/^-?\d+$/.test(value.trim())) throw new QueryBuilderError(`${label} needs a whole number`);
  return value.trim();
};

const uuidToBase64 = (value: string) => {
  const hex = value.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new QueryBuilderError('UUID needs the standard 36-character format');
  let binary = '';
  for (let index = 0; index < hex.length; index += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  return globalThis.btoa(binary);
};

export const compileBsonValue = (node: BsonValueNode): unknown => {
  switch (node.type) {
    case 'string':
      return node.value;
    case 'number':
      return requireFiniteNumber(node.value, 'Number');
    case 'boolean':
      return node.value === 'true';
    case 'null':
      return null;
    case 'date': {
      const date = new Date(node.value);
      if (Number.isNaN(date.getTime())) throw new QueryBuilderError('Date needs a valid date and time');
      return { $date: date.toISOString() };
    }
    case 'objectId':
      if (!/^[0-9a-f]{24}$/i.test(node.value.trim())) throw new QueryBuilderError('ObjectId needs 24 hexadecimal characters');
      return { $oid: node.value.trim() };
    case 'regex':
      if (node.value.length > MONGO_QUERY_LIMITS.maxRegexLength) {
        throw new QueryBuilderError(`Regex is limited to ${MONGO_QUERY_LIMITS.maxRegexLength} characters`);
      }
      if (!/^[imsx]*$/.test(node.options || '') || new Set(node.options || '').size !== (node.options || '').length) {
        throw new QueryBuilderError('Regex flags can use i, m, s, and x once each');
      }
      return { $regularExpression: { pattern: node.value, options: node.options || '' } };
    case 'int32': {
      const integer = Number(requireInteger(node.value, 'Int32'));
      if (integer < -2_147_483_648 || integer > 2_147_483_647) throw new QueryBuilderError('Int32 is out of range');
      return { $numberInt: String(integer) };
    }
    case 'double': {
      const double = node.value.trim();
      if (!['NaN', 'Infinity', '-Infinity'].includes(double)) requireFiniteNumber(double, 'Double');
      return { $numberDouble: double };
    }
    case 'decimal128':
      if (!node.value.trim()) throw new QueryBuilderError('Decimal128 needs a value');
      return { $numberDecimal: node.value.trim() };
    case 'int64':
      return { $numberLong: requireInteger(node.value, 'Int64') };
    case 'timestamp': {
      const [seconds, increment] = node.value.split(':').map((part) => Number(part));
      if (!Number.isInteger(seconds) || !Number.isInteger(increment) || seconds < 0 || increment < 0) {
        throw new QueryBuilderError('Timestamp uses non-negative seconds:increment');
      }
      return { $timestamp: { t: seconds, i: increment } };
    }
    case 'uuid':
      return { $binary: { base64: uuidToBase64(node.value.trim()), subType: '04' } };
    case 'binary':
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(node.value.trim())) {
        throw new QueryBuilderError('Binary needs valid base64');
      }
      if (!/^[0-9a-f]{2}$/i.test(node.options || '')) throw new QueryBuilderError('Binary subtype needs two hex characters');
      return { $binary: { base64: node.value.trim(), subType: (node.options || '00').toLowerCase() } };
    case 'minKey':
      return { $minKey: 1 };
    case 'maxKey':
      return { $maxKey: 1 };
    case 'document': {
      const output: Record<string, unknown> = {};
      for (const entry of node.entries) {
        const key = entry.key.trim();
        if (!key) throw new QueryBuilderError('Every document row needs a field or operator name');
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          throw new QueryBuilderError(`${key} is not a safe document key`);
        }
        if (Object.prototype.hasOwnProperty.call(output, key)) throw new QueryBuilderError(`Duplicate document key: ${key}`);
        output[key] = compileBsonValue(entry.value);
      }
      return output;
    }
    case 'array':
      return node.entries.map((entry) => compileBsonValue(entry.value));
  }
};

const ROOT_OPERATORS = new Set(['$expr', '$jsonSchema', '$text']);

const compileRule = (rule: FilterRule): Record<string, unknown> | null => {
  const field = rule.field.trim();
  if (!field && !ROOT_OPERATORS.has(rule.operator)) return null;
  const value = compileBsonValue(rule.value);
  if (rule.operator === '$text') {
    return { $text: typeof value === 'string' ? { $search: value } : value };
  }
  if (ROOT_OPERATORS.has(rule.operator)) return { [rule.operator]: value };
  return { [field]: { [rule.operator]: value } };
};

export const compileFilterGroup = (group: FilterGroup): Record<string, unknown> => {
  const clauses = group.children.flatMap((child) => {
    const value = child.kind === 'group' ? compileFilterGroup(child) : compileRule(child);
    return value && Object.keys(value).length ? [value] : [];
  });
  if (!clauses.length) return {};
  if (clauses.length === 1 && group.combinator === 'and') return clauses[0];
  return { [`$${group.combinator}`]: clauses };
};

export const compileProjection = (rows: ProjectionRow[]) => {
  const projection: Record<string, 0 | 1> = {};
  let inclusion = false;
  let exclusion = false;
  for (const row of rows) {
    const field = row.field.trim();
    if (!field) continue;
    if (field.startsWith('$') || field.includes('\0')) throw new QueryBuilderError(`Invalid projection field: ${field}`);
    projection[field] = row.mode === 'include' ? 1 : 0;
    if (field !== '_id') {
      inclusion ||= row.mode === 'include';
      exclusion ||= row.mode === 'exclude';
    }
  }
  if (inclusion && exclusion) throw new QueryBuilderError('Projection cannot mix included and excluded fields (except _id)');
  return projection;
};

export const compileSort = (rows: SortRow[]) => {
  const sort: Record<string, 1 | -1> = {};
  for (const row of rows) {
    const field = row.field.trim();
    if (!field) continue;
    if (field.startsWith('$') || field.includes('\0')) throw new QueryBuilderError(`Invalid sort field: ${field}`);
    sort[field] = row.direction;
  }
  return sort;
};

export const compilePipeline = (stages: PipelineStage[]) =>
  stages.filter((stage) => stage.enabled).map((stage) => ({ [stage.stage]: compileBsonValue(stage.value) }));

export const compileMongoQueryRequest = (state: MongoWorkbenchState, explain = false) => {
  const filter = compileFilterGroup(state.filter);
  const request: Record<string, unknown> = {
    collection: state.collection,
    operation: state.operation,
    maxTimeMS: Math.min(MONGO_QUERY_LIMITS.maxMaxTimeMS, Math.max(100, Math.floor(state.maxTimeMS))),
    explain
  };

  if (['find', 'aggregate', 'distinct', 'indexes'].includes(state.operation)) {
    request.limit = Math.min(MONGO_QUERY_LIMITS.maxLimit, Math.max(1, Math.floor(state.limit)));
  }
  if (state.operation === 'find' || state.operation === 'findOne') {
    request.skip = Math.min(MONGO_QUERY_LIMITS.maxSkip, Math.max(0, Math.floor(state.skip)));
  }

  if (['find', 'findOne', 'countDocuments', 'distinct'].includes(state.operation)) request.filter = filter;
  if (state.operation === 'find' || state.operation === 'findOne') {
    request.projection = compileProjection(state.projection);
    request.sort = compileSort(state.sort);
  }
  if (state.operation === 'distinct') request.distinctField = state.distinctField.trim();
  if (state.operation === 'aggregate') {
    request.pipeline = compilePipeline(state.pipeline);
    request.allowDiskUse = state.allowDiskUse;
  }
  const supportsMatchOptions = !['estimatedDocumentCount', 'indexes', 'collectionStats'].includes(state.operation);
  if (supportsMatchOptions && state.hint.trim()) request.hint = state.hint.trim();
  if (supportsMatchOptions && state.collationEnabled) {
    if (!state.collationLocale.trim()) throw new QueryBuilderError('Collation needs a locale');
    request.collation = {
      locale: state.collationLocale.trim(),
      strength: Math.min(5, Math.max(1, Math.floor(state.collationStrength))),
      caseLevel: state.collationCaseLevel,
      numericOrdering: state.collationNumericOrdering
    };
  }
  return request;
};
