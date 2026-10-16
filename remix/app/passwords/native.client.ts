import { getNativeBridge } from '~/utils/nativeBridge';
export function hasNativePasswordProvider() {
  if (typeof window === 'undefined') return false;
  return (window as any).thingtimeDesktop?.passwordsVersion === '1.0.0' || (getNativeBridge() as any)?.passwordsVersion === '1.0.0';
}
export async function nativePasswordProvider(action: 'connect' | 'sync' | 'disconnect', ownerId?: string): Promise<{ ok: boolean; message: string }> {
  if (!hasNativePasswordProvider()) throw new Error('Use the native Thingtime app for system Password AutoFill.');
  const desktop = (window as any).thingtimeDesktop;
  if (desktop?.passwordsVersion === '1.0.0') return desktop.passwordProvider({ action, ownerId });
  const bridge = getNativeBridge()!, requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); window.removeEventListener('thingtime:native-message', listener); };
    const listener = (event: Event) => { const message = (event as CustomEvent).detail; if (message?.type !== 'password-provider-result' || message.payload?.requestId !== requestId) return; finish(); if (message.payload.ok) resolve(message.payload); else reject(new Error(message.payload.message || 'Could not connect Password AutoFill.')); };
    const timer = setTimeout(() => { finish(); reject(new Error('Password AutoFill connection timed out.')); }, 60000);
    window.addEventListener('thingtime:native-message', listener);
    bridge.postMessage({ type: 'password-provider', payload: { action, ownerId, requestId } });
  });
}
