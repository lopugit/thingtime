// An in-memory stand-in for the slice of the MongoDB Collection API the Lopu
// accounting service uses (accounting.ts `LopuAccountingCollection`): enough
// of the query language (equality, $in, $ne, $lt, $gt, $exists, $or, dotted
// paths, multikey array matching, Binary equality) and the update language
// ($set, $inc, $push with $each/$slice, $setOnInsert, $pull, $unset, upsert,
// returnDocument: 'after') to run the real service in unit
// tests, plus the ONE invariant the real index enforces here — every
// `uniqueKeys` element is unique across the collection (duplicates throw a
// driver-shaped E11000 error). Test-only; not a mock of the driver.

import type { LopuAccountingCollection, LopuAccountingCursor } from './accounting';

const isBinary = (value: unknown): value is { buffer: Uint8Array } => !!value && typeof value === 'object' && (value as any)._bsontype === 'Binary';

const binaryHex = (value: { buffer: Uint8Array }): string => Buffer.from(value.buffer).toString('hex');

const same = (a: unknown, b: unknown): boolean => {
  if (isBinary(a) && isBinary(b)) return binaryHex(a) === binaryHex(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((entry, index) => same(entry, b[index]));
  return a === b;
};

const read = (doc: any, path: string): unknown => path.split('.').reduce((value, key) => (value && typeof value === 'object' ? (value as any)[key] : undefined), doc);

const write = (doc: any, path: string, value: unknown) => {
  const keys = path.split('.');
  let target = doc;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  target[keys[keys.length - 1]] = value;
};

const compare = (a: unknown, b: unknown): number => {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
};

const matchesValue = (actual: unknown, expected: unknown): boolean => {
  if (expected && typeof expected === 'object' && !isBinary(expected) && !(expected instanceof Date) && !Array.isArray(expected)) {
    const ops = expected as Record<string, unknown>;
    return Object.entries(ops).every(([op, operand]) => {
      switch (op) {
        case '$in':
          return Array.isArray(operand) && operand.some((entry) => (Array.isArray(actual) ? actual.some((item) => same(item, entry)) : same(actual, entry)));
        case '$ne':
          // multikey, like the server: an array field matches $ne only when
          // NO element equals the operand
          return Array.isArray(actual) && !Array.isArray(operand) ? !actual.some((entry) => same(entry, operand)) : !same(actual, operand);
        case '$lte':
          return actual !== undefined && compare(actual, operand) <= 0;
        case '$gte':
          return actual !== undefined && compare(actual, operand) >= 0;
        case '$lt':
          return actual !== undefined && compare(actual, operand) < 0;
        case '$gt':
          return actual !== undefined && compare(actual, operand) > 0;
        case '$exists':
          return operand ? actual !== undefined : actual === undefined;
        default:
          throw new Error(`memory collection: unsupported operator ${op}`);
      }
    });
  }
  // an array field matches when any element equals the value (multikey)
  if (Array.isArray(actual) && !Array.isArray(expected)) return actual.some((entry) => same(entry, expected));
  return same(actual, expected);
};

const matches = (doc: any, filter: Record<string, unknown>): boolean =>
  Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return Array.isArray(expected) && expected.some((branch) => matches(doc, branch));
    return matchesValue(read(doc, key), expected);
  });

// a deep copy that keeps BSON Binary instances (immutable — shared by
// reference, exactly what the driver hands back) and Date objects intact;
// structuredClone would strip the Binary prototype and break key equality
const clone = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  if (isBinary(value)) return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as unknown as T;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) copy[key] = clone(entry);
  return copy as T;
};

