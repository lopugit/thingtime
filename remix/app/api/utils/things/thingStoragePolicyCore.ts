import type { UpdateThingStoragePolicy } from '../../../utils/thingStoragePolicy';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).every(key => fields.includes(key));
export const isStorageDeviceId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
export const isStorageBrowserId = (value: unknown): value is string => typeof value === 'string' && /^storage-browser-[a-f0-9]{32}$/.test(value);
export const isStoragePolicyRevision = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^[a-f0-9]{32}$/.test(value));

export function parseStoragePolicyUpdate(value: unknown): UpdateThingStoragePolicy | null {
  if (!record(value) || !keysAre(value, ['id', 'expectedSourceRevision', 'expectedPolicyRevision', 'deviceId', 'expectedDeviceRevision', 'policy', 'localAvailability']) ||
      !isStorageDeviceId(value.id) || !isStorageDeviceId(value.expectedSourceRevision) || !isStoragePolicyRevision(value.expectedPolicyRevision) ||
      (value.deviceId !== undefined && !isStorageDeviceId(value.deviceId)) ||
      (value.expectedDeviceRevision !== undefined && !isStoragePolicyRevision(value.expectedDeviceRevision))) return null;
  if (value.localAvailability !== undefined && (!['inherit', 'keep', 'cloud-only'].includes(value.localAvailability as string) ||
      value.expectedDeviceRevision === undefined)) return null;
  if (value.policy !== undefined) {
    if (!record(value.policy) || !Object.keys(value.policy).length || !keysAre(value.policy, ['cloudSync', 'defaultLocalAvailability', 'automaticDownloadDeviceId'])) return null;
    const { cloudSync, defaultLocalAvailability, automaticDownloadDeviceId } = value.policy;
    if ((cloudSync !== undefined && typeof cloudSync !== 'boolean') ||
        (defaultLocalAvailability !== undefined && !['inherit', 'on-demand', 'keep'].includes(defaultLocalAvailability as string)) ||
        (automaticDownloadDeviceId !== undefined && automaticDownloadDeviceId !== null && !isStorageDeviceId(automaticDownloadDeviceId))) return null;
  } else if (value.localAvailability === undefined) return null;
  return value as UpdateThingStoragePolicy;
}
