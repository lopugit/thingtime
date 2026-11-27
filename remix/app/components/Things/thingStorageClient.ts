import { requireThingtimeCapability } from '../../api/utils/capabilities/requireCapability.client';
import { ThingtimeApiError } from '../../hooks/apiFailure';
import { EXPECTED_DATA_PLANE_HEADER } from '../../utils/dataPlane';
import {
  THING_STORAGE_POLICY_PATH, THING_STORAGE_POLICY_REQUIREMENTS,
  type RegisterStorageBrowserResponse, type ThingStoragePolicyResponse, type UpdateThingStoragePolicy,
} from '../../utils/thingStoragePolicy';

export const storagePlacements = [
  { id: 'sync', label: 'Sync with cloud', description: 'Keep a managed copy on each supported device that opens this Thing.' },
  { id: 'local', label: 'Keep on this device', description: 'Keep a managed copy here and pause managed cloud sync. Any existing cloud copy stays available.' },
  { id: 'cloud', label: 'Cloud only', description: 'Remove the managed copy from this device after Thingtime verifies the current cloud copy.' },
  { id: 'pin', label: 'Cloud and this device', description: 'Keep the cloud copy and a copy here. Other devices can open the Thing on demand.' },
] as const;

export type StoragePlacement = typeof storagePlacements[number]['id'];
export const isStoragePlacement = (value: unknown): value is StoragePlacement => storagePlacements.some(entry => entry.id === value);

export function selectedStoragePlacement(result: ThingStoragePolicyResponse): StoragePlacement | null {
  const { policy, device } = result;
  if (device?.localAvailability === 'cloud-only' && policy.cloudSync) return 'cloud';
  if (device?.localAvailability === 'keep' && !policy.cloudSync) return 'local';
  if (device?.localAvailability === 'keep' && policy.cloudSync && policy.automaticDownloadDeviceId === device.id) return 'pin';
  if (policy.cloudSync && policy.defaultLocalAvailability === 'keep' && !policy.automaticDownloadDeviceId) return 'sync';
  return null;
}

export function storagePlacementCommand(current: ThingStoragePolicyResponse, choice: StoragePlacement): UpdateThingStoragePolicy {
  if (!current.canEdit || !current.device) throw new Error('An authorized device is required to save storage placement.');
  const { source, policy, device } = current;
  const command = {
    id: source.id, expectedSourceRevision: source.revision, expectedPolicyRevision: policy.revision,
    deviceId: device.id, expectedDeviceRevision: device.revision,
  };
  switch (choice) {
    case 'sync':
      return { ...command, policy: { cloudSync: true, defaultLocalAvailability: 'keep', automaticDownloadDeviceId: null }, localAvailability: 'inherit' };
    case 'local':
      return { ...command, policy: { cloudSync: false, automaticDownloadDeviceId: null }, localAvailability: 'keep' };
    case 'cloud':
      return { ...command, policy: { cloudSync: true,
        ...(policy.automaticDownloadDeviceId === device.id ? { automaticDownloadDeviceId: null } : {}),
      }, localAvailability: 'cloud-only' };
    case 'pin':
      return { ...command, policy: { cloudSync: true, defaultLocalAvailability: 'on-demand', automaticDownloadDeviceId: device.id }, localAvailability: 'keep' };
  }
}

export type StoragePolicyScope = {
  origin: string;
  ownerId: string;
  characterId?: string;
  dataPlane: 'home';
};

export class StoragePolicyUnavailable extends Error {}

const safeRevision = (revision: unknown): revision is string => typeof revision === 'string' && revision.length > 0 && revision.length <= 512;
const revisionOrNull = (revision: unknown): revision is string | null => revision === null || safeRevision(revision);
const validDevice = (device: unknown): device is NonNullable<ThingStoragePolicyResponse['device']> => {
  const row = device as NonNullable<ThingStoragePolicyResponse['device']> | null;
  return !!row && safeRevision(row.id) && ['paired', 'browser'].includes(row.kind) &&
    revisionOrNull(row.revision) && ['inherit', 'keep', 'cloud-only'].includes(row.localAvailability);
};

