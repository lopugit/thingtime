import { getNativeBridge } from '~/utils/nativeBridge';
import { normalizeNativePasswordResult, supportsNativePasswordProviderVersion, type NativePasswordResult } from './nativeConnectionStatus';
export function hasNativePasswordProvider() {
  if (typeof window === 'undefined') return false;
  return supportsNativePasswordProviderVersion((window as any).thingtimeDesktop?.passwordsVersion) || supportsNativePasswordProviderVersion((getNativeBridge() as any)?.passwordsVersion);
}
export async function nativePasswordProvider(action: 'connect' | 'sync' | 'disconnect', ownerId?: string): Promise<NativePasswordResult> {
  if (!hasNativePasswordProvider()) throw new Error('Use the native Thingtime app for system Password AutoFill.');
  if (action === 'status' && !hasNativePasswordStatus()) return { ok: true, connection: 'unavailable' };
  const desktop = (window as any).thingtimeDesktop;
  if (supportsNativePasswordProviderVersion(desktop?.passwordsVersion)) {
    const result = normalizeNativePasswordResult(await desktop.passwordProvider({ action, ownerId }));
    if (!result.ok) throw new Error(result.message);
    return result;
  }
  const bridge = getNativeBridge()!, requestId = crypto.randomUUID();
  return new Promise<NativePasswordResult>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); window.removeEventListener('thingtime:native-message', listener); };
    const listener = (event: Event) => { const message = (event as CustomEvent).detail; if (message?.type !== 'password-provider-result' || message.payload?.requestId !== requestId) return; finish(); const result = normalizeNativePasswordResult(message.payload); if (result.ok) resolve(result); else reject(new Error(result.message)); };
    const timer = setTimeout(() => { finish(); reject(new Error('Password AutoFill connection timed out.')); }, 60000);
    window.addEventListener('thingtime:native-message', listener);
    bridge.postMessage({ type: 'password-provider', payload: { action, ownerId, requestId } });
  }).then(changed);
}
