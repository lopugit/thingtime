import { AutomaticStoragePlacementExcluded, THING_STORAGE_POLICY_PATH, THING_STORAGE_POLICY_REQUIREMENTS, type AutomaticThingStoragePolicyPage, type AutomaticThingStorageRule } from '../utils/thingStoragePolicy';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { cloudRequests, type CloudTransportRuntime } from './cloudTransport';
import type { SyncMutation } from './execute';
import { decideSyncPath, type SyncPathObservation, type SyncPolicy, type SyncScope } from './reconcile';

export type AutomaticStoragePlacement = {
  rules(): Promise<ReadonlyMap<string, AutomaticThingStorageRule>>;
  admit(mutation: SyncMutation, fresh?: boolean): Promise<void>;
};
const REQUIREMENTS = { ...THING_STORAGE_POLICY_REQUIREMENTS, 'api.files': '1.12.2', 'api.file-sync-transfer-admissions': '1.3.1' } as const;

const allowsDownload = (rule: AutomaticThingStorageRule | undefined, deviceId: string) => !rule || (
  rule.localAvailability !== 'cloud-only' &&
  (!rule.automaticDownloadDeviceId || rule.automaticDownloadDeviceId === deviceId) &&
  (rule.localAvailability === 'keep' || rule.defaultLocalAvailability !== 'on-demand')
);

export function automaticStorageMutationAllowed(mutation: SyncMutation, scope: SyncScope, rules: ReadonlyMap<string, AutomaticThingStorageRule>) {
  if (mutation.kind === 'copy') {
    if (mutation.source.kind !== 'file') return true;
    if (mutation.from === 'remote') return allowsDownload(rules.get(mutation.source.id), scope.deviceId);
    return !mutation.expectedTarget || rules.get(mutation.expectedTarget.id)?.cloudSync !== false;
  }
  if (mutation.expected.kind !== 'file' || mutation.side !== 'remote') return true;
  const rule = rules.get(mutation.expected.id);
  // An intentionally unhydrated/evicted file is not a remote deletion intent.
  return rule?.cloudSync !== false && allowsDownload(rule, scope.deviceId);
}

export function automaticStoragePathAllowed(row: SyncPathObservation, policy: SyncPolicy, scope: SyncScope, rules: ReadonlyMap<string, AutomaticThingStorageRule>) {
  const remote = row.remote ?? row.beforeRemote;
  if (!remote || remote.kind !== 'file') return true;
  const rule = rules.get(remote.id);
  if (!rule) return true;
  const decision = decideSyncPath(row, policy, false, false);
  if (decision.kind === 'copy' || decision.kind === 'trash') {
    if (decision.kind === 'copy' && decision.from === 'local' && rule.cloudSync === false) return false;
    if (decision.kind === 'trash' && decision.side === 'local' && !allowsDownload(rule, scope.deviceId)) return false;
    return automaticStorageMutationAllowed(decision, scope, rules);
  }
  return decision.kind !== 'conflict' || ((!!row.local || allowsDownload(rule, scope.deviceId)) &&
    (rule.cloudSync || allowsDownload(rule, scope.deviceId)));
}

const isRule = (value: unknown): value is AutomaticThingStorageRule => {
  const rule = value as AutomaticThingStorageRule | undefined;
  return !!rule && typeof rule.id === 'string' && !!rule.id && typeof rule.cloudSync === 'boolean' &&
    ['inherit', 'on-demand', 'keep'].includes(rule.defaultLocalAvailability) &&
    ['inherit', 'keep', 'cloud-only'].includes(rule.localAvailability) &&
    (rule.automaticDownloadDeviceId === null || (typeof rule.automaticDownloadDeviceId === 'string' && !!rule.automaticDownloadDeviceId));
};

/** One sparse, revision-fenced snapshot per job and bounded refresh interval.
 * Explicit rules are paged once when changed. Unchanged roots never do a
 * policy lookup per file. The same gate is consulted before staging and again
 * before live publication. Unsupported older origins retain their defaults. */
