import { requestMobileDevice, supportsMobileDevice } from '../Devices/mobileDeviceBridge';
import { getNativeBridge, nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '../../utils/nativeBridge';
import type { ThingStoragePolicyResponse } from '../../utils/thingStoragePolicy';
import type { StoragePolicyScope } from './thingStorageClient';

type FileReplicaBridge = ThingtimeNativeBridge & { fileReplicaVersion?: string };
export type ThingReplicaAction = 'status' | 'keep' | 'evict';
export type ThingReplicaState = {
  state: 'missing' | 'present' | 'saved' | 'evicted' | 'error';
  jsonBytes?: number;
  fileBytes?: number;
  sourceHash?: string;
  sourceRevision?: string;
  pendingChanges?: boolean;
  retainedOriginal?: boolean;
  nativeFilePresent?: boolean;
  detail?: string;
};

export const isNativeFileStorage = (kind: string | undefined): boolean =>
  kind === 'file' && getNativeBridge()?.platform === 'ios';

const getFileReplicaBridge = () => {
  const bridge: FileReplicaBridge | undefined = getNativeBridge();
  return supportsMobileDevice(bridge) && /^1\.\d+\.\d+$/.test(bridge?.fileReplicaVersion ?? '') ? bridge : undefined;
};

export async function readNativeStorageDevice(ownerId: string, signal: AbortSignal): Promise<string> {
  if (!getFileReplicaBridge()) throw new Error('Update the Thingtime iPhone app to manage a copy of this file.');
  const result = await requestMobileDevice(ownerId, 'status', AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
    .catch(() => { signal.throwIfAborted(); throw new Error('Could not verify this iPhone. Refresh to try again.'); });
  if (result.state !== 'paired' || !result.deviceId) throw new Error('Pair this iPhone in Settings to manage a local file copy.');
  return result.deviceId;
}

export function requestNativeThingReplica(
  action: ThingReplicaAction | 'open',
  scope: StoragePolicyScope,
  snapshot: ThingStoragePolicyResponse,
  signal: AbortSignal,
): Promise<ThingReplicaState> {
  const bridge = getFileReplicaBridge();
  const device = snapshot.device;
  if (!bridge || device?.kind !== 'paired' || window.location.origin !== scope.origin) {
    return Promise.reject(new Error('This iPhone cannot manage the local file copy.'));
  }
  const identity = {
    requestId: crypto.randomUUID(), ownerId: scope.ownerId, origin: scope.origin, dataPlane: scope.dataPlane,
    thingId: snapshot.source.id, deviceId: device.id,
  };
  const lifetime = signal;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener(nativeBridgeMessageEvent, receive);
      lifetime.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      if (window.location.origin === scope.origin && getNativeBridge() === bridge) {
        try { bridge.postMessage({ type: 'file-replica', payload: { ...identity, action: 'cancel' } }); } catch { /* Native scope is independently fenced. */ }
      }
      reject(lifetime.reason);
    };
    const receive = (event: Event) => {
      const message = (event as CustomEvent).detail;
      const reply = message?.payload;
      if (message?.type !== 'file-replica-result' || !reply ||
        Object.entries(identity).some(([key, value]) => reply[key] !== value) ||
        window.location.origin !== scope.origin || getNativeBridge() !== bridge) return;
      cleanup();
      if (!['missing', 'present', 'saved', 'evicted', 'error', 'opened'].includes(reply.state) || (reply.state === 'opened' && action !== 'open')) {
        reject(new Error('Invalid local copy status.'));
        return;
      }
      resolve({
        state: reply.state === 'opened' ? 'present' : reply.state,
        nativeFilePresent: ['present', 'saved', 'opened'].includes(reply.state),
        ...(Number.isSafeInteger(reply.bytes) && reply.bytes >= 0 ? { fileBytes: reply.bytes } : {}),
        ...(typeof reply.fileRevision === 'string' ? { sourceRevision: reply.fileRevision } : {}),
        ...(reply.retainedOriginal === true ? { retainedOriginal: true } : {}),
        ...(reply.state === 'error' ? { detail: 'The iPhone could not finish managing this file copy.' } : {}),
      });
    };
    if (lifetime.aborted) { reject(lifetime.reason); return; }
    window.addEventListener(nativeBridgeMessageEvent, receive);
    lifetime.addEventListener('abort', abort, { once: true });
    try {
      bridge.postMessage({
        type: 'file-replica', payload: {
          ...identity, action,
          sourceRevision: snapshot.source.revision,
          policyRevision: snapshot.policy.revision,
          deviceRevision: device.revision,
        },
      });
    } catch (error) { cleanup(); reject(error); }
  });
}
