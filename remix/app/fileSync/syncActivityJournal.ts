import { journalScope, type JournalAccess } from './journalScope';
import type { TransferActivity } from './transferActivity';
import { DEVICE_SYNC_HISTORY_STORE as STORE } from './deviceSyncHistoryJournal';
import { DEFAULT_SYNC_ACTIVITY_PAGE_SIZE, isSyncActivityCount, parseSyncActivityQuery, parseSyncActivityRecord, type SyncActivityCursor, type SyncActivityQuery, type SyncActivityRecord, type SyncActivityStatus } from './syncActivity';
export type { SyncActivityCursor, SyncActivityRecord } from './syncActivity';
export const SYNC_ACTIVITY_CHANGED_EVENT = 'tt:sync-activity-changed';

/** Receipt events measure acknowledged payload in this observed attempt. An
 * opaque receipt or unobserved direction cannot be presented as a byte total. */
export function createSyncActivityObservation(id: string, clock = Date.now) {
 const startedAt = clock();
 const directions = {
  upload: { bytes: 0, observed: false, incomplete: false },
  download: { bytes: 0, observed: false, incomplete: false }
 };
 let lastActivityAt = startedAt;
 const snapshot = () => {
  const bytes = (direction: keyof typeof directions) => directions[direction].observed && !directions[direction].incomplete ? directions[direction].bytes : null;
  return { startedAt, lastActivityAt, sentBytes: bytes('upload'), receivedBytes: bytes('download') };
 };
 return {
  snapshot,
  transfer(event: TransferActivity) {
   lastActivityAt = Math.max(startedAt, lastActivityAt, clock());
   if (!('bytes' in event)) return;
   const direction = directions[event.direction];
   if (event.bytes === null || !isSyncActivityCount(event.bytes) || !isSyncActivityCount(direction.bytes + event.bytes)) direction.incomplete = true;
   else { direction.bytes += event.bytes; direction.observed = true; }
  },
  finish(status: SyncActivityStatus): SyncActivityRecord {
   const endedAt = Math.max(lastActivityAt, clock());
   return parseSyncActivityRecord({ ...snapshot(), id, endedAt, lastActivityAt: status === 'complete' ? endedAt : lastActivityAt, status });
  }
 };
}

/** The canonical sync history store holds device-rate samples under a device
 * key, and receipt summaries under the distinct, five-field config key.
 * Neither projection can read the other's records. */
export function syncActivityJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
 const bound = journalScope(db, access, keyRange);
 return {
  async append(record: SyncActivityRecord) {
   const row = parseSyncActivityRecord(record);
   await bound.transaction<void>([STORE], 'readwrite', (tx, done, fail) => {
    const request = tx.objectStore(STORE).add(row, [bound.key, row.endedAt, row.id]);
    request.onsuccess = () => { try { bound.check(); done(); } catch (error) { fail(error); } };
   });
   if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_ACTIVITY_CHANGED_EVENT));
  },
  read(query: SyncActivityQuery = {}) {
   const { limit = DEFAULT_SYNC_ACTIVITY_PAGE_SIZE, before } = parseSyncActivityQuery(query);
   const range = (keyRange ?? IDBKeyRange).bound([bound.key], before ? [bound.key, before.endedAt, before.id] : [bound.key, []], false, !!before);
   return bound.transaction<{ records: SyncActivityRecord[]; next: SyncActivityCursor | null }>([STORE], 'readonly', (tx, done, fail) => {
    const records: SyncActivityRecord[] = [], request = tx.objectStore(STORE).openCursor(range, 'prev');
    request.onsuccess = () => { try {
     bound.check();
     const cursor = request.result;
     if (!cursor || records.length === limit) {
      const last = records.at(-1);
      done({ records, next: cursor && last ? { endedAt: last.endedAt, id: last.id } : null });
      return;
     }
     const row = parseSyncActivityRecord(cursor.value);
     const key = cursor.primaryKey;
     if (!Array.isArray(key) || key[0] !== bound.key || key[1] !== row.endedAt || key[2] !== row.id) throw Error('Sync activity scope changed.');
     records.push(row);
     cursor.continue();
    } catch (error) { fail(error); } };
   });
  }
 };
}
