import { getNativeBridge } from '~/utils/nativeBridge';
export type NativePasswordConnection = 'connected' | 'disconnected' | 'differentSession' | 'unavailable';
export type NativePasswordResult = { ok: boolean; message?: string; connection?: NativePasswordConnection };
export const nativePasswordConnectionEvent = 'thingtime:password-provider-changed';
const compatible = (version: unknown, minor = 0) => typeof version === 'string' && /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) && Number(version.split('.')[1]) >= minor;
export function hasNativePasswordProvider() {
  if (typeof window === 'undefined') return false;
  return compatible((window as any).thingtimeDesktop?.passwordsVersion) || compatible((getNativeBridge() as any)?.passwordsVersion);
}
export function hasNativePasswordStatus() {
  return typeof window !== 'undefined' && (compatible((window as any).thingtimeDesktop?.passwordsVersion, 1) || compatible((getNativeBridge() as any)?.passwordsVersion, 1));
}
export async function nativePasswordProvider(action: 'connect' | 'sync' | 'disconnect' | 'status', ownerId?: string): Promise<NativePasswordResult> {
  if (!hasNativePasswordProvider()) throw new Error('Use the native Thingtime app for system Password AutoFill.');
  if (action === 'status' && !hasNativePasswordStatus()) return { ok: true, connection: 'unavailable' };
  const desktop = (window as any).thingtimeDesktop;
  const changed = (result: NativePasswordResult) => { if (action !== 'status') window.dispatchEvent(new Event(nativePasswordConnectionEvent)); return result; };
  if (compatible(desktop?.passwordsVersion, action === 'status' ? 1 : 0)) return changed(await desktop.passwordProvider({ action, ownerId }));
  const bridge = getNativeBridge()!, requestId = crypto.randomUUID();
  return new Promise<NativePasswordResult>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); window.removeEventListener('thingtime:native-message', listener); };
    const listener = (event: Event) => { const message = (event as CustomEvent).detail; if (message?.type !== 'password-provider-result' || message.payload?.requestId !== requestId) return; finish(); if (message.payload.ok) resolve(message.payload); else reject(new Error(message.payload.message || 'Could not connect Password AutoFill.')); };
    const timer = setTimeout(() => { finish(); reject(new Error('Password AutoFill connection timed out.')); }, 60000);
    window.addEventListener('thingtime:native-message', listener);
    bridge.postMessage({ type: 'password-provider', payload: { action, ownerId, requestId } });
  }).then(changed);
}
