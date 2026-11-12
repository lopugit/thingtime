import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { types } from 'node:util';
import { BSON, Binary, Decimal128, Double, Int32, Long, ObjectId } from 'mongodb';
import { DocumentStoreError, type DocumentStore, type DocumentTransaction } from './contract';
import type { CollectionDefinition, CollectionFilter, CollectionIdentity, CollectionMutation, CollectionPage, CollectionProvider, CollectionTransaction, CollectionUpdate, NativeCollection } from './collectionContract';

type Row = Record<string, unknown>;
const fail = (code: string, message: string): never => { throw new DocumentStoreError(code, message); };
const invalid = (message: string): never => fail('UNSUPPORTED_COLLECTION_OPERATION', message);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): Row => {
 if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid('Expected a plain data object');
 const descriptors = Object.getOwnPropertyDescriptors(value);
 if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !descriptors[key]?.enumerable || !own(descriptors[key], 'value'))) return invalid('Accessors, symbols and hidden properties are unsupported');
 return value as Row;
};
const array = (value: unknown): unknown[] => {
 if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid('Expected a plain dense array');
 if (Reflect.ownKeys(value).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || !own(Object.getOwnPropertyDescriptor(value, key)!, 'value')))) return invalid('Unsupported array properties');
 for (let index = 0; index < value.length; index++) if (!own(value, String(index))) return invalid('Sparse arrays are unsupported');
 return value;
};
const keys = (value: unknown, allowed: string[], required = allowed): Row => {
 const result = object(value);
 if (Object.keys(result).some(key => !allowed.includes(key)) || required.some(key => !own(result, key))) return invalid('Unsupported or missing operation field');
 return result;
};
const name = (value: unknown): string => {
 if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.from(value).toString('utf8') !== value) return invalid('Expected nonempty Unicode name without NUL');
 return value;
};
const pathOf = (value: unknown): string[] => {
 const segments = array(value);
 if (!segments.length) return invalid('Expected nonempty field path');
 return segments.map(segment => {
  const field = name(segment);
  if (['__proto__', 'prototype', 'constructor'].includes(field) || field.startsWith('$') || field.includes('.')) return invalid('Unsafe or ambiguous field path');
  return field;
 });
};
const nativeBytes = (value: unknown, size?: number): Uint8Array => {
 if (!types.isUint8Array(value) || types.isProxy(value) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(value))) return invalid('Malformed BSON byte buffer');
 const bytes = value as Uint8Array;
 if (Reflect.ownKeys(bytes).some(key => typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || !own(Object.getOwnPropertyDescriptor(bytes, key)!, 'value'))) return invalid('Custom byte-buffer hooks are unsupported');
 if (size !== undefined && bytes.byteLength !== size) return invalid('Malformed BSON byte length');
 return bytes;
};
const integerIn = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const scalar = (value: unknown): void => {
 if (types.isProxy(value)) return invalid('Proxy inputs are unsupported');
 if (value === null || typeof value === 'boolean') return;
 if (typeof value === 'string' && Buffer.from(value).toString('utf8') === value) return;
 if (typeof value === 'number' && Number.isFinite(value)) return;
 if (value instanceof Date && Object.getPrototypeOf(value) === Date.prototype && Reflect.ownKeys(value).length === 0 && Number.isFinite(value.getTime())) return;
 if (value && typeof value === 'object' && [ObjectId.prototype, Binary.prototype, Decimal128.prototype, Int32.prototype, Long.prototype, Double.prototype].includes(Object.getPrototypeOf(value))) {
  const fields = value instanceof Binary ? ['sub_type', 'buffer', 'position'] : value instanceof ObjectId ? ['buffer'] : value instanceof Decimal128 ? ['bytes'] : value instanceof Long ? ['low', 'high', 'unsigned'] : ['value'];
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !fields.includes(key) || !own(Object.getOwnPropertyDescriptor(value, key)!, 'value')) || fields.some(key => !own(value, key))) return invalid('Malformed BSON wrapper or custom hooks');
  if (value instanceof Binary) {
   const buffer = nativeBytes(value.buffer);
   if (!integerIn(value.sub_type, 0, 255) || !integerIn(value.position, 0, buffer.byteLength)) return invalid('Malformed Binary wrapper');
  } else if (value instanceof ObjectId) nativeBytes(Object.getOwnPropertyDescriptor(value, 'buffer')!.value, 12);
  else if (value instanceof Decimal128) nativeBytes(value.bytes, 16);
  else if (value instanceof Long) {
   if (!integerIn(value.low, -2147483648, 2147483647) || !integerIn(value.high, -2147483648, 2147483647) || value.unsigned !== false) return invalid('Malformed signed Long wrapper');
  } else if (value instanceof Int32) {
   if (!integerIn(value.value, -2147483648, 2147483647)) return invalid('Malformed Int32 wrapper');
  } else if (value instanceof Double && (typeof value.value !== 'number' || !Number.isFinite(value.value))) return invalid('Malformed Double wrapper');
  return;
 }
 invalid('Unsupported scalar value');
};
// Validate data before BSON serialization: never invoke a getter, toBSON hook,
// function, Code expression, or user-supplied prototype during query admission.
const data = (value: unknown, parents = new Set<object>()): void => {
 if (types.isProxy(value)) return invalid('Proxy inputs are unsupported');
 if (Array.isArray(value)) {
  if (parents.has(value)) return invalid('Cyclic values are unsupported');
  parents.add(value);
  for (const item of array(value)) data(item, parents);
  parents.delete(value); return;
 }
 if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
  if (parents.has(value)) return invalid('Cyclic values are unsupported');
  parents.add(value);
  for (const [key, entry] of Object.entries(object(value))) { if (['__proto__', 'prototype', 'constructor', 'toBSON'].includes(key)) return invalid('Unsafe document field'); data(entry, parents); }
  parents.delete(value); return;
 }
 scalar(value);
};
const encode = (value: Row): Uint8Array => BSON.serialize(value);
const decode = (bytes: Uint8Array): Row => BSON.deserialize(bytes, { promoteValues: false, promoteLongs: false, bsonRegExp: true });
const copy = (value: unknown): unknown => decode(encode({ value })).value;
const token = (value: unknown): string => Buffer.from(encode({ value })).toString('hex');
const identity = (value: unknown): CollectionIdentity => {
 if (typeof value === 'string') return name(value);
 scalar(value);
 if (value instanceof ObjectId) return new ObjectId(value.toHexString());
 return invalid('Document identity must be a nonempty string or ObjectId');
};
const identityKey = (value: unknown): string => {
 const id = identity(value);
 return typeof id === 'string' ? `s:${Buffer.from(id).toString('hex')}` : `o:${id.toHexString()}`;
};
const readPath = (row: Row, path: string[]): { exists: boolean; value: unknown } => {
 let current: unknown = row;
 for (const field of path) {
  if (!current || typeof current !== 'object' || Array.isArray(current) || !own(current, field)) return { exists: false, value: undefined };
  current = (current as Row)[field];
 }
 return { exists: true, value: current };
};
const compare = (left: unknown, right: unknown): number | null => {
 const kind = (value: unknown) => value === null ? 'null' : value instanceof Date ? 'date' : value instanceof ObjectId ? 'id' : value instanceof Int32 ? 'int' : value instanceof Double ? 'double' : value instanceof Long ? 'long' : typeof value;
 if (kind(left) !== kind(right)) return null;
 if (left instanceof Long && right instanceof Long) return left.compare(right);
 if (left instanceof Date && right instanceof Date) return Math.sign(left.getTime() - right.getTime());
 if (left instanceof ObjectId && right instanceof ObjectId) return left.toHexString().localeCompare(right.toHexString(), 'en');
 if ((left instanceof Int32 && right instanceof Int32) || (left instanceof Double && right instanceof Double)) return Math.sign(left.valueOf() - right.valueOf());
 if (typeof left === 'number' && typeof right === 'number') return Math.sign(left - right);
 if (typeof left === 'string' && typeof right === 'string') return Buffer.compare(Buffer.from(left), Buffer.from(right));
 return invalid('Ordering is supported only for matching numeric, Date, ObjectId or string types');
};
const compile = (input: unknown, parents = new Set<object>()): ((row: Row) => boolean) => {
 const rule = object(input);
 if (parents.has(rule)) return invalid('Cyclic filter');
 parents.add(rule);
 try {
  if (rule.op === 'and' || rule.op === 'or') {
   keys(rule, ['op', 'filters']);
   const filters = array(rule.filters);
   if (!filters.length) return invalid('Logical filters require a nonempty array');
   const branches = filters.map(filter => compile(filter, parents));
   return rule.op === 'and' ? row => branches.every(branch => branch(row)) : row => branches.some(branch => branch(row));
  }
  keys(rule, ['op', 'path', 'value']);
  const path = pathOf(rule.path);
  if (rule.op === 'exists') {
   if (typeof rule.value !== 'boolean') return invalid('exists requires a boolean');
   return row => readPath(row, path).exists === rule.value;
  }
  if (typeof rule.op !== 'string' || !['eq', 'contains', 'lt', 'lte', 'gt', 'gte'].includes(rule.op)) return invalid('Unsupported filter operator');
  scalar(rule.value); const value = copy(rule.value), expected = token(value), op = rule.op;
  if (['lt', 'lte', 'gt', 'gte'].includes(String(op))) compare(value, value); // validate even with no matching rows
  return row => {
   const actual = readPath(row, path);
   if (!actual.exists) return false;
   if (op === 'eq') return token(actual.value) === expected;
   if (op === 'contains') return Array.isArray(actual.value) && actual.value.some(item => token(item) === expected);
   const order = compare(actual.value, value);
   return order !== null && (op === 'lt' ? order < 0 : op === 'lte' ? order <= 0 : op === 'gt' ? order > 0 : order >= 0);
  };
 } finally { parents.delete(rule); }
};
type Update = { op: string; path: string[]; value?: unknown; amount?: number };
const updatesOf = (input: unknown): Update[] => {
 const inputs = array(input);
 if (!inputs.length) return invalid('Expected nonempty update operations');
 const paths: string[][] = [];
 return inputs.map(item => {
  const update = object(item), op = update.op;
  if (typeof op !== 'string' || !['set', 'unset', 'increment'].includes(op)) return invalid('Unsupported update operator');
  keys(update, op === 'set' ? ['op', 'path', 'value'] : op === 'increment' ? ['op', 'path', 'amount'] : ['op', 'path']);
  const path = pathOf(update.path);
  if (path[0] === '_id') return invalid('Document identity is immutable');
  if (paths.some(other => other.slice(0, Math.min(path.length, other.length)).every((part, index) => path[index] === part))) return invalid('Conflicting update paths');
  paths.push(path);
  if (op === 'set') { data(update.value); return { op, path, value: copy(update.value) }; }
  if (op === 'increment') {
   if (!Number.isSafeInteger(update.amount)) return invalid('increment requires a safe integer');
   return { op, path, amount: update.amount as number };
  }
  return { op: 'unset', path };
 });
};
const increment = (value: unknown, amount: number): unknown => {
 if (value instanceof Long) {
  const result = value.toBigInt() + BigInt(amount);
  if (value.unsigned || result < BigInt('-9223372036854775808') || result > BigInt('9223372036854775807')) return invalid('Integer increment overflow');
  return Long.fromBigInt(result);
 }
 if (value instanceof Int32) {
  const result = value.valueOf() + amount;
  if (result < -2147483648 || result > 2147483647) return invalid('Int32 increment overflow');
  return new Int32(result);
 }
 if (value instanceof Double && Number.isSafeInteger(value.valueOf()) && Number.isSafeInteger(value.valueOf() + amount)) return new Double(value.valueOf() + amount);
 return invalid('increment requires an existing safe BSON integer (no coercion or promotion)');
};
const apply = (row: Row, updates: Update[]): void => {
 for (const update of updates) {
  let target = row;
  for (const part of update.path.slice(0, -1)) {
   if (!own(target, part)) {
    if (update.op === 'unset') { target = Object.create(null); break; }
    target[part] = Object.create(null);
   }
   target = object(target[part]);
  }
  const field = update.path[update.path.length - 1];
  if (update.op === 'set') target[field] = copy(update.value);
  else if (update.op === 'unset') delete target[field];
  else target[field] = increment(target[field], update.amount!);
 }
};
const definitionOf = (input: unknown): CollectionDefinition => {
 const value = keys(input, ['unique']);
 const definitions = array(value.unique);
 const seen = new Set<string>();
 return { unique: definitions.map(item => {
  const rule = keys(item, ['name', 'path', 'sparse', 'multikey']), ruleName = name(rule.name);
  if (seen.has(ruleName) || typeof rule.sparse !== 'boolean' || typeof rule.multikey !== 'boolean') return invalid('Invalid unique definition');
  seen.add(ruleName);
  return { name: ruleName, path: pathOf(rule.path), sparse: rule.sparse, multikey: rule.multikey };
 }) };
};
const rows = (store: DocumentTransaction, collection: string): { key: string; bytes: Uint8Array; row: Row }[] => {
 const result: { key: string; bytes: Uint8Array; row: Row }[] = [];
 let after: string | undefined;
 do {
  const page = store.scan(collection, { limit: 128, after });
  for (const doc of page.documents) result.push({ key: doc.key, bytes: doc.bson, row: decode(doc.bson) });
  after = page.nextAfter ?? undefined;
 } while (after !== undefined);
 return result;
};
const unique = (documents: Row[], definition: CollectionDefinition): void => {
 for (const rule of definition.unique) {
  const claimed = new Set<string>();
  for (const row of documents) {
   const field = readPath(row, [...rule.path]);
   if (!field.exists && rule.sparse) continue;
   const value = field.exists ? field.value : null;
   const values = rule.multikey && Array.isArray(value) ? value : [value];
   const local = new Set<string>();
   for (const entry of values) { scalar(entry); local.add(token(entry)); }
   for (const key of local) {
    if (claimed.has(key)) fail('DUPLICATE_UNIQUE_KEY', `Unique constraint violated: ${rule.name}`);
    claimed.add(key);
   }
  }
 }
};
const metadata = 'collection-provider:definitions:v1';
const dataCollection = (logical: string) => `collection-provider:data:${Buffer.from(logical).toString('hex')}`;

