import { canonicalIgnoreRules } from './syncIgnore';
import type { ThingtimeSchema } from '../schemas/registry';
import { validSyncPath, syncPathKey, type SyncMode } from './reconcile';

export const FILE_SYNC_KIND = 'file-sync';
export const FILE_SYNC_REQUIREMENTS = { 'api.things': '1.36.0' } as const;
export const FILE_SYNC_IGNORE_REQUIREMENTS = { 'api.things': '1.38.0' } as const;
export const FILE_SYNC_RESOURCE_REQUIREMENTS = { 'api.things': '1.39.0', 'api.file-sync-batches': '1.2.0' } as const;
export const FILE_SYNC_RESOURCE_KEYS = ['uploadBytesPerSecond', 'downloadBytesPerSecond', 'transferConcurrency', 'indexingConcurrency', 'cpuPercent'] as const;
export type FileSyncResourceLimits = Partial<Record<typeof FILE_SYNC_RESOURCE_KEYS[number], number>>;
/** Closed, finite ceilings. Missing values preserve existing worker defaults. */
export function parseFileSyncResourceLimits(value: unknown): FileSyncResourceLimits | undefined {
 if (value === undefined) return undefined;
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !FILE_SYNC_RESOURCE_KEYS.includes(key as any))) throw Error('Invalid sync resource limits.');
 const result: FileSyncResourceLimits = {};
 for (const key of FILE_SYNC_RESOURCE_KEYS) {
  const n = (value as Record<string, unknown>)[key];
  if (n === undefined) continue;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || ((key === 'transferConcurrency' || key === 'indexingConcurrency') && !Number.isSafeInteger(n)) || (key === 'cpuPercent' && (!Number.isInteger(n) || n < 1 || n > 100))) throw Error('Invalid sync resource limit: ' + key);
  result[key] = n;
 }
 return Object.keys(result).length ? result : undefined;
}
/** Appended only for configuration3; legacy canonical bytes remain identical. */
export const canonicalResourceLimitFields = (value: FileSyncResourceLimits) => FILE_SYNC_RESOURCE_KEYS.map(key => {
 const n = value[key]; if (n === undefined) return '';
 const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, n);
 return view.getBigUint64(0).toString(16).padStart(16, '0');
});
export const FILE_SYNC_UPLOAD_POLICY_REQUIREMENTS = { 'api.things': '1.64.0', 'api.things-update': '1.28.0', 'api.file-sync-transfer-admissions': '1.6.0' } as const;
export type UploadPolicy = { uploadBytesPerSecond?: number; uploadBytesPerHour?: number };
export function parseUploadPolicy(value: unknown): UploadPolicy | undefined {
 if (value === undefined) return undefined;
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['uploadBytesPerSecond', 'uploadBytesPerHour'].includes(key))) throw Error('Invalid upload policy.');
 const result: UploadPolicy = {};
 for (const key of ['uploadBytesPerSecond', 'uploadBytesPerHour'] as const) {
  const n = (value as UploadPolicy)[key];
  if (n !== undefined) { if (!Number.isSafeInteger(n) || n <= 0) throw Error('Upload limits must be positive whole bytes.'); result[key] = n; }
 }
 return result;
}
export const FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS = { 'api.things': '1.53.0', 'api.things-update': '1.21.0' } as const;
export const PHOTO_AUTOMATION_INTERVAL_MS = 300_000;
export const DEFAULT_PHOTO_AUTOMATION = { notificationIntervalMs: 1_800_000, uploadBytesPerSecond: 625_000 } as const;
export type PhotoAutomation = { notificationIntervalMs: number; uploadBytesPerSecond?: number; uploadBytesPerHour?: number };
export function parsePhotoAutomation(value: unknown): PhotoAutomation | undefined {
 if (value === undefined) return undefined;
 if (!value || typeof value !== 'object' || Array.isArray(value) ||
  Object.keys(value).some(key => !['notificationIntervalMs', 'uploadBytesPerSecond', 'uploadBytesPerHour'].includes(key)))
  throw Error('Invalid Photos automation settings.');
 const { notificationIntervalMs, uploadBytesPerSecond, uploadBytesPerHour } = value as PhotoAutomation;
 if (!Number.isSafeInteger(notificationIntervalMs) || notificationIntervalMs < 0 || notificationIntervalMs % 60_000 !== 0)
  throw Error('Choose a whole-minute Photos notification interval, or turn it off.');
 for (const limit of [uploadBytesPerSecond, uploadBytesPerHour])
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw Error('Photos transfer limits must be positive whole bytes.');
 return { notificationIntervalMs, ...(uploadBytesPerSecond === undefined ? {} : { uploadBytesPerSecond }),
  ...(uploadBytesPerHour === undefined ? {} : { uploadBytesPerHour }) };
}
export const MAX_SYNC_EXCLUSIONS = 100;
export type FileSyncConfiguration = {
 configurationVersion: 1 | 2 | 3 | 4 | 5;
 uploadPolicy?: UploadPolicy;
 photoAutomation?: PhotoAutomation;
 resourceLimits?: FileSyncResourceLimits;
 name: string;
 deviceId: string;
 localRootId: string;
 sourceKind?: 'folder' | 'photos';
 remoteFolderId: string;
 mode: SyncMode;
 paused: boolean;
 propagateDeletes: boolean;
 network: 'wifi' | 'any';
 chargingOnly: boolean;
 excludedPaths: string[];
 ignoreRules?: string;
};
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);

