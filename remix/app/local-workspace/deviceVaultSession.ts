import { createDeviceVaultKey, wrapDeviceVaultKey, unwrapDeviceVaultKey, type DeviceVaultKey } from '../passwords/vaultCrypto';
import type { PasswordKeyEnvelope } from '../passwords/vaultEnvelopeContract';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

export type DeviceVaultDomain = 'passwords' | 'providers';
const IDLE_MS = 5 * 60_000;
type KeyHeader = { version: 1; passwordKey: PasswordKeyEnvelope };
const refuse = (code: string, message: string, status = 409): never => { throw new WorkspaceError(code, message, status); };
export const deviceVaultCollections = (domain: DeviceVaultDomain) => {
 if (domain !== 'passwords' && domain !== 'providers') throw new Error('Invalid device vault domain');
 const prefix = domain === 'passwords' ? 'password-vault' : 'provider-vault';
 return { keys: `${prefix}-keys`, records: `${prefix}-records`, commands: `${prefix}-commands` };
};

/** Shared key lifetime only; each domain owns its canonical records and queues.
 * No account session, network transport or server key is available here. */
export class DeviceVaultSession {
 protected readonly collections: ReturnType<typeof deviceVaultCollections>;
 private key: DeviceVaultKey | null = null;
 private generation = 0;
 private disposed = false;
 private unlocking = false;
 private timer?: ReturnType<typeof setTimeout>;
 private listeners = new Set<() => void>();
 private retired: () => void;
 protected readonly context: Promise<string>;
 constructor(protected db: WorkspaceDatabase, readonly scope: WorkspaceScope, protected lease: WorkspaceLease, browserOrigin: string, readonly domain: DeviceVaultDomain = 'passwords') {
  if (new URL(browserOrigin).origin !== browserOrigin) throw new Error('Invalid device vault origin');
  this.collections = deviceVaultCollections(domain);
  // Keep password AAD byte-for-byte compatible with existing device records.
  const identity = JSON.stringify(['thingtime-device-vault', browserOrigin, workspaceScopeKey(scope), ...(domain === 'passwords' ? [] : [domain])]);
  this.context = crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)).then(hash =>
   'device-vault:' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
  this.retired = lease.onInvalidate(() => this.lock());
 }
 protected check() { this.lease.assertCurrent(); if (this.disposed) refuse('VAULT_CLOSED', 'Reopen the device vault.'); }
 readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 readonly isUnlocked = () => { try { this.check(); return this.key !== null; } catch { return false; } };
 lock() { clearTimeout(this.timer); this.key?.bytes.fill(0); this.key = null; this.generation++; this.listeners.forEach(listener => listener()); }
 dispose() { this.disposed = true; this.lock(); this.retired(); this.listeners.clear(); }
 touch() { if (this.isUnlocked()) this.arm(); }
 private arm() { clearTimeout(this.timer); this.timer = setTimeout(() => this.lock(), IDLE_MS); (this.timer as any).unref?.(); }
 protected guarded(assertCurrent: () => void, signal?: AbortSignal): WorkspaceLease {
  return { assertCurrent, onInvalidate: callback => {
   const changed = () => { try { assertCurrent(); } catch { callback(); } };
   this.listeners.add(changed); signal?.addEventListener('abort', changed, { once: true });
   const unsubscribe = this.lease.onInvalidate(changed);
   return () => { this.listeners.delete(changed); signal?.removeEventListener('abort', changed); unsubscribe(); };
  } };
 }
 protected operation(signal?: AbortSignal, touch = true) {
  this.check(); const key = this.key, generation = this.generation;
  if (!key) return refuse('VAULT_LOCKED', 'Unlock this device vault to continue.', 423);
  if (touch) this.arm();
  const assertCurrent = () => { this.check(); if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); if (this.generation !== generation || this.key !== key) refuse('VAULT_LOCKED', 'This device vault was locked. Unlock it again.', 423); };
  assertCurrent(); return { key, lease: this.guarded(assertCurrent, signal) };
 }
 async configured() { this.check(); return !!await this.db.transaction(this.scope, 'readonly', this.lease, tx => tx.get(this.collections.keys, 'key')); }
 async unlock(password: string, create = false) {
  this.check(); if (this.unlocking) return refuse('VAULT_BUSY', 'A vault unlock is already in progress.');
  this.unlocking = true; this.lock(); const generation = this.generation;
  const check = () => { this.check(); if (this.generation !== generation) refuse('VAULT_LOCKED', 'Vault unlock was cancelled.', 423); };
  let key: DeviceVaultKey | undefined;
  try {
   const owner = await this.context; check();
   const header = await this.db.transaction(this.scope, 'readonly', this.lease, tx => tx.get<KeyHeader>(this.collections.keys, 'key')); check();
   if (header) {
    if (header.version !== 1) refuse('VAULT_FORMAT', 'This device vault format is not supported.', 422);
    key = await unwrapDeviceVaultKey(owner, password, header.passwordKey, check);
   } else {
    if (!create) refuse('VAULT_MISSING', 'Set up this device vault first.', 404);
    if (typeof password !== 'string' || password.length < 12) refuse('VAULT_PASSPHRASE', 'Use a device vault passphrase of at least 12 characters.', 400);
    key = createDeviceVaultKey(); const passwordKey = await wrapDeviceVaultKey(owner, key, password, check); check();
    await this.db.transaction(this.scope, 'readwrite', this.guarded(check), async tx => {
     if (await tx.get(this.collections.keys, 'key')) refuse('VAULT_EXISTS', 'Another tab set up this vault. Unlock it with its passphrase.');
     // An absent key beside encrypted records is damage, never an empty vault.
     if ((await tx.list(this.collections.records)).length || (await tx.list(this.collections.commands)).length) refuse('VAULT_DAMAGED', 'The saved device vault key is missing. Existing encrypted entries have been kept.', 422);
     await tx.put(this.collections.keys, 'key', { version: 1, passwordKey } satisfies KeyHeader);
    });
   }
   check(); this.key = key; key = undefined; this.arm(); this.listeners.forEach(listener => listener());
  } finally { key?.bytes.fill(0); this.unlocking = false; }
 }
}