export function createAutomaticStoragePlacement(runtime: CloudTransportRuntime, scope: SyncScope, signal: AbortSignal,
  now: () => number = Date.now): AutomaticStoragePlacement {
  const { json, check } = cloudRequests(runtime, scope, signal, 512 * 1024);
  let supported: boolean | undefined, revision: string | null | undefined, expires = 0;
  let current = new Map<string, AutomaticThingStorageRule>(), loading: Promise<ReadonlyMap<string, AutomaticThingStorageRule>> | undefined;
  const load = async () => {
    if (supported === undefined) {
      // Use the canonical API registry manifest through the same origin-
      // fenced host transport. An installed Mac may reach its selected API
      // through loopback, where a direct public cross-origin fetch is barred.
      const manifest = await json('/api/v1/capabilities');
      if (manifest?.ok !== true || manifest.schemaVersion !== 1 || !manifest.features || typeof manifest.features !== 'object' || Array.isArray(manifest.features))
        throw Error('Storage placement capability manifest is invalid.');
      const version = manifest.features['api.things-storage-policy'];
      if (version !== undefined && Object.entries(REQUIREMENTS).some(([feature, minimum]) => !capabilitySatisfies(manifest.features[feature], minimum)))
        throw Error('Storage placement capability is incompatible.');
      supported = version !== undefined;
    }
    if (!supported) return current;
    const next = new Map<string, AutomaticThingStorageRule>();
    let cursor: string | null = null, pageRevision: string | null | undefined;
    do {
      const query = new URLSearchParams({ automatic: '1', deviceId: scope.deviceId });
      const expected = cursor ? pageRevision : revision;
      if (expected !== undefined) query.set('revision', expected ?? 'none');
      if (cursor) query.set('cursor', cursor);
      const page: AutomaticThingStoragePolicyPage = await json(`${THING_STORAGE_POLICY_PATH}?${query}`);
      if (!page?.ok || !(page.revision === null || typeof page.revision === 'string' && /^[a-f0-9]{32}$/.test(page.revision)) ||
          !Array.isArray(page.rules) || page.rules.length > 64 ||
          (page.nextCursor !== null && typeof page.nextCursor !== 'string') || (cursor && page.revision !== pageRevision))
        throw Error('Storage placement page is invalid.');
      if (page.unchanged) {
        if (cursor || revision === undefined || page.revision !== revision || page.rules.length || page.nextCursor) throw Error('Storage placement revision changed.');
        expires = now() + 5000;
        return current;
      }
      pageRevision = page.revision;
      for (const rule of page.rules) {
        if (!isRule(rule) || (cursor && rule.id <= cursor) || next.has(rule.id)) throw Error('Storage placement rule is invalid.');
        next.set(rule.id, rule);
      }
      if (page.nextCursor !== null && (page.nextCursor !== page.rules.at(-1)?.id || (cursor !== null && page.nextCursor <= cursor)))
        throw Error('Storage placement continuation did not advance.');
      cursor = page.nextCursor;
    } while (cursor);
    check();
    current = next; revision = pageRevision; expires = now() + 5000;
    return current;
  };
  const rules = (fresh = false) => {
    check();
    if (supported === false || (!fresh && now() < expires)) return Promise.resolve(current);
    return loading ??= load().finally(() => { loading = undefined; });
  };
  return { rules, async admit(mutation, fresh) {
    const cloudFile = mutation.kind === 'copy' ? (mutation.from === 'remote' ? mutation.source : mutation.expectedTarget)
      : mutation.side === 'remote' ? mutation.expected : null;
    if (cloudFile?.kind !== 'file') return;
    // Unchanged roots do not produce any mutations. A real transfer can
    // afford one cheap revision validation immediately before its effects.
    if (!automaticStorageMutationAllowed(mutation, scope, await rules(fresh))) throw new AutomaticStoragePlacementExcluded();
  } };
}
