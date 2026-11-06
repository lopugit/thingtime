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
export const MAX_SYNC_EXCLUSIONS = 100;
export type FileSyncConfiguration = {
 configurationVersion: 1 | 2 | 3;
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
 if (!c || (c.configurationVersion !== 1 && c.configurationVersion !== 2 && c.configurationVersion !== 3)) throw Error('Unsupported file sync configuration version.');
 const resourceLimits = parseFileSyncResourceLimits(c.resourceLimits);
 if (resourceLimits && c.configurationVersion !== 3) throw Error('Resource limits require file sync configuration version 3.');
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
 return { configurationVersion: resourceLimits ? 3 : ignoreRules ? 2 : 1, name: c.name.trim(), deviceId: c.deviceId, localRootId: c.localRootId, remoteFolderId: c.remoteFolderId,
  ...(c.sourceKind !== undefined ? { sourceKind: c.sourceKind } : {}), mode: c.mode, paused: c.paused, propagateDeletes: c.propagateDeletes, network: c.network, chargingOnly: c.chargingOnly, excludedPaths: [...c.excludedPaths], ...(ignoreRules ? { ignoreRules } : {}), ...(resourceLimits ? { resourceLimits } : {}) };
}

export function newFileSyncConfiguration(input: Pick<FileSyncConfiguration, 'name' | 'deviceId' | 'localRootId' | 'remoteFolderId'> & Pick<Partial<FileSyncConfiguration>, 'sourceKind'>): FileSyncConfiguration {
 return parseFileSyncConfiguration({ ...input, configurationVersion: 1, mode: input.sourceKind === 'photos' ? 'backup' : 'two-way', paused: true, propagateDeletes: false,
  network: 'wifi', chargingOnly: false, excludedPaths: [] });
}

export const fileSyncSchema: ThingtimeSchema = {
 id: FILE_SYNC_KIND, version: 4, kind: 'crystal', collection: null, title: 'File sync',
 summary: 'An editable connection between a selected device folder and a cloud folder.',
 detail: 'One ordinary Thing per connection, private by default. Native paths, bookmarks, tree URIs and credentials stay on the device. This configuration grants no access and does not start transfers by itself. Workers require current ownership, private audience, matching device-local approval and fresh folder authorization. Direction, exclusions and network/power choices apply before planning; confirmed transfer history stays in Timeline. Defaults are paused, Wi-Fi and no deletion propagation; folders default to two-way and photo libraries to backup.',
 fields: [
  { name: 'configurationVersion', type: 'number', required: true, min: 1, max: 3, description: 'Configuration format version. Version 2 requires ignore rules; version 3 requires nonempty resourceLimits. Older clients must refuse unsupported policy versions.' },
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
  { name: 'resourceLimits', type: 'object', required: false, description: 'Optional closed positive ceilings: uploadBytesPerSecond, downloadBytesPerSecond, transferConcurrency, indexingConcurrency, cpuPercent (1–100 of total available CPU capacity attributable to this sync). Unset values preserve worker defaults. Requires configurationVersion 3.', children: [
   { name: 'uploadBytesPerSecond', type: 'number', required: false, description: 'Positive aggregate upload bytes per second for this connection.' },
   { name: 'downloadBytesPerSecond', type: 'number', required: false, description: 'Positive aggregate download bytes per second for this connection.' },
   { name: 'transferConcurrency', type: 'number', required: false, min: 1, description: 'Positive safe integer maximum simultaneous file/folder transfers.' },
   { name: 'indexingConcurrency', type: 'number', required: false, min: 1, description: 'Positive safe integer maximum simultaneous indexing workers.' },
   { name: 'cpuPercent', type: 'number', required: false, min: 1, max: 100, description: 'Whole percent of total available CPU capacity attributed to this sync.' }
  ] },
  { name: 'ignoreRules', type: 'string', required: false, description: 'Optional case-sensitive root-relative Gitignore rules, subject to the selected native bridge request budget. Ordered negation cannot reinclude children of an ignored parent. No nested .gitignore reads. Empty text is omitted.' }
 ],
 example: { configurationVersion: 1, name: 'Documents', deviceId: 'device-id', localRootId: 'local-root-id', remoteFolderId: 'folder-id', mode: 'two-way', paused: true, propagateDeletes: false, network: 'wifi', chargingOnly: false, excludedPaths: [] }
};
