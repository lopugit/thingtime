// Opt-in native browser acceptance. Synthetic account transports confer no server authority.
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { LocalPasswordVault, type PasswordVaultRemoteEntry, type PasswordVaultTransport } from './passwordVault';
import { emptyPasswordEntry } from '../passwords/model';
const check = (value: unknown, message: string) => { if (!value) throw Error(message); };
const same = (a: unknown, b: unknown, message: string) => check(JSON.stringify(a) === JSON.stringify(b), message);
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const transport = (page: PasswordVaultTransport['page']): PasswordVaultTransport => ({ page, async read() { throw Error('Unexpected remote read'); }, async write() { throw Error('Unexpected remote write'); } });
export async function run() {
 check(indexedDB instanceof IDBFactory, 'Native IDBFactory required');
 const name = `capacity-native-${crypto.randomUUID()}`, db = new WorkspaceDatabase(indexedDB, name), peerDb = new WorkspaceDatabase(indexedDB, name);
 const scope = { kind: 'account', ownerId: 'synthetic-capacity', origin: location.origin, dataPlane: 'fixture-only' } as const;
 const vault = new LocalPasswordVault(db, scope, lease, location.origin), peer = new LocalPasswordVault(peerDb, scope, lease, location.origin);
 const phrase = 'Disposable browser fixture passphrase';
 const row = (title: string): PasswordVaultRemoteEntry => ({ id: crypto.randomUUID(), revision: 1, updatedAt: '2026-10-27T00:00:00.000Z', title, passwordType: 'login', entry: { ...emptyPasswordEntry(), title } });
 const readUsage = () => db.transaction(scope, 'readonly', lease, tx => tx.usage());
 try {
  await vault.unlock(phrase, true); await peer.unlock(phrase);
  const entries = Array.from({ length: 205 }, (_, n) => row(`Native page ${n} 🦄`)); let calls = 0;
  const result = await vault.reconcile(transport(async cursor => { const i = cursor === undefined ? 0 : Number(cursor); check(i === calls++, 'Cursor skipped'); return { entries: [entries[i]], nextCursor: i + 1 < entries.length ? String(i + 1) : null }; }));
  check(result.retained === 205 && calls === 205, 'Incomplete native reconciliation');
  await db.close();
  for (const value of entries) same((await vault.read(value.id)).entry, value.entry, 'Reopened value changed');
  const started = deferred(), release = deferred(), stale = row('Superseded synthetic result');
  const old = vault.reconcile(transport(async () => { started.resolve(); await release.promise; return { entries: [stale], nextCursor: null }; }));
  await started.promise; await peer.reconcile(transport(async () => ({ entries: [], nextCursor: null }))); release.resolve();
  same(await old, { retained: 0, superseded: true }, 'Stale pull accepted');
  let missing = false; try { await vault.read(stale.id); } catch (error: any) { missing = error.code === 'PASSWORD_MISSING'; } check(missing, 'Stale value resurrected');
  for (let i = 0; i < 257; i++) await db.transaction({ ...scope, ownerId: `actor-${i}`, delegatedBy: scope.ownerId }, 'readwrite', lease, tx => tx.putBytes('file', new Uint8Array(1)));
  const partitionUsage = await db.accountUsage(scope, lease);
  const rootUsage = await readUsage();
  same(partitionUsage, { bytes: rootUsage.bytes + 257, records: rootUsage.records + 257 }, 'Partition discovery incomplete');
  let checks = 0, cancelled = false;
  try { await db.accountUsage(scope, { ...lease, assertCurrent() { if (++checks >= 20) throw Error('Synthetic identity retired'); } }); } catch (error: any) { cancelled = /identity retired/.test(error.message); }
  check(cancelled, 'Discovery cancellation ignored'); same(await db.accountUsage(scope, lease), partitionUsage, 'Cancellation changed accounting');
  await db.transaction(scope, 'readwrite', lease, tx => tx.put('capacity-notes', 'kept', { text: 'Committed value' }));
  const before = await readUsage(), put = IDBObjectStore.prototype.put;
  let injected = false, refused = false;
  IDBObjectStore.prototype.put = function(value: any, ...args: any[]) {
   if (!injected && this.name === 'records' && value.id === 'quota-trigger') { injected = true; throw new DOMException('Synthetic native boundary quota refusal', 'QuotaExceededError'); }
   return Reflect.apply(put, this, [value, ...args]);
  };
  try {
   await db.transaction(scope, 'readwrite', lease, async tx => { await tx.put('capacity-notes', 'kept', { text: 'Must roll back' }); await tx.putBytes('quota-trigger', new Uint8Array(1024)); });
  } catch (error: any) { refused = error.code === 'LOCAL_QUOTA' && error.status === 507; }
  finally { IDBObjectStore.prototype.put = put; }
  check(injected && refused, 'Quota-class error not reported');
  await db.transaction(scope, 'readonly', lease, async tx => { same(await tx.get('capacity-notes', 'kept'), { text: 'Committed value' }, 'Partial value committed'); check(await tx.getBytes('quota-trigger') === undefined, 'Partial bytes committed'); same(await tx.usage(), before, 'Quota accounting changed'); });
  await db.transaction(scope, 'readwrite', lease, tx => tx.putBytes('quota-trigger', new Uint8Array(1024)));
  check((await db.transaction(scope, 'readonly', lease, tx => tx.getBytes('quota-trigger')))?.length === 1024, 'Retry failed');
  return { nativeIndexedDB: true, syntheticTransport: true, refreshedPages: calls, exactReopenedEntries: entries.length, delegatedPartitions: 257, discoveryCancellation: cancelled, stalePullFenced: true, quotaRefusal: 'injected QuotaExceededError at native IDBObjectStore.put; not actual disk exhaustion', nativeTransactionRollback: true, retry: true };
 } finally {
  vault.dispose(); peer.dispose(); await db.close(); await peerDb.close();
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('Fixture database cleanup blocked')); });
 }
}