/** Configuration is ordinary editable data, never a native grant or execution
 * receipt. Workers must separately authorize the current owner, device, roots,
 * origin and data plane, and obtain device-local approval of the exact policy. */
export function parseFileSyncConfiguration(value: unknown): FileSyncConfiguration {
 const c = value as FileSyncConfiguration;
 if (!c || (c.configurationVersion !== 1 && c.configurationVersion !== 2 && c.configurationVersion !== 3 && c.configurationVersion !== 4 && c.configurationVersion !== 5)) throw Error('Unsupported file sync configuration version.');
 const uploadPolicy = parseUploadPolicy(c.uploadPolicy);
 if ((c.configurationVersion === 5) !== !!uploadPolicy || (uploadPolicy && (c.sourceKind === 'photos' || c.mode !== 'backup' || c.propagateDeletes || c.resourceLimits || c.ignoreRules))) throw Error('Version 5 upload policy requires folder backup with retained destination files and no unsupported resource or ignore settings.');
 const resourceLimits = parseFileSyncResourceLimits(c.resourceLimits);
 const photoAutomation = parsePhotoAutomation(c.photoAutomation);
 if ((c.configurationVersion === 4) !== !!photoAutomation || (photoAutomation && c.sourceKind !== 'photos'))
  throw Error('Version 4 requires Photos automation settings on a photo library backup.');
 if (resourceLimits && c.configurationVersion < 3) throw Error('Resource limits require file sync configuration version 3 or later.');
 if (c.configurationVersion === 3 && !resourceLimits) throw Error('Version 3 requires nonempty resource limits.');
 const ignoreRules = canonicalIgnoreRules(c.ignoreRules);
 if (ignoreRules && c.configurationVersion === 1) throw Error('Ignore rules require file sync configuration version 2.');
 if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(c.name)) throw Error('Sync name must contain 1–120 visible characters.');
 if (!id(c.deviceId) || !id(c.localRootId) || !id(c.remoteFolderId)) throw Error('Sync requires a device, a granted local root and a cloud folder.');
 if (c.sourceKind !== undefined && !['folder', 'photos'].includes(c.sourceKind)) throw Error('Invalid sync source kind.');
 if (c.sourceKind === 'photos' && (c.mode !== 'backup' || c.propagateDeletes)) throw Error('Photo libraries require backup mode with saved cloud copies retained.');
 if (!['two-way', 'upload', 'download', 'backup'].includes(c.mode)) throw Error('Invalid sync direction.');
 if (typeof c.paused !== 'boolean' || typeof c.propagateDeletes !== 'boolean' || typeof c.chargingOnly !== 'boolean') throw Error('Sync pause, deletion and charging choices must be explicit booleans.');
 if (c.mode === 'backup' && c.propagateDeletes) throw Error('Backup always retains destination files after source deletion.');
 if (!['wifi', 'any'].includes(c.network)) throw Error('Choose Wi-Fi or any network for sync.');
 if (!Array.isArray(c.excludedPaths) || c.excludedPaths.length > MAX_SYNC_EXCLUSIONS || c.excludedPaths.some(path => !validSyncPath(path))) throw Error('Sync exclusions must be at most 100 relative file or folder paths.');
 if (c.excludedPaths.reduce((n, path) => n + new TextEncoder().encode(path).length, 0) > 16_384) throw Error('Sync exclusions exceed 16 KiB.');
 const keys = c.excludedPaths.map(syncPathKey);
 if (new Set(keys).size !== keys.length) throw Error('Sync exclusions contain duplicate or ambiguous paths.');
 return { configurationVersion: uploadPolicy ? 5 : photoAutomation ? 4 : resourceLimits ? 3 : ignoreRules ? 2 : 1, name: c.name.trim(), deviceId: c.deviceId, localRootId: c.localRootId, remoteFolderId: c.remoteFolderId,
  ...(c.sourceKind !== undefined ? { sourceKind: c.sourceKind } : {}), mode: c.mode, paused: c.paused, propagateDeletes: c.propagateDeletes, network: c.network, chargingOnly: c.chargingOnly, excludedPaths: [...c.excludedPaths], ...(ignoreRules ? { ignoreRules } : {}), ...(resourceLimits ? { resourceLimits } : {}), ...(photoAutomation ? { photoAutomation } : {}), ...(uploadPolicy ? { uploadPolicy } : {}) };
}

