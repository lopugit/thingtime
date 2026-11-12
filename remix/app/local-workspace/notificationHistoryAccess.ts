import { workspaceScopeKey, type WorkspaceScope } from './storage';

type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ReadTicket = { revision: number; marker: string | null | undefined };
export type NotificationHistoryAccess = {
 canReadCached(): boolean;
 beginRead(): ReadTicket;
 authorize(ticket: ReadTicket): boolean;
 refuse(): void;
};
const states = new Map<string, { refused: boolean; revision: number }>();
const refusalListeners = new Map<string, Set<() => void>>();
const browserStorage = () => typeof window === 'undefined' ? undefined : window.localStorage;
export const notificationHistoryRefusalKey = (scope: WorkspaceScope) => `tt-notif-history-refused:${workspaceScopeKey(scope)}`;

/** A non-content denial marker gates both IDB snapshots and first-paint mirrors.
 * Unavailable marker storage is fail-closed for cached remote history; live
 * authorized reads and independent local history remain available. */
export function notificationHistoryAccess(scope: WorkspaceScope, storage: () => MarkerStorage | undefined = browserStorage): NotificationHistoryAccess {
 const key = notificationHistoryRefusalKey(scope);
 let state = states.get(key);
 if (!state) { state = { refused: false, revision: 0 }; states.set(key, state); }
 const current = state;
 const marker = () => storage()?.getItem(key);
 const writable = (target: MarkerStorage) => {
  // Some contexts allow reads while denying writes. A separate non-content
  // probe prevents a fresh context from interpreting that as an absent denial.
  const probe = `${key}:probe`, value = crypto.randomUUID();
  try {
   target.setItem(probe, value);
   if (target.getItem(probe) !== value) return false;
   target.removeItem(probe);
   return target.getItem(probe) === null;
  } catch { return false; }
 };
 return {
  canReadCached() {
   try { const target = storage(); return !!target && target.getItem(key) === null && !current.refused && writable(target); } catch { return false; }
  },
  beginRead() {
   let value: string | null | undefined;
   try { value = marker(); } catch { value = undefined; }
   return { revision: current.revision, marker: value };
  },
  authorize(ticket) {
   if (ticket.revision !== current.revision) return false;
   try {
    const target = storage();
    if (!target || !writable(target)) return false;
    // A refusal in another tab after this read began must win over its late reply.
    if (ticket.marker !== undefined && target.getItem(key) !== ticket.marker) return false;
    target.removeItem(key);
    if (target.getItem(key) !== null) return false;
    current.refused = false;
    return true;
   } catch { return false; }
  },
  refuse() {
   current.refused = true; current.revision++;
   try { storage()?.setItem(key, crypto.randomUUID()); } catch { /* In-memory denial remains authoritative in this context. */ }
   // Native storage events exclude the writing context. Even a stale request's
   // refusal must retire its currently projected scope in this tab.
   for (const listener of [...(refusalListeners.get(key) || [])]) {
    try { listener(); } catch { /* One observer cannot suppress other retirements or replace the refusal. */ }
   }
  }
 };
}

/** Same-context refusals and cross-tab storage events are only invalidation hints. Consumers must reread
 * their current scope/lease and call canReadCached before projecting any rows. */
export function subscribeNotificationHistoryAccess(scope: WorkspaceScope, listener: () => void) {
 const key = notificationHistoryRefusalKey(scope);
 const changed = (event: StorageEvent) => {
  if (event.key === key || event.key === null) { try { listener(); } catch { /* Refusal observers are best effort. */ } }
 };
 let listeners = refusalListeners.get(key);
 if (!listeners) { listeners = new Set(); refusalListeners.set(key, listeners); }
 listeners.add(listener);
 if (typeof window !== 'undefined') window.addEventListener('storage', changed);
 let subscribed = true;
 return () => {
  if (!subscribed) return;
  subscribed = false;
  listeners.delete(listener);
  if (!listeners.size) refusalListeners.delete(key);
  if (typeof window !== 'undefined') window.removeEventListener('storage', changed);
 };
}
