import { validateNotificationMessage } from '../api/utils/notifications/messageContract';
import { resolveNotificationListQuery, type NotificationListOptions } from '../api/utils/notifications/listQuery';
import { SYSTEM_NOTIFICATION_ACTOR_ID } from '../schemas/registry';
import type { NotificationItem } from '../components/Notifications/notificationCore';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceScope, type WorkspaceLease } from './storage';

const COLLECTION = 'notification-messages';
const CLAIM_MS = 30_000;
const bound = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 14)}… [truncated]` : text;
export type LocalMessageBody = { userId: string; eventId: string; title: string; description: string; status: 'success' | 'error' | 'info' | 'warning'; href?: string };
type Message = { id: string; body: LocalMessageBody; createdAt: string; state: 'local' | 'pending' | 'syncing' | 'synced' | 'error'; attempts: number; retryAt: number; claim?: string };
export type MessageTransport = (body: LocalMessageBody, signal?: AbortSignal) => Promise<string>;
const owner = (scope: WorkspaceScope) => scope.kind === 'account' ? scope.ownerId : 'local-workspace';
const project = (row: Message): NotificationItem => ({ id: row.id, type: 'system-message', category: 'system',
 actorId: SYSTEM_NOTIFICATION_ACTOR_ID, actorName: 'Lopu', actorUsername: null, actorAvatarUrl: null, targetId: null, postId: null,
 title: row.body.title, preview: row.body.description.slice(0, 140), detail: row.body.description, href: row.body.href || null,
 outcome: row.body.status === 'success' ? 'ok' : row.body.status === 'error' ? 'error' : null, readAt: row.createdAt, createdAt: row.createdAt });

/** Durable user-facing messages, never authoritative audit events. The queue is
 * part of the same record/transaction as the local history. Anonymous rows do
 * not have a transport state and cannot be promoted by logging in. */
export class LocalNotificationHistory {
 // TypeScript parameter properties initialize the service's storage boundary.
 // eslint-disable-next-line no-useless-constructor
 constructor(private db: WorkspaceDatabase, readonly scope: WorkspaceScope, private lease: WorkspaceLease, private now = Date.now) {}
 async save(input: unknown) {
  this.lease.assertCurrent();
  const parsed = validateNotificationMessage(owner(this.scope), input);
  if (!parsed) throw new WorkspaceError('INVALID_NOTIFICATION', 'Invalid notification message or workspace changed.');
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 60000) throw new WorkspaceError('INVALID_NOTIFICATION', 'Notification message exceeds the transport limit.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([owner(this.scope), parsed.eventId])));
  const id = `notification-message-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const body: LocalMessageBody = { userId: owner(this.scope), eventId: parsed.eventId, title: bound(parsed.title, 400), description: bound(parsed.description, 48000), status: parsed.status, ...(parsed.href ? { href: parsed.href } : {}) };
  // Redaction can expand short credential tokens. Bound the sanitized result
  // so the stored queue remains admissible to the same server validator.
  while (new TextEncoder().encode(JSON.stringify(body)).byteLength > 60000 && body.description.length > 100) body.description = bound(body.description, Math.floor(body.description.length * 0.75));
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 60000) throw new WorkspaceError('INVALID_NOTIFICATION', 'Sanitized notification exceeds the transport limit.');
  return this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
   const previous = await tx.get<Message>(COLLECTION, id);
   if (previous) {
    if (JSON.stringify(previous.body) !== JSON.stringify(body)) throw new WorkspaceError('NOTIFICATION_CONFLICT', 'A notification event cannot be overwritten.', 409);
    return id;
   }
   await tx.put(COLLECTION, id, { id, body, createdAt: new Date(this.now()).toISOString(), state: this.scope.kind === 'account' ? 'pending' : 'local', attempts: 0, retryAt: 0 } satisfies Message);
   return id;
  });
 }
 async list(options: NotificationListOptions & { cursor?: unknown } = {}) {
  const query = resolveNotificationListQuery({ ...options, history: options.history === 1 ? true : options.history });
  const key = JSON.stringify([workspaceScopeKey(this.scope), query.history, query.types, query.unread, query.q, query.since, query.until, query.before]);
  let after: { at: string; id: string } | null = null;
  if (options.cursor) {
   try {
    if (typeof options.cursor !== 'string' || options.cursor.length > 8192 || !options.cursor.startsWith('device-notifications:')) throw new Error();
    const parsed = JSON.parse(options.cursor.slice('device-notifications:'.length));
    if (parsed.key !== key || typeof parsed.id !== 'string' || typeof parsed.at !== 'string' || !Number.isFinite(Date.parse(parsed.at))) throw new Error();
    after = parsed;
   } catch { throw new WorkspaceError('INVALID_NOTIFICATION_CURSOR', 'Notification filters or workspace changed. Reload this history.'); }
  }
  return this.db.transaction(this.scope, 'readonly', this.lease, async tx => {
   const rows = (await tx.list<Message>(COLLECTION)).map(row => row.value);
   const matches = rows.filter(row => query.history && !query.unread && (!query.types || query.types.includes('system-message')) &&
    (!query.since || row.createdAt >= query.since.toISOString()) && (!query.until || row.createdAt <= query.until.toISOString()) &&
    (!query.before || row.createdAt < query.before.toISOString()) &&
    (!query.q || [row.body.title, row.body.description, 'Lopu'].some(text => text.toLowerCase().includes(query.q!.toLowerCase()))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
   const eligible = after ? matches.filter(row => row.createdAt < after!.at || (row.createdAt === after!.at && row.id < after!.id)) : matches;
   const page = eligible.slice(0, query.limit), last = page.at(-1);
   return { ok: true, deviceHistory: true, notifications: page.map(project), total: matches.length, unreadCount: 0, historyUnreadCount: 0,
    pendingCount: rows.filter(row => row.state === 'pending' || row.state === 'syncing').length,
    failedCount: rows.filter(row => row.state === 'error').length,
    nextCursor: last && eligible.length > page.length ? `device-notifications:${JSON.stringify({ key, at: last.createdAt, id: last.id })}` : null };
  });
 }
 /** Claims serialize across tabs. A lost response reuses the same event UUID;
  * neither retries nor account switches can duplicate or retarget an event. */
 async sync(transport: MessageTransport, signal?: AbortSignal) {
  if (this.scope.kind !== 'account') return { completed: 0, pending: false };
  let completed = 0;
  for (let count = 0; count < 20; count++) {
   signal?.throwIfAborted();
   const claimed = await this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
    const row = (await tx.list<Message>(COLLECTION)).map(entry => entry.value).find(row => (row.state === 'pending' || row.state === 'syncing') && row.retryAt <= this.now());
    if (!row) return null;
    const next: Message = { ...row, state: 'syncing', claim: globalThis.crypto.randomUUID(), retryAt: this.now() + CLAIM_MS };
    await tx.put(COLLECTION, row.id, next); return next;
   });
   if (!claimed) break;
   let status = 200;
   try {
    this.lease.assertCurrent(); signal?.throwIfAborted();
    if (await transport(claimed.body, signal) !== claimed.id) throw new WorkspaceError('NOTIFICATION_RESPONSE', 'Notification acknowledgement did not match the saved event.', 502);
   } catch (error) {
    this.lease.assertCurrent(); signal?.throwIfAborted();
    if (error instanceof WorkspaceError && ['WORKSPACE_CHANGED', 'ACCOUNT_UNCONFIRMED'].includes(error.code)) throw error;
    status = error instanceof WorkspaceError ? error.status : 503;
   }
   const acknowledged = await this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
    const current = await tx.get<Message>(COLLECTION, claimed.id);
    if (!current || current.claim !== claimed.claim) return false;
    const attempts = current.attempts + 1;
    const terminal = status >= 400 && status < 500 && ![408, 429].includes(status);
    const { claim: _claim, ...record } = current;
    await tx.put(COLLECTION, claimed.id, { ...record, state: status === 200 ? 'synced' : terminal || attempts >= 5 ? 'error' : 'pending', attempts,
     retryAt: status === 200 ? 0 : this.now() + Math.min(60_000, 1000 * 2 ** attempts) } satisfies Message);
    return status === 200;
   });
   if (acknowledged) completed++;
   if (status !== 200) break;
  }
  const page = await this.list({ history: true, limit: 1 });
  return { completed, pending: page.pendingCount > 0 };
 }
}