export function newFileSyncConfiguration(input: Pick<FileSyncConfiguration, 'name' | 'deviceId' | 'localRootId' | 'remoteFolderId'> & Pick<Partial<FileSyncConfiguration>, 'sourceKind'>): FileSyncConfiguration {
 return parseFileSyncConfiguration({ ...input, configurationVersion: 1, mode: input.sourceKind === 'photos' ? 'backup' : 'two-way', paused: true, propagateDeletes: false,
  network: 'wifi', chargingOnly: false, excludedPaths: [] });
}

export const fileSyncSchema: ThingtimeSchema = {
 id: FILE_SYNC_KIND, version: 6, kind: 'crystal', collection: null, title: 'File sync',
 summary: 'An editable connection between a selected device folder and a cloud folder.',
 detail: 'One ordinary Thing per connection, private by default. Native paths, bookmarks, tree URIs and credentials stay on the device. Workers require current ownership, private audience, matching device-local approval and fresh folder authorization. Enabled iOS Photos connections can run automatically after these checks. Direction, exclusions and network/power choices apply before planning; confirmed transfer history stays in Timeline. Defaults are paused, Wi-Fi and no deletion propagation; folders default to two-way and photo libraries to backup.',
 fields: [
  { name: 'configurationVersion', type: 'number', required: true, min: 1, max: 5, description: 'Version 5 adds folder backup upload policy. Configuration format version. Version 2 describes ignore rules, version 3 adds resource limits, and version 4 adds Photos automation. Older clients must refuse unsupported policy versions.' },
  { name: 'name', type: 'string', required: true, max: 120, description: 'Display name.' },
  { name: 'deviceId', type: 'id', required: true, max: 200, description: 'Paired device identity; never a credential.' },
  { name: 'localRootId', type: 'id', required: true, max: 200, description: 'Opaque device-local selected-folder grant identity; never a path or URI.' },
  { name: 'remoteFolderId', type: 'id', required: true, max: 200, description: 'Cloud folder Thing identity, reauthorized by the worker.' },
  { name: 'sourceKind', type: 'enum', required: false, values: ['folder', 'photos'], description: 'Optional source intent. Photos require backup mode without deletion propagation. The native source remains the authority.' },
  { name: 'mode', type: 'enum', required: true, values: ['two-way', 'upload', 'download', 'backup'], description: 'Two-way, device to cloud, cloud to device, or backup retaining destination deletions.' },
  { name: 'paused', type: 'boolean', required: true, description: 'Pause new work; in-flight results still need reconciliation.' },
  { name: 'propagateDeletes', type: 'boolean', required: true, description: 'Explicitly propagate confirmed deletions to recoverable Trash. Backup requires false.' },
  { name: 'network', type: 'enum', required: true, values: ['wifi', 'any'], description: 'Allowed native network connection. Unknown connectivity waits.' },
  { name: 'chargingOnly', type: 'boolean', required: true, description: 'Wait unless the native power reading confirms charging.' },
  { name: 'excludedPaths', type: 'string[]', required: true, max: MAX_SYNC_EXCLUSIONS, description: 'Relative exact paths and entire descendant subtrees to skip, case/Unicode folded. No glob syntax. At most 16 KiB in total.' },
  { name: 'resourceLimits', type: 'object', required: false, description: 'Optional closed positive ceilings: uploadBytesPerSecond, downloadBytesPerSecond, transferConcurrency, indexingConcurrency, cpuPercent (1–100 of total available CPU capacity attributable to this sync). Unset values preserve worker defaults. Requires configurationVersion 3 or later.', children: [
   { name: 'uploadBytesPerSecond', type: 'number', required: false, description: 'Positive aggregate upload bytes per second for this connection.' },
   { name: 'downloadBytesPerSecond', type: 'number', required: false, description: 'Positive aggregate download bytes per second for this connection.' },
   { name: 'transferConcurrency', type: 'number', required: false, min: 1, description: 'Positive safe integer maximum simultaneous file/folder transfers.' },
   { name: 'indexingConcurrency', type: 'number', required: false, min: 1, description: 'Positive safe integer maximum simultaneous indexing workers.' },
   { name: 'cpuPercent', type: 'number', required: false, min: 1, max: 100, description: 'Whole percent of total available CPU capacity attributed to this sync.' }
  ] },
  { name: 'uploadPolicy', type: 'object', required: false, description: 'Version 5 folder backup upload limits. Native upload-policy support is required; no download, CPU or scan enforcement is implied.', children: [
   { name: 'uploadBytesPerSecond', type: 'number', required: false, min: 1, description: 'Aggregate upload bytes per second for this configuration; omitted inherits device/folder limits.' },
   { name: 'uploadBytesPerHour', type: 'number', required: false, min: 1, description: 'Rolling hourly payload allowance, including failed and uncertain transmissions.' }
  ] },
  { name: 'photoAutomation', type: 'object', required: false, description: 'iOS Photos backup controls for configurationVersion 4.', children: [
   { name: 'notificationIntervalMs', type: 'number', required: true, min: 0, description: 'Desired interval in whole minutes expressed in milliseconds. Zero disables progress notifications. Background timing is controlled by iOS.' },
   { name: 'uploadBytesPerSecond', type: 'number', required: false, min: 1, description: 'Upload rate in bytes per second. The iOS Photos default is 625000 bytes per second.' },
   { name: 'uploadBytesPerHour', type: 'number', required: false, min: 1, description: 'Optional upload payload allowance over the last hour. Omitted means no hourly allowance restriction.' }
  ] },
  { name: 'ignoreRules', type: 'string', required: false, description: 'Optional case-sensitive root-relative Gitignore rules, subject to the selected native bridge request budget. Ordered negation cannot reinclude children of an ignored parent. No nested .gitignore reads. Empty text is omitted.' }
 ],
 example: { configurationVersion: 1, name: 'Documents', deviceId: 'device-id', localRootId: 'local-root-id', remoteFolderId: 'folder-id', mode: 'two-way', paused: true, propagateDeletes: false, network: 'wifi', chargingOnly: false, excludedPaths: [] }
};
