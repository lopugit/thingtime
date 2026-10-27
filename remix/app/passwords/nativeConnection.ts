import type { NativePasswordConnection, NativePasswordResult } from './native.client';

type Connection = NativePasswordConnection | 'checking';
export type ConnectionSnapshot = { connection: Connection; busy: boolean; notice: string };
type Provider = (action: 'connect' | 'disconnect' | 'status', ownerId: string) => Promise<NativePasswordResult>;

/** One ephemeral controller per account/origin. Reopening always reads the device;
 * connection state and credentials are never persisted in a page layout/cache. */
export class NativePasswordConnectionController {
  private snapshot: ConnectionSnapshot = { connection: 'checking', busy: true, notice: '' };
  private listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private mutating = false;
  private ownerId: string;
  private provider: Provider;
  constructor(ownerId: string, provider: Provider) { this.ownerId = ownerId; this.provider = provider; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: ConnectionSnapshot) { this.snapshot = value; this.listeners.forEach(listener => listener()); }
  dispose() { this.disposed = true; this.generation++; }
  start() { this.disposed = false; void this.refresh(); }
  async refresh() {
    if (this.disposed || this.mutating) return;
    const generation = ++this.generation;
    this.publish({ ...this.snapshot, busy: true });
    let connection: Connection = 'unavailable';
    try {
      const result = await this.provider('status', this.ownerId);
      if (result.ok && ['connected', 'disconnected', 'differentSession', 'unavailable'].includes(result.connection || '')) connection = result.connection!;
    } catch { /* A failed read must never imply a disconnected device. */ }
    if (!this.disposed && generation === this.generation) this.publish({ ...this.snapshot, connection, busy: false });
  }
  async activate() {
    if (this.disposed || this.snapshot.busy) return;
    if (this.snapshot.connection === 'unavailable' || this.snapshot.connection === 'checking') { await this.refresh(); return; }
    const action = this.snapshot.connection === 'connected' ? 'disconnect' : 'connect';
    this.mutating = true; this.generation++;
    this.publish({ ...this.snapshot, busy: true, notice: '' });
    let notice = '';
    try {
      const result = await this.provider(action, this.ownerId);
      notice = result.ok ? action === 'disconnect' ? 'Password AutoFill disconnected.' : 'Password AutoFill connected. Enable Thingtime in your device’s AutoFill & Passwords settings.' : 'Password AutoFill could not be updated. Try again.';
    } catch { notice = 'Password AutoFill could not be updated. Check your sign-in and native provider, then try again.'; }
    this.mutating = false;
    if (!this.disposed) { this.publish({ ...this.snapshot, notice }); await this.refresh(); }
  }
}

export function nativeConnectionPresentation(snapshot: ConnectionSnapshot, supported = true) {
  const connected = snapshot.connection === 'connected';
  return {
    label: !supported ? 'Update Thingtime to check AutoFill' : snapshot.connection === 'checking' ? 'Checking AutoFill connection…' : snapshot.connection === 'unavailable' ? 'Retry AutoFill status' : connected ? 'Disconnect AutoFill' : 'Connect Password AutoFill',
    disabled: snapshot.busy || !supported,
    status: !supported ? 'This app version cannot read the device’s AutoFill connection. Update Thingtime to manage it.' : connected ? 'This account is connected on this device. System AutoFill must also be enabled in device settings.' : snapshot.connection === 'disconnected' ? 'Password AutoFill is disconnected on this device.' : snapshot.connection === 'differentSession' ? 'This account is not connected on this device. Connect to replace the previous account connection.' : snapshot.connection === 'unavailable' ? 'The device’s connection could not be checked. Retry when the native provider is available.' : 'Checking this device’s Password AutoFill connection.',
  };
}
