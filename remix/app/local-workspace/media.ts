import { attachmentMediaKindForContentType } from '../api/utils/attachments/attachmentCore';
import type { WorkspaceLease } from './storage';
import { WORKSPACE_LIMITS } from './storage';

export const LOCAL_MEDIA_UNAVAILABLE = ''; // Omit DOM src/href until validated bytes are ready.
/** Only canonical relative local content references use device bytes. A remote
 * URL, shared key or caller-selected account can never select this adapter. */
export function localMediaId(url: string): string | null {
 if (!url.startsWith('/api/v1/attachments/content?')) return null;
 const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
 const id = params.get('id');
 return params.getAll('id').length === 1 && id && /^local-[a-zA-Z0-9-]{1,100}$/.test(id) ? id : null;
}
type Entry = { refs: number; lease: WorkspaceLease; dispose: () => void; url?: string; size: number; error?: string; loading: boolean; cancelled: boolean };
type FileBytes = { bytes: Uint8Array; contentType: string };
/** Reference-counted object URLs. Nothing is cached under an account cookie or
 * server ID, and every read and URL lookup rechecks the captured local lease. */
export class LocalMediaRegistry {
 private entries = new Map<string, Entry>();
 private listeners = new Set<() => void>();
 private version = 0;
 private capacityError = false;
 private running = 0;
 private queued: (() => void)[] = [];
 constructor(private deps: { lease: () => WorkspaceLease; read: (id: string) => Promise<FileBytes>; create: (bytes: Uint8Array, type: string) => string; revoke: (url: string) => void }) {}
 subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 snapshot = () => this.version;
 private publish() { this.version++; this.listeners.forEach(listener => listener()); }
 private revoke(entry: Entry) { if (entry.url) this.deps.revoke(entry.url); entry.url = undefined; entry.size = 0; }
 private pump() { while (this.running < 3 && this.queued.length) this.queued.shift()!(); }
 retain(id: string) {
  const found = this.entries.get(id);
  if (found) { found.refs++; return () => this.release(id, found); }
  if (this.entries.size >= 64) { if (!this.capacityError) { this.capacityError = true; this.publish(); } throw new Error('Too many local media files are visible. Open a smaller selection.'); }
  const lease = this.deps.lease();
  const entry: Entry = { refs: 1, lease, dispose: () => {}, size: 0, loading: true, cancelled: false };
  this.entries.set(id, entry);
  const invalidate = () => { entry.cancelled = true; this.revoke(entry); entry.error = 'The workspace changed. Reopen this file.'; entry.loading = false; this.publish(); };
  entry.dispose = lease.onInvalidate(invalidate);
  this.queued.push(() => {
   if (entry.cancelled) return;
   this.running++;
   void Promise.resolve().then(() => { lease.assertCurrent(); return this.deps.read(id); }).then(result => {
    lease.assertCurrent(); if (entry.cancelled) return;
    const total = [...this.entries.values()].reduce((sum, item) => sum + item.size, 0);
    if (!(result.bytes instanceof Uint8Array) || result.bytes.byteLength > WORKSPACE_LIMITS.binaryBytes || total + result.bytes.byteLength > WORKSPACE_LIMITS.bytes) throw new Error('Local media exceeds the device preview limit.');
    // HTML/SVG and arbitrary files are opaque downloads, never active documents.
    const type = attachmentMediaKindForContentType(result.contentType) === 'file' ? 'application/octet-stream' : result.contentType;
    entry.url = this.deps.create(result.bytes, type); entry.size = result.bytes.byteLength;
   }).catch(error => { if (!entry.cancelled) entry.error = error instanceof Error ? error.message : 'Local file could not be opened'; }).finally(() => {
    entry.loading = false; this.running--; this.publish(); this.pump();
   });
  });
  this.pump(); this.publish();
  return () => this.release(id, entry);
 }
 private release(id: string, entry: Entry) {
  if (--entry.refs > 0) return;
  entry.cancelled = true; entry.dispose(); this.revoke(entry);
  if (this.entries.get(id) === entry) this.entries.delete(id);
  this.capacityError = false; this.publish();
 }
 url(id: string) {
  const entry = this.entries.get(id);
  if (!entry) return LOCAL_MEDIA_UNAVAILABLE;
  try { entry.lease.assertCurrent(); } catch { return LOCAL_MEDIA_UNAVAILABLE; }
  return entry.url || LOCAL_MEDIA_UNAVAILABLE;
 }
 errors() { return [...(this.capacityError ? ['Too many local media files are visible. Open a smaller selection.'] : []), ...[...this.entries.values()].flatMap(entry => entry.error ? [entry.error] : [])]; }
 removed(ids: readonly string[]) {
  for (const id of ids) { const entry = this.entries.get(id); if (entry) { entry.cancelled = true; this.revoke(entry); entry.loading = false; entry.error = 'This local file was deleted.'; } }
  this.publish();
 }
}
