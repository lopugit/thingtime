import { getNativeBridge } from '../utils/nativeBridge';
import type { createLocalHomeBootstrap, DeviceHomeProof } from './localHomeBootstrap';
type Controller = ReturnType<typeof createLocalHomeBootstrap>;
let controller: Controller | undefined;
export const registerLocalHomeBootstrap = (value: Controller) => { controller = value; };
export const localHomeBootstrapAvailable = () => controller?.available() ?? Promise.resolve(false);
export const initializeLocalHome = async () => {
 if (!controller) throw new Error('Device-only workspace initialization is unavailable.');
 await controller.initialize();
};
/** Correlate the exact host response; no credentials or account metadata cross it. */
export const requestDeviceHomeHost = (action: 'status' | 'initialize', expected?: DeviceHomeProof): Promise<unknown> => new Promise((resolve, reject) => {
 const bridge = getNativeBridge();
 if (!bridge?.isNativeWebView || !bridge.onMessage) { reject(new Error('A compatible native profile is required.')); return; }
 const id = crypto.randomUUID();
 let unsubscribe: (() => void) | undefined;
 const timer = setTimeout(() => { unsubscribe?.(); reject(new Error('The native workspace did not respond. Reopen this device-only action.')); }, 3000);
 unsubscribe = bridge.onMessage(message => {
  if (message.type !== 'local-workspace-result' || !message.payload || typeof message.payload !== 'object') return;
  const value = message.payload as { requestId?: unknown };
  if (value.requestId !== id) return;
  clearTimeout(timer); unsubscribe?.(); resolve(value);
 });
 try { bridge.postMessage({ type: `local-workspace-${action}`, id, ...(expected ? { payload: { expectedVersion: expected.featureVersion, expectedOrigin: expected.origin, expectedDocumentId: expected.documentId } } : {}) }); }
 catch { clearTimeout(timer); unsubscribe?.(); reject(new Error('The native workspace could not be initialized.')); }
});
