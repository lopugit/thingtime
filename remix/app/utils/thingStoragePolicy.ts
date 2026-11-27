export const THING_STORAGE_POLICY_PATH = '/api/v1/things/storage-policy';
export const THING_STORAGE_POLICY_REQUIREMENTS = { 'api.things-storage-policy': '1.0.0' } as const;
export const THING_STORAGE_CLOUD_WRITE_REQUIREMENTS = { 'api.things': '1.55.0' } as const;
export const THING_STORAGE_POLICY_KIND = 'thing-storage-policy';
export const THING_DEVICE_STORAGE_POLICY_KIND = 'thing-device-storage-policy';
export const THING_STORAGE_POLICY_INDEX_KIND = 'thing-storage-policy-index';
export const AUTOMATIC_STORAGE_PLACEMENT_EXCLUDED = 'automatic_storage_placement_excluded';

/** The operation has no known live effect. Preserve original evidence on other errors. */
export class AutomaticStoragePlacementExcluded extends Error {
  constructor(message = 'This Thing’s storage policy excludes the automatic transfer.') { super(message); }
}


export type DefaultLocalAvailability = 'inherit' | 'on-demand' | 'keep';
export type DeviceLocalAvailability = 'inherit' | 'keep' | 'cloud-only';
export type ThingStoragePolicy = {
  revision: string | null;
  cloudSync: boolean;
  defaultLocalAvailability: DefaultLocalAvailability;
  automaticDownloadDeviceId: string | null;
};
export type ThingStorageDevice = { id: string; kind: 'paired' | 'browser' };
export type ThingDeviceStoragePolicy = ThingStorageDevice & {
  revision: string | null;
  localAvailability: DeviceLocalAvailability;
};
export type ThingStorageSource = { id: string; revision: string; sourceHash: string };
export type ThingStoragePolicyResponse = {
  ok: true;
  source: ThingStorageSource;
  policy: ThingStoragePolicy;
  device: ThingDeviceStoragePolicy | null;
  canEdit: boolean;
};
export type RegisterStorageBrowser = { action: 'register-browser' };
export type RegisterStorageBrowserResponse = { ok: true; installation: ThingStorageDevice & { kind: 'browser' } };
export type UpdateThingStoragePolicy = {
  id: string;
  expectedSourceRevision: string;
  expectedPolicyRevision: string | null;
  deviceId?: string;
  expectedDeviceRevision?: string | null;
  policy?: Partial<Omit<ThingStoragePolicy, 'revision'>>;
  localAvailability?: DeviceLocalAvailability;
};
export const DEFAULT_THING_STORAGE_POLICY: Readonly<ThingStoragePolicy> = {
  revision: null,
  cloudSync: true,
  defaultLocalAvailability: 'inherit',
  automaticDownloadDeviceId: null,
};

export type ThingStorageAttachment = { id: string } & (
  | { version: string; size: number; fingerprint: import('../fileSync/contentFingerprint').ContentFingerprint }
  | { version: null; size: null; fingerprint: null }
);
export type ThingStorageAttachmentPage = {
  ok: true;
  source: ThingStorageSource;
  attachments: { items: ThingStorageAttachment[]; nextCursor: string | null };
};

export type AutomaticThingStorageRule = {
  id: string;
  cloudSync: boolean;
  defaultLocalAvailability: DefaultLocalAvailability;
  automaticDownloadDeviceId: string | null;
  localAvailability: DeviceLocalAvailability;
};
export type AutomaticThingStoragePolicyPage = {
  ok: true;
  revision: string | null;
  unchanged?: true;
  rules: AutomaticThingStorageRule[];
  nextCursor: string | null;
};
