import { type AccountThingSync, accountThingCanCache } from './accountSync';
import { exportLocalThingSnapshot, type LocalThing } from './things';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceTransaction } from './storage';
import { parseTransfer, serializeTransfer, TRANSFER_LIMITS, type ThingTransfer } from '../utils/thingTransfer/format';
import { transferChecksum } from '../utils/thingTransfer/archive';

type Input = { ids: string[]; key?: string; includeChildren?: boolean; includeDependencies?: boolean; includeFiles?: boolean; includeLinks?: boolean };
type State = Awaited<ReturnType<AccountThingSync['exportSnapshot']>>;
type Snapshot = { manifest: ThingTransfer; revisions: Record<string, number>; savedAt: string };
const STORE = 'thing-export-snapshots';
class MissingExportSnapshot extends WorkspaceError {
 constructor(readonly id: string) { super('EXPORT_CACHE_INCOMPLETE', `Complete export content for ${id} is not saved on this device. Download it online once, then retry offline.`, 409); }
}
export const snapshotAccountExportInput = (input: Input) => {
 if (!input || Object.keys(input).some(key => !['ids', 'key', 'includeChildren', 'includeDependencies', 'includeFiles', 'includeLinks'].includes(key)) ||
  !Array.isArray(input.ids) || !input.ids.length || input.ids.length > TRANSFER_LIMITS.things || input.ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 200) ||
  ['includeChildren', 'includeDependencies', 'includeFiles', 'includeLinks'].some(key => (input as any)[key] !== undefined && typeof (input as any)[key] !== 'boolean') ||
  (input.key !== undefined && typeof input.key !== 'string')) throw new WorkspaceError('INVALID_EXPORT', 'Choose valid Thing IDs and download options.');
 return { ids: [...new Set(input.ids)], key: input.key, includeChildren: input.includeChildren !== false,
  includeDependencies: input.includeDependencies !== false, includeFiles: input.includeFiles !== false, includeLinks: input.includeLinks !== false };
};

/** Scoped, bounded content snapshots are export data, never owned editable Things
 * or an authorization grant. A partial library page cannot prove completeness. */