let quotaDb: WorkspaceDatabase | undefined, quotaName = '', quotaBefore: unknown;
const anonymous = { kind: 'anonymous' } as const;
export async function prepareNativeQuota() {
 quotaName = `native-quota-${crypto.randomUUID()}`; quotaDb = new WorkspaceDatabase(indexedDB, quotaName);
 await quotaDb.transaction(anonymous, 'readwrite', lease, tx => tx.put('notes', 'kept', { text: 'Committed before browser quota override' }));
 quotaBefore = await quotaDb.transaction(anonymous, 'readonly', lease, tx => tx.usage());
}
export async function attemptNativeQuota() {
 const db = quotaDb!; let refused = false;
 try { await db.transaction(anonymous, 'readwrite', lease, async tx => { await tx.put('notes', 'kept', { text: 'Uncommitted replacement' }); await tx.putBytes('oversize', new Uint8Array(16 * 1024 * 1024)); }); }
 catch (error: any) { refused = error.code === 'LOCAL_QUOTA' && error.status === 507; }
 if (!refused) return { nativeChromiumQuotaEnforcement: false, quotaSource: 'CDP command accepted but native quota refusal not observed in this browser context', attemptedBytes: 16 * 1024 * 1024, rollback: false };
 await db.transaction(anonymous, 'readonly', lease, async tx => { same(await tx.get('notes', 'kept'), { text: 'Committed before browser quota override' }, 'Native quota retained partial replacement'); check(await tx.getBytes('oversize') === undefined, 'Native quota retained partial bytes'); same(await tx.usage(), quotaBefore, 'Native quota changed accounting'); });
 return { nativeChromiumQuotaEnforcement: true, quotaSource: 'CDP Storage.overrideQuotaForOrigin at1MiB; not naturally full device', attemptedBytes: 16 * 1024 * 1024, rollback: true };
}
export async function finishNativeQuota(retry: boolean) {
 const db = quotaDb!;
 try { if (retry) { await db.transaction(anonymous, 'readwrite', lease, tx => tx.putBytes('retry', new Uint8Array(16 * 1024 * 1024))); check((await db.transaction(anonymous, 'readonly', lease, tx => tx.getBytes('retry')))?.length === 16 * 1024 * 1024, 'Native quota retry failed'); } }
 finally { await db.close(); await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(quotaName); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); quotaDb = undefined; }
 return { retry, cleaned: true };
}
