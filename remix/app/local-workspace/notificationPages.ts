import { notificationHistoryAccess, type NotificationHistoryAccess } from './notificationHistoryAccess';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

/** Exact account read snapshots. A cached page never claims to include remote
 * notifications that this device has not fetched, or satisfy different filters. */
export class NotificationPages {
 private db: WorkspaceDatabase;
 private scope: WorkspaceScope;
 private lease: WorkspaceLease;
 private access: NotificationHistoryAccess;
 constructor(db: WorkspaceDatabase, scope: WorkspaceScope, lease: WorkspaceLease, access = notificationHistoryAccess(scope)) {
  this.db = db; this.scope = scope; this.lease = lease; this.access = access;
 }
 private async key(args: Record<string, unknown>) {
  const normalized = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== null).sort(([a], [b]) => a.localeCompare(b)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalized)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
 }
 async read(args: Record<string, unknown>, transport: () => Promise<any>, savedOnly = false) {
  if (this.scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Account history requires an account.');
  this.lease.assertCurrent();
  const key = await this.key(args);
  this.lease.assertCurrent();
  const ticket = this.access.beginRead();
  try {
   if (savedOnly) throw new WorkspaceError('CACHED_HISTORY_ONLY', 'Only previously downloaded history is available offline.', 503);
   const response = await transport();
   this.lease.assertCurrent();
   if (response?.ok === false) throw new WorkspaceError('NOTIFICATION_READ_FAILED', 'Could not read account history.', typeof response.status === 'number' ? response.status : 502);
   if (!Array.isArray(response?.notifications)) throw new WorkspaceError('INVALID_NOTIFICATION_PAGE', 'Invalid account history response.', 502);
   const savedAt = Date.now();
   // Retention failure must not hide a successfully fetched account page.
   let retained = true;
   try { await this.db.transaction(this.scope, 'readwrite', this.lease, tx => tx.put('notification-account-pages', key, { response, savedAt })); }
   catch { this.lease.assertCurrent(); retained = false; }
   const cacheAllowed = this.access.authorize(ticket);
   if (!cacheAllowed && !this.access.canReadCached()) {
    // A newer refusal also fences an older successful response, including its live projection.
    const latest = this.access.beginRead();
    if (latest.revision !== ticket.revision || (latest.marker !== undefined && latest.marker !== ticket.marker)) throw new WorkspaceError('NOTIFICATION_ACCESS_CHANGED', 'Account history access changed. Retry a fresh account read.', 409);
   }
   return { ...response, cachedHistory: false, retainedHistory: retained && cacheAllowed, savedAt };
  } catch (error) {
   // Authorization refusals cannot reveal previously cached private content.
   const status = error instanceof WorkspaceError ? error.status : (error as any)?.status;
   if ([401, 403, 409].includes(status) || ['WORKSPACE_CHANGED', 'ACCOUNT_UNCONFIRMED', 'DATA_PLANE_CHANGED'].includes((error as any)?.code)) {
    this.access.refuse();
    try {
     await this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
      for (const row of await tx.list('notification-account-pages')) await tx.delete('notification-account-pages', row.id);
     });
    } catch { /* Preserve the refusal even when deletion/storage/lease validation fails. */ }
    throw error;
   }
   this.lease.assertCurrent();
   if (!this.access.canReadCached()) throw error;
   if (typeof status === 'number' && status >= 400 && status < 500 && ![408, 429].includes(status)) throw error;
   const saved = await this.db.transaction(this.scope, 'readonly', this.lease, tx => tx.get<{ response: any; savedAt: number }>('notification-account-pages', key));
   if (!saved) throw error;
   this.lease.assertCurrent();
   if (!this.access.canReadCached()) throw error;
   return { ...saved.response, cachedHistory: true, retainedHistory: true, savedAt: saved.savedAt };
  }
 }
}