export async function exportAccountThings(input: Input, deps: {
 sync: AccountThingSync; db: WorkspaceDatabase; lease: WorkspaceLease;
 canRefresh: () => boolean;
 remote: (input: Input, options?: { signal?: AbortSignal }) => Promise<any>;
}, signal?: AbortSignal) {
 const args = snapshotAccountExportInput(input), { sync, db, lease } = deps;
 const check = () => { lease.assertCurrent(); signal?.throwIfAborted(); }; check();
 // Bearer-link exports keep their existing authorized path and are never cached.
 if (args.key) return deps.remote(args, { signal });
 const key = await transferChecksum(new TextEncoder().encode(JSON.stringify({ ...args, ids: [...args.ids].sort() })));
 check();
 const tx = <T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) =>
  db.transaction(sync.scope, mode, { assertCurrent: check, onInvalidate: lease.onInvalidate }, run);
 let baseline = await tx<Snapshot | undefined>('readonly', tx => tx.get<Snapshot>(STORE, key));
 const attempted = new Set<string>();
 const collect = async (state: State) => {
  const records = new Map(state.records.map(row => [row.id, row]));
  const captured = new Map(baseline?.manifest.things.map(row => [row.id, row]) || []);
  const docs = new Map<string, LocalThing>([...captured].map(([id, row]) => [id, { ...row, createdAt: baseline!.savedAt, updatedAt: baseline!.savedAt, revision: 1 }]));
  for (const row of state.things) {
   const record = records.get(row.id);
   if (!record || record.deleted || !accountThingCanCache(row)) continue;
   // Fresh server plans outrank an unchanged old device copy. Pending edits and
   // subsequent device revisions always remain the user's export content.
   if (!docs.has(row.id) || record.state !== 'synced' || baseline?.revisions[row.id] !== row.revision) docs.set(row.id, row);
  }
  for (const row of state.records) if (row.deleted) docs.delete(row.id);
  const bundle = await exportLocalThingSnapshot([...docs.values()], [], args.ids, lease,
   async () => undefined, { ...args, signal }, row => {
    const record = records.get(row.id);
    if (record && !record.remote && !record.deleted) return;
    if (!captured.has(row.id)) throw new MissingExportSnapshot(row.id);
   }, new Set(state.records.filter(row => !row.deleted).map(row => row.id)));
  check(); return bundle;
 };
 for (;;) {
  check(); const state = await sync.exportSnapshot(); check();
  try {
   const bundle = await collect(state);
   // Retain the entire known closure before a later sync acknowledges new IDs.
   // Missing children/files never reach this point or become a success snapshot.
   baseline = { manifest: bundle.manifest, revisions: Object.fromEntries(state.things.map(row => [row.id, row.revision])), savedAt: new Date().toISOString() };
   const retainedOnDevice = await retain(baseline); check();
   return { ok: true, localWorkspace: true, snapshotAt: baseline.savedAt, retainedOnDevice,
    plan: { roots: bundle.manifest.roots, things: bundle.manifest.things, files: [] } };
  } catch (error) {
   check();
   if (!(error instanceof MissingExportSnapshot) || !deps.canRefresh() || attempted.has(error.id)) throw error;
   attempted.add(error.id);
   if (attempted.size > TRANSFER_LIMITS.things) throw new WorkspaceError('EXPORT_LIMIT', 'This export exceeds the Thing limit.');
   const result = await deps.remote({ ...args, ids: [error.id] }, { signal }); check();
   if (!result?.ok || !result.plan) throw new WorkspaceError('EXPORT_FAILED', result?.error || 'Could not prepare complete export content.', result?.status || 503);
   const plan = result.plan;
   if (plan.files?.length || plan.links?.length || !plan.things?.every(accountThingCanCache)) {
    // Keep dedicated online exports working, but never replace pending local
    // content with an older server version just because it includes media.
    if (state.records.some(row => row.state !== 'synced')) throw new WorkspaceError('DEDICATED_EXPORT_REQUIRED', 'This download needs its file or managed-content adapter. Sync your device edits before downloading it online.', 409);
    return deps.remote(args, { signal });
   }
   const manifest = parseTransfer(serializeTransfer({ format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: [] }));
   if (manifest.roots.length !== 1 || manifest.roots[0] !== error.id) throw new WorkspaceError('INVALID_EXPORT', 'The export returned a different root.');
   const merged = new Map(baseline?.manifest.things.map(row => [row.id, row]) || []);
   for (const row of manifest.things) {
    const previous = merged.get(row.id);
    // Match the canonical server exporter: a dependency shared by separately
    // authorized roots must retain one meaning across their saved contexts.
    if (previous && row.id !== error.id && JSON.stringify(previous.crystal) !== JSON.stringify(row.crystal))
     throw new WorkspaceError('EXPORT_CONTEXT_CONFLICT', 'A dependency has conflicting saved contexts; export these roots separately.', 409);
    merged.set(row.id, row);
   }
   // Keep each authorized fragment's roots while the local collector assembles
   // the requested roots; no partial manifest is offered as a download.
   baseline = { manifest: parseTransfer(serializeTransfer({ ...manifest, roots: [...new Set([...(baseline?.manifest.roots || []), ...manifest.roots])], things: [...merged.values()] })),
    revisions: { ...baseline?.revisions, ...Object.fromEntries(state.things.map(row => [row.id, row.revision])) }, savedAt: new Date().toISOString() };
  }
 }
 async function retain(snapshot: Snapshot) {
  try { await tx('readwrite', async tx => {
   const entries = (await tx.list<Snapshot>(STORE)).filter(row => row.id !== key).sort((a,b) => a.value.savedAt.localeCompare(b.value.savedAt));
   // The normal workspace byte quota also applies to each retained snapshot.
   while (entries.length >= 16) await tx.delete(STORE, entries.shift()!.id);
   await tx.put(STORE, key, snapshot);
  }); return true;
  } catch (error) {
   check();
   // Downloading is still useful when the device is full. Cache retention is
   // optional and must never make exporting the only copy depend on quota.
   if (error instanceof WorkspaceError && error.code === 'LOCAL_QUOTA') return false;
   throw error;
  }
 }
}
