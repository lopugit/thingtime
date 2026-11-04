import { createSyncIgnorePolicy } from './syncIgnore';
import { parseFileSyncConfiguration, FILE_SYNC_KIND, type FileSyncConfiguration } from './configuration';
import { planFileSync, syncPathKey, type SyncBaseline, type SyncPlan, type SyncScan, type SyncScope, sameSyncScope, validateSyncScope } from './reconcile';

export type SavedFileSyncConfiguration = { id: string; updatedAt: string; configuration: FileSyncConfiguration };
/** The native approval lives outside editable Things. Compare canonical values,
 * not only timestamps: an editable revision is not a device permission. */
export type FileSyncApproval = SavedFileSyncConfiguration & { scope: SyncScope };
export type SyncConditions = { network: 'wifi' | 'cellular' | 'ethernet' | 'offline' | 'unknown'; charging: boolean | null };
export type ConfiguredSyncPlan = { status: 'waiting'; reason: 'paused' | 'offline' | 'network' | 'charging' } | { status: 'ready'; plan: SyncPlan };

export function readOwnedFileSyncConfiguration(value: unknown, ownerId: string): SavedFileSyncConfiguration {
 const row = value as any;
 if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.id) || !ownerId || row.author?.id !== ownerId || row.appId != null || row.targetId != null ||
  !Array.isArray(row.thingtime) || row.thingtime.length !== 1 || row.thingtime[0] !== FILE_SYNC_KIND ||
  !Array.isArray(row.acl) || row.acl.length !== 1 || row.acl[0] !== 'tt:user' ||
  typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) throw Error('Sync requires a current private configuration owned by this account.');
 return { id: row.id, updatedAt: row.updatedAt, configuration: parseFileSyncConfiguration(row.crystal) };
}

/** Called only after fresh native grant/device and cloud folder authorization.
 * The scope root is the configuration Thing ID, keeping distinct connections'
 * baselines/journals separate even when they use the same local folder. */
export function planConfiguredFileSync(input: {
 saved: SavedFileSyncConfiguration;
 approval: FileSyncApproval;
 local: SyncScan;
 remote: SyncScan;
 baseline: SyncBaseline;
 localRootId: string;
 remoteFolderId: string;
 conditions: SyncConditions;
}): ConfiguredSyncPlan {
 const { saved, approval, local, remote, baseline, conditions } = input;
 const c = parseFileSyncConfiguration(saved.configuration), approved = parseFileSyncConfiguration(approval.configuration);
 const scope = local.scope;
 validateSyncScope(scope); validateSyncScope(approval.scope);
 if (scope.rootId !== saved.id || scope.deviceId !== c.deviceId || c.localRootId !== input.localRootId || c.remoteFolderId !== input.remoteFolderId ||
  approval.id !== saved.id || approval.updatedAt !== saved.updatedAt || JSON.stringify(approved) !== JSON.stringify(c) ||
  !sameSyncScope(approval.scope, scope)) throw Error('Sync configuration or device approval changed. Review it on this device before continuing.');
 if (c.paused) return { status: 'waiting', reason: 'paused' };
 if (conditions.network === 'offline') return { status: 'waiting', reason: 'offline' };
 if (!['wifi', 'cellular', 'ethernet'].includes(conditions.network) || (c.network === 'wifi' && conditions.network !== 'wifi')) return { status: 'waiting', reason: 'network' };
 if (c.chargingOnly && conditions.charging !== true) return { status: 'waiting', reason: 'charging' };
 // Validate full observations before filtering; exclusions never hide an invalid scan.
 const unfiltered = planFileSync(local, remote, baseline, c);
 if (!c.excludedPaths.length && !c.ignoreRules) return { status: 'ready', plan: unfiltered };
 const exclusions = c.excludedPaths.map(syncPathKey);
 const ignore = createSyncIgnorePolicy(c.ignoreRules, c.excludedPaths);
 const included = (entry: { path: string; kind: 'file' | 'folder' }) => !ignore.ignored(entry.path, entry.kind);
 const plan = planFileSync({ ...local, entries: local.entries.filter(included) },
  { ...remote, entries: remote.entries.filter(included) }, { ...baseline, entries: baseline.entries.filter(e => included(e.local)) }, c);
 // A parent must not be removed while it contains (or is configured to protect)
 // an excluded child. Native emptiness checks remain required at publication.
 const localByPath = new Map(local.entries.map(e => [e.path, e]));
 const remoteByPath = new Map(remote.entries.map(e => [e.path, e]));
 const protectedDescendants = [...local.entries, ...remote.entries, ...baseline.entries.map(pair => pair.local)].filter(entry => !included(entry));
 plan.decisions = plan.decisions.map(decision => decision.kind === 'trash' && (exclusions.some(path => path.startsWith(syncPathKey(decision.path) + '/')) || protectedDescendants.some(entry => entry.path.startsWith(decision.path + '/'))) ? {
  kind: 'conflict', path: decision.path, reason: 'excluded-descendants',
  local: localByPath.get(decision.path) ?? null,
  remote: remoteByPath.get(decision.path) ?? null
 } : decision);
 return { status: 'ready', plan };
}
