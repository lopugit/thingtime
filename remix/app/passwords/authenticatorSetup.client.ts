import { parseTotp } from './totp';
export type AuthenticatorSetupBridge = { version: string; postMessage: (message: Record<string, string>) => void };
export type SetupNotice = { requestId: string };
export const authenticatorSetupEvent = 'thingtime:authenticator-setup';
export const authenticatorSetupReadyEvent = 'thingtime:authenticator-setup-ready';
export const supportsAuthenticatorSetup = (bridge?: AuthenticatorSetupBridge): bridge is AuthenticatorSetupBridge => Boolean(bridge && /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(bridge.version));

/** A single authenticated editor/document. No storage, generic Actions, history,
 * location query or clipboard path ever receives the setup URI. */
export class AuthenticatorSetupSession {
  private readonly nonce: string;
  private available: string | null = null;
  private retired = new Set<string>();
  private waiting: { id: string; resolve: (setup: string) => void; reject: (reason?: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private alive = true;
  constructor(private readonly options: {
    ownerId: string; dataPlane: string | null; bridge: AuthenticatorSetupBridge; events: EventTarget;
    current: () => boolean; onNotice: (notice: SetupNotice | null) => void; onError: () => void; onStatus?: (message: string) => void; nonce?: string;
  }) {
    this.nonce = options.nonce || crypto.randomUUID();
    options.events.addEventListener(authenticatorSetupEvent, this.receive);
    options.events.addEventListener(authenticatorSetupReadyEvent, this.ready);
    this.ready();
  }
  private send(operation: string, extra: Record<string, string> = {}) {
    if (this.alive && this.options.current() && this.options.dataPlane === 'home' && supportsAuthenticatorSetup(this.options.bridge)) {
      this.options.bridge.postMessage({ version: '1.0.0', operation, nonce: this.nonce, ownerId: this.options.ownerId, dataPlane: 'home', ...extra });
    }
  }
  private ready = () => this.send('ready');
  private fail(reason?: Error) {
    if (this.waiting) { const pending = this.waiting; this.waiting = null; clearTimeout(pending.timer); pending.reject(reason); }
  }
  private receive = (event: Event) => {
    if (!this.alive || !this.options.current() || this.options.dataPlane !== 'home' || !supportsAuthenticatorSetup(this.options.bridge)) return;
    const detail = (event as CustomEvent).detail;
    if (!detail || detail.nonce !== this.nonce || detail.ownerId !== this.options.ownerId) return;
    if (detail.kind === 'available' && typeof detail.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(detail.requestId)) {
      // Repeated ready/availability notifications cannot overwrite a draft or
      // replace an in-flight user choice.
      if (!this.available && !this.waiting && !this.retired.has(detail.requestId)) { this.available = detail.requestId; this.options.onNotice({ requestId: detail.requestId }); }
    } else if (detail.kind === 'setup' && this.waiting?.id === detail.requestId && typeof detail.setup === 'string') {
      const pending = this.waiting; this.waiting = null; clearTimeout(pending.timer); this.available = null; this.retired.add(pending.id); this.options.onNotice(null);
      try { if (!/^otpauth:\/\/totp\//.test(detail.setup)) throw new Error('Unsupported setup'); parseTotp(detail.setup); pending.resolve(detail.setup); }
      catch { pending.reject(); this.options.onError(); }
    } else if (detail.kind === 'status' && typeof detail.message === 'string') { this.options.onStatus?.(detail.message);
    } else if (detail.kind === 'expired' || detail.kind === 'unavailable') {
      const scoped = typeof detail.requestId === 'string';
      if (scoped && detail.requestId !== this.available && detail.requestId !== this.waiting?.id) return;
      if (scoped) { this.retired.add(detail.requestId); this.available = null; this.options.onNotice(null); }
      if (detail.kind === 'expired') { this.fail(new DOMException('Setup expired', 'AbortError')); this.options.onStatus?.('The pending setup expired. Open the setup code again.'); }
      else { this.fail(); this.options.onError(); }
    }
  };
  consume(id: string): Promise<string> {
    if (!this.alive || !this.options.current() || id !== this.available || this.waiting) return Promise.reject(new Error('Authenticator setup is unavailable.'));
    return new Promise((resolve, reject) => {
      const fail = (reason?: Error) => reject(reason || new Error('Authenticator setup is unavailable. Retry or reopen the setup code.'));
      this.waiting = { id, resolve, reject: fail, timer: setTimeout(() => { this.fail(); this.options.onError(); }, 30000) };
      this.send('consume', { requestId: id });
    });
  }
  retry() { this.ready(); }
  cancel() {
    this.send('cancel'); if (this.available) this.retired.add(this.available); this.available = null; this.fail(new DOMException('Setup cancelled', 'AbortError')); this.options.onNotice(null);
  }
  dispose() {
    if (!this.alive) return;
    this.cancel(); this.alive = false;
    this.options.events.removeEventListener(authenticatorSetupEvent, this.receive);
    this.options.events.removeEventListener(authenticatorSetupReadyEvent, this.ready);
  }
}