/** Correctness-first scan engine over real BSON transactions. Definitions are
 * durable; no arbitrary options, MongoClient, query code or index promises.
 * The primitive store must be exclusively used through this provider. */
export function createCollectionProvider(store: DocumentStore): CollectionProvider {
 const provider: CollectionProvider = {
  transaction: work => store.transaction(async primitive => {
   let failed = false, failure: unknown;
   const operation = <T>(body: () => T): T => {
    // Check actual session ownership even for validation/no-match operations.
    primitive.read({ collection: metadata, key: 'ownership-check' });
    if (failed) return fail('TRANSACTION_ABORTED', 'Collection transaction already failed');
    try { return body(); } catch (error) { failed = true; failure = error; throw error; }
   };
   const session: CollectionTransaction = Object.freeze({
    defineCollection: (logical: string, input: CollectionDefinition) => operation(() => {
     name(logical); const definition = definitionOf(input), key = Buffer.from(logical).toString('hex');
     const existing = primitive.read({ collection: metadata, key });
     if (existing) {
      if (token(decode(existing)) !== token(definition)) return fail('COLLECTION_DEFINITION_MISMATCH', 'Collection definition is immutable');
      return;
     }
     unique(rows(primitive, dataCollection(logical)).map(item => item.row), definition);
     primitive.insert({ collection: metadata, key }, encode(definition as unknown as Row));
    }),
    collection: (logical: string): NativeCollection => operation(() => {
     name(logical); const namespace = dataCollection(logical), bytes = primitive.read({ collection: metadata, key: Buffer.from(logical).toString('hex') });
     if (!bytes) return fail('COLLECTION_UNDEFINED', 'Define the collection before use');
     const definition = definitionOf(decode(bytes));
     return Object.freeze({
      insert: (bson: Uint8Array, ...options: unknown[]) => operation(() => {
       if (options.length) return invalid('Insert options are unsupported');
       if (!(bson instanceof Uint8Array)) return invalid('Insert requires BSON bytes');
       const bytes = Uint8Array.from(bson), row = decode(bytes); data(row);
       const key = identityKey(row._id), existing = rows(primitive, namespace);
       if (existing.some(item => item.key === key)) return fail('DUPLICATE_DOCUMENT', 'Document identity already exists');
       unique([...existing.map(item => item.row), row], definition);
       primitive.insert({ collection: namespace, key }, bytes);
      }),
      find: options => operation((): CollectionPage => {
       const query = keys(options, ['filter', 'after', 'limit'], ['limit']);
       if (!Number.isSafeInteger(query.limit) || (query.limit as number) < 1) return invalid('Expected positive safe integer page size');
       const match = query.filter === undefined ? () => true : compile(query.filter);
       const after = query.after === undefined ? undefined : identityKey(query.after);
       const matched = rows(primitive, namespace).filter(item => (after === undefined || item.key > after) && match(item.row));
       const page = matched.slice(0, query.limit as number);
       return { documents: page.map(item => Uint8Array.from(item.bytes)), nextAfter: matched.length > page.length ? identity(page[page.length - 1].row._id) : null };
      }),
      updateOne: (filter: CollectionFilter, updates: readonly CollectionUpdate[], ...options: unknown[]) => operation((): CollectionMutation => {
       if (options.length) return invalid('Update options are unsupported');
       const match = compile(filter), changes = updatesOf(updates), documents = rows(primitive, namespace), target = documents.find(item => match(item.row));
       if (!target) return { matched: false, modified: false, document: null };
       apply(target.row, changes); data(target.row);
       unique(documents.map(item => item.row), definition);
       const bytes = encode(target.row), modified = !Buffer.from(bytes).equals(Buffer.from(target.bytes));
       if (modified) primitive.put({ collection: namespace, key: target.key }, bytes);
       return { matched: true, modified, document: Uint8Array.from(bytes) };
      }),
      deleteOne: (filter: CollectionFilter, ...options: unknown[]) => operation(() => {
       if (options.length) return invalid('Delete options are unsupported');
       const match = compile(filter), target = rows(primitive, namespace).find(item => match(item.row));
       return target ? primitive.delete({ collection: namespace, key: target.key }) : false;
      }),
     });
    }),
   });
   registerHomeRepositoryProvider(session, provider);
   const result = await work(session);
   if (failed) throw failure;
   return result;
  }),
  close: () => store.close(),
 };
 return provider;
}

/** Canonical adapters constructing BSON from data must validate before the
 * serializer can invoke custom hooks. Derive a storage identity from one
 * explicit field when the canonical document has no Mongo-generated _id. */
export function encodeCollectionDocument(document: unknown, identityField?: string): Uint8Array {
 const row = object(document); data(row);
 const field = identityField === undefined ? '_id' : pathOf([identityField])[0];
 const id = identity(row[field]);
 if (own(row, '_id') && identityKey(row._id) !== identityKey(id)) return invalid('Conflicting document identity');
 return encode({ ...row, _id: id });
}
