import { Buffer } from 'node:buffer';

export const ADMIN_SNAPSHOT_MAX_LIMIT = 200;
export const ADMIN_SNAPSHOT_LOOKAHEAD_LIMIT = ADMIN_SNAPSHOT_MAX_LIMIT + 1;
export const ADMIN_SNAPSHOT_MAX_QUERY_CHARS = 200;
export const ADMIN_SNAPSHOT_MAX_CURSOR_CHARS = 4096;

export const normalizeAdminSnapshotLimit = (value: unknown, fallback: number, max = ADMIN_SNAPSHOT_MAX_LIMIT): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(1, Math.floor(numeric))) : fallback;
};

export const normalizeAdminSnapshotQuery = (value: unknown): string =>
  (typeof value === 'string' ? value : '').trim().slice(0, ADMIN_SNAPSHOT_MAX_QUERY_CHARS);

export class InvalidAdminSnapshotCursorError extends Error {
  constructor() {
    super('Invalid admin directory cursor');
    this.name = 'InvalidAdminSnapshotCursorError';
  }
}

export type AdminSnapshotCursorKey = {
  createdAt: string | null;
  id: string;
};

export const adminSnapshotCursorKey = (record: DatedRecord): AdminSnapshotCursorKey => {
  const timestamp = createdAtMs(record);
  return {
    createdAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    id: recordId(record)
  };
};

const isAdminSnapshotCursorKey = (value: unknown): value is AdminSnapshotCursorKey => {
  if (!value || typeof value !== 'object') return false;
  const key = value as Record<string, unknown>;
  if (typeof key.id !== 'string' || !key.id) return false;
  if (key.createdAt === null) return true;
  return typeof key.createdAt === 'string' && Number.isFinite(new Date(key.createdAt).getTime());
};

export const encodeAdminSnapshotCursor = (value: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

export const decodeAdminSnapshotCursor = (value: unknown): Record<string, unknown> | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > ADMIN_SNAPSHOT_MAX_CURSOR_CHARS) {
    throw new InvalidAdminSnapshotCursorError();
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('bad cursor');
    return decoded as Record<string, unknown>;
  } catch {
    throw new InvalidAdminSnapshotCursorError();
  }
};

export const requireAdminSnapshotCursorKey = (value: unknown): AdminSnapshotCursorKey => {
  if (!isAdminSnapshotCursorKey(value)) throw new InvalidAdminSnapshotCursorError();
  return value;
};

// Keyset continuation for the canonical newest-first ordering used by admin
// directories: createdAt descending, then the stable id ascending. Mongo's
// `{ createdAt: null }` also covers a missing field, which sorts with null at
// the tail of this ordering.
export const adminSnapshotAfterFilter = (
  key: AdminSnapshotCursorKey,
  idField: string,
  idValue: unknown = key.id
): Record<string, unknown> => {
  const idAfter = { [idField]: { $gt: idValue } };
  if (key.createdAt === null) return { createdAt: null, ...idAfter };
  const createdAt = new Date(key.createdAt);
  return {
    $or: [
      { createdAt: { $lt: createdAt } },
      { createdAt, ...idAfter },
      { createdAt: null }
    ]
  };
};

// Exact matches that are injected as their own pagination source must not also
// surface through the ordinary collection scan on a later page. Keeping the
// exclusion in this shared helper makes that invariant explicit and testable.
export const adminSnapshotExcludingIdFilter = (
  base: Record<string, unknown>,
  idField: string,
  excludedId: string | null
): Record<string, unknown> =>
  excludedId ? { $and: [base, { [idField]: { $ne: excludedId } }] } : base;

// Constructed per overview request so a long-lived Nitro process never keeps
// counting sessions against the time at which this module was first imported.
export const createLiveSessionClause = (now = new Date()) => ({
  revokedAt: null,
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
});

type DatedRecord = {
  _id?: unknown;
  shareId?: unknown;
  createdAt?: unknown;
};

// Thing documents paginate by their stable public shareId; legacy documents
// do not have one and fall back to Mongo's _id. Prefer shareId when both are
// present so the encoded cursor uses the same value as the Mongo sort/filter.
const recordId = (record: DatedRecord): string => String(record.shareId ?? record._id ?? '');

const createdAtMs = (record: DatedRecord): number => {
  const date = record.createdAt instanceof Date ? record.createdAt : record.createdAt ? new Date(record.createdAt as any) : null;
  const value = date?.getTime();
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};

export const compareAdminSnapshotNewest = (a: DatedRecord, b: DatedRecord): number => {
  const byCreatedAt = createdAtMs(b) - createdAtMs(a);
  return byCreatedAt || recordId(a).localeCompare(recordId(b));
};

export type AdminSnapshotSource<T> = {
  records: T[];
  // True means the database has at least one record after this in-memory
  // window. Once that window is consumed we must stop: without fetching the
  // next record we cannot safely compare it with another source's head.
  hasMore: boolean;
};

export type ConsumedAdminSnapshot<T> = {
  records: T[];
  consumed: number[];
};

// Consume a globally newest-first page from independently keyset-paginated
// sources. Unlike concatenating/slicing two source windows, this advances each
// source only through records actually inspected for this output page. The
// include hook lets callers consume-but-hide canonical duplicates while still
// returning the precise cursor advancement for every source.
export const consumeAdminSnapshotNewest = <T extends DatedRecord>(
  sources: Array<AdminSnapshotSource<T>>,
  limit: number,
  include: (record: T, sourceIndex: number) => boolean = () => true
): ConsumedAdminSnapshot<T> => {
  const capped = Math.max(0, Math.floor(limit));
  const consumed = sources.map(() => 0);
  const records: T[] = [];

  while (records.length < capped) {
    // A source whose loaded window has been consumed but which has an unseen
    // lookahead record blocks further comparison. Returning a short page here
    // preserves global ordering; the next request resumes that source first.
    const blocked = sources.some(
      (source, sourceIndex) => source.hasMore && consumed[sourceIndex] >= source.records.length
    );
    if (blocked) break;

    let newestSource = -1;
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const candidate = sources[sourceIndex].records[consumed[sourceIndex]];
      if (!candidate) continue;
      if (
        newestSource === -1 ||
        compareAdminSnapshotNewest(candidate, sources[newestSource].records[consumed[newestSource]]) < 0
      ) {
        newestSource = sourceIndex;
      }
    }
    if (newestSource === -1) break;

    const record = sources[newestSource].records[consumed[newestSource]];
    consumed[newestSource] += 1;
    if (include(record, newestSource)) records.push(record);
  }

  return { records, consumed };
};

// Things-era rows win over legacy twins. Sorting happens only after the two
// bounded source windows are merged, so equal timestamps have one stable order.
export const mergeAdminSnapshotNewest = <T extends DatedRecord>(primary: T[], legacy: T[], limit: number): T[] => {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const record of [...primary, ...legacy]) {
    const id = recordId(record);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(record);
  }
  return merged.sort(compareAdminSnapshotNewest).slice(0, Math.max(0, Math.floor(limit)));
};