export function parseStoragePolicyResponse(value: unknown, id: string, expectedDevice?: string): ThingStoragePolicyResponse {
  const result = value as Partial<ThingStoragePolicyResponse> | null;
  const { source, policy, device, canEdit } = result ?? {};
  if (result?.ok !== true || typeof canEdit !== 'boolean' || source?.id !== id || !safeRevision(source.revision) ||
    typeof source.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceHash) || !policy ||
    !revisionOrNull(policy.revision) || typeof policy.cloudSync !== 'boolean' ||
    !['inherit', 'on-demand', 'keep'].includes(policy.defaultLocalAvailability) ||
    !revisionOrNull(policy.automaticDownloadDeviceId) || (device !== null && !validDevice(device)) ||
    (expectedDevice && device?.id !== expectedDevice)) {
    throw new Error('Storage policy did not match this Thing and device.');
  }
  return {
    ok: true, canEdit, source: { id, revision: source.revision, sourceHash: source.sourceHash },
    policy: { revision: policy.revision, cloudSync: policy.cloudSync, defaultLocalAvailability: policy.defaultLocalAvailability,
      automaticDownloadDeviceId: policy.automaticDownloadDeviceId },
    device: device ? { id: device.id, kind: device.kind, revision: device.revision, localAvailability: device.localAvailability } : null,
  };
}

export function createThingStorageClient(scope: StoragePolicyScope, options: {
  signal: AbortSignal;
  assertCurrent: () => void;
  onIdentityChange: () => void;
}, transport = { fetch, requireCapability: requireThingtimeCapability }) {
  const { signal, assertCurrent } = options;
  const { fetch: fetchPolicy, requireCapability } = transport;
  const assertActive = () => { signal.throwIfAborted(); assertCurrent(); };
  const request = async (query: URLSearchParams, command?: UpdateThingStoragePolicy | { action: 'register-browser' }) => {
    assertActive();
    try {
      for (const [feature, minimum] of Object.entries(THING_STORAGE_POLICY_REQUIREMENTS)) {
        await requireCapability(feature, minimum, scope.origin);
        assertActive();
      }
    } catch (error) {
      assertActive();
      if (error instanceof ThingtimeApiError && error.status !== 404) throw error;
      throw new StoragePolicyUnavailable('Storage settings are unavailable on this server.');
    }
    const method = command ? 'POST' : 'GET';
    const headers = new Headers({ Accept: 'application/json', 'X-Thingtime-Expected-Actor': scope.ownerId,
      'X-Thingtime-Expected-Api-Origin': scope.origin, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane });
    if (scope.characterId) headers.set('X-Thingtime-Character', scope.characterId);
    if (command) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await fetchPolicy(`${THING_STORAGE_POLICY_PATH}${query.size ? `?${query}` : ''}`, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        ...(command ? { body: JSON.stringify(command) } : {}),
      });
    } catch {
      assertActive();
      throw new ThingtimeApiError('Could not reach Thing storage settings.', { status: null, method });
    }
    assertActive();
    if (response.redirected || response.headers.has('x-thingtime-api-fallback')) throw new Error('The selected API server changed.');
    const body = await response.json().catch(() => null);
    assertActive();
    if (!response.ok) {
      if (response.status === 409 && (body?.code === 'DATA_PLANE_CHANGED' ||
        body?.error === 'The active account changed. Run the action again.')) options.onIdentityChange();
      const reason = response.status === 404 && body?.ok === false && body.error === 'Thing not found' ? 'storage-source-not-found' : undefined;
      throw new ThingtimeApiError('Thing storage request did not complete.', { status: response.status, method, reason });
    }
    return body;
  };
  return {
    async read(id: string, pairedDeviceId?: string) {
      const query = new URLSearchParams({ id });
      if (pairedDeviceId) query.set('deviceId', pairedDeviceId);
      return parseStoragePolicyResponse(await request(query), id, pairedDeviceId);
    },
    async save(command: UpdateThingStoragePolicy) {
      return parseStoragePolicyResponse(await request(new URLSearchParams(), command), command.id, command.deviceId);
    },
    async registerBrowser(): Promise<RegisterStorageBrowserResponse['installation']> {
      const value = await request(new URLSearchParams(), { action: 'register-browser' });
      if (value?.ok !== true || value.installation?.kind !== 'browser' || !safeRevision(value.installation.id)) {
        throw new Error('This browser could not be registered for local storage.');
      }
      return { id: value.installation.id, kind: 'browser' };
    },
  };
}