export const createMemoryThingsCollection = () => {
  const docs: any[] = [];

  const assertUnique = (candidate: any, except?: any) => {
    const keys: unknown[] = Array.isArray(candidate.uniqueKeys) ? candidate.uniqueKeys : [];
    for (const doc of docs) {
      if (doc === except) continue;
      if (doc.shareId === candidate.shareId) {
        const error: any = new Error(`E11000 duplicate key error collection: things index: shareId_1 dup key: { shareId: "${candidate.shareId}" }`);
        error.code = 11000;
        throw error;
      }
      const theirs: unknown[] = Array.isArray(doc.uniqueKeys) ? doc.uniqueKeys : [];
      if (keys.some((key) => theirs.some((other) => same(key, other)))) {
        const error: any = new Error('E11000 duplicate key error collection: things index: uniqueKeys_1');
        error.code = 11000;
        throw error;
      }
    }
  };

  const apply = (doc: any, update: Record<string, unknown>) => {
    for (const [op, fields] of Object.entries(update)) {
      const entries = Object.entries(fields as Record<string, unknown>);
      if (op === '$set') for (const [path, value] of entries) write(doc, path, clone(value));
      else if (op === '$inc') for (const [path, value] of entries) write(doc, path, (Number(read(doc, path)) || 0) + Number(value));
      else if (op === '$push') {
        for (const [path, value] of entries) {
          const current = read(doc, path);
          const list = Array.isArray(current) ? [...current] : [];
          const modifier = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
          const added = modifier && Array.isArray(modifier.$each) ? modifier.$each : [value];
          list.push(...added.map((entry) => clone(entry)));
          const slice = modifier && typeof modifier.$slice === 'number' ? modifier.$slice : null;
          write(doc, path, slice === null ? list : slice < 0 ? list.slice(slice) : list.slice(0, slice));
        }
      } else if (op === '$pull') {
        for (const [path, value] of entries) {
          const current = read(doc, path);
          if (Array.isArray(current)) write(doc, path, current.filter((entry) => !same(entry, value)));
        }
      } else if (op === '$unset') for (const [path] of entries) write(doc, path, undefined);
      else if (op === '$setOnInsert') continue;
      else throw new Error(`memory collection: unsupported update operator ${op}`);
    }
  };

  const cursor = (filter: Record<string, unknown>): LopuAccountingCursor => {
    let sortSpec: Record<string, 1 | -1> | null = null;
    let limitCount = Infinity;
    const self: LopuAccountingCursor = {
      sort(spec) {
        sortSpec = spec;
        return self;
      },
      limit(count) {
        limitCount = count;
        return self;
      },
      async toArray() {
        let rows = docs.filter((doc) => matches(doc, filter));
        if (sortSpec) {
          const spec = Object.entries(sortSpec);
          rows = [...rows].sort((a, b) => {
            for (const [key, direction] of spec) {
              const delta = compare(read(a, key), read(b, key));
              if (delta !== 0) return delta * direction;
            }
            return 0;
          });
        }
        return rows.slice(0, limitCount).map(clone);
      }
    };
    return self;
  };

  const collection: LopuAccountingCollection & { docs: any[]; ofKind: (kind: string) => any[] } = {
    docs,
    ofKind: (kind) => docs.filter((doc) => Array.isArray(doc.thingtime) && doc.thingtime.includes(kind)).map(clone),
    async findOne(filter) {
      const found = docs.find((doc) => matches(doc, filter));
      return found ? clone(found) : null;
    },
    find: (filter) => cursor(filter),
    async insertOne(doc) {
      assertUnique(doc);
      docs.push(clone(doc));
      return { acknowledged: true };
    },
    async updateOne(filter, update, options) {
      const target = docs.find((doc) => matches(doc, filter));
      if (!target) {
        if (options?.upsert) {
          const seed = clone((update.$setOnInsert as Record<string, unknown>) || {});
          const inserted: any = { ...seed };
          apply(inserted, { ...update, $setOnInsert: {} });
          assertUnique(inserted);
          docs.push(inserted);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      apply(target, update);
      assertUnique(target, target);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
    async findOneAndUpdate(filter, update, options) {
      const target = docs.find((doc) => matches(doc, filter));
      if (!target) return null;
      const before = clone(target);
      apply(target, update);
      return options?.returnDocument === 'after' ? clone(target) : before;
    }
  };
  return collection;
};

export type MemoryThingsCollection = ReturnType<typeof createMemoryThingsCollection>;
