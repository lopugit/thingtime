export type SyncActivityStatus = 'complete' | 'paused' | 'waiting' | 'error';
export type SyncActivitySnapshot = {
 startedAt: number;
 lastActivityAt: number;
 sentBytes: number | null;
 receivedBytes: number | null;
};
export type SyncActivityRecord = SyncActivitySnapshot & {
 id: string;
 endedAt: number;
 status: SyncActivityStatus;
};
export type SyncActivityCursor = Pick<SyncActivityRecord, 'endedAt' | 'id'>;
export type SyncActivityQuery = { limit?: number; before?: SyncActivityCursor };
export const DEFAULT_SYNC_ACTIVITY_PAGE_SIZE = 20;
const MAX_SYNC_ACTIVITY_PAGE_SIZE = 100;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
export const isSyncActivityCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const snapshotKeys = ['startedAt', 'lastActivityAt', 'sentBytes', 'receivedBytes'];
const invalid = () => Error('Invalid sync activity.');

export function parseSyncActivitySnapshot(value: unknown): SyncActivitySnapshot {
 if (!object(value) || !exact(value, snapshotKeys)) throw invalid();
 const { startedAt, lastActivityAt, sentBytes, receivedBytes } = value;
 if (!isSyncActivityCount(startedAt) || !isSyncActivityCount(lastActivityAt) || startedAt > lastActivityAt) throw invalid();
 const bytes = (value: unknown): number | null => {
  if (value === null) return null;
  if (!isSyncActivityCount(value)) throw invalid();
  return value;
 };
 return { startedAt, lastActivityAt, sentBytes: bytes(sentBytes), receivedBytes: bytes(receivedBytes) };
}

export function parseSyncActivityRecord(value: unknown): SyncActivityRecord {
 if (!object(value) || !exact(value, [...snapshotKeys, 'id', 'endedAt', 'status'])) throw invalid();
 const { id, endedAt, status, ...activity } = value;
 const snapshot = parseSyncActivitySnapshot(activity);
 if (!validId(id) || !isSyncActivityCount(endedAt) || endedAt < snapshot.lastActivityAt ||
  (status !== 'complete' && status !== 'paused' && status !== 'waiting' && status !== 'error')) throw invalid();
 return { ...snapshot, id, endedAt, status };
}

function parseCursor(value: unknown): SyncActivityCursor {
 if (!object(value) || !exact(value, ['endedAt', 'id']) || !isSyncActivityCount(value.endedAt) || !validId(value.id)) throw invalid();
 return { endedAt: value.endedAt, id: value.id };
}

export function parseSyncActivityQuery({ limit, before }: { limit?: unknown; before?: unknown }): SyncActivityQuery {
 const query: SyncActivityQuery = {};
 if (limit !== undefined) {
  if (!isSyncActivityCount(limit) || limit < 1 || limit > MAX_SYNC_ACTIVITY_PAGE_SIZE) throw invalid();
  query.limit = limit;
 }
 if (before !== undefined) query.before = parseCursor(before);
 return query;
}

export function parseSyncActivityPage(value: unknown, connectionId: string, query: SyncActivityQuery) {
 const limit = query.limit ?? DEFAULT_SYNC_ACTIVITY_PAGE_SIZE;
 if (!object(value) || !exact(value, ['connectionId', 'records', 'next']) || value.connectionId !== connectionId ||
  !Array.isArray(value.records) || value.records.length > limit) throw invalid();
 let previous = query.before;
 const records = value.records.map(row => {
  const record = parseSyncActivityRecord(row);
  if (previous && (record.endedAt > previous.endedAt || (record.endedAt === previous.endedAt && record.id >= previous.id))) throw invalid();
  previous = record;
  return record;
 });
 const next = value.next === null ? null : parseCursor(value.next);
 if (next && (records.length !== limit || !previous || previous.endedAt !== next.endedAt || previous.id !== next.id)) throw invalid();
 return { connectionId, records, next };
}
