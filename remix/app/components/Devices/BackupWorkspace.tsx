import React from 'react';
import { createPortal } from 'react-dom';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import type { BackupWorkspaceCommand } from '~/backups/workspace';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { useBackupWorkspaceAdapter } from './useBackupWorkspaceAdapter';
import { backupWorkspaceBlocks, backupWorkspaceDisclosureBlocks } from './backupWorkspaceBlocks';
import { backupJobActive, backupJobProgress, backupRestoreReviewMatches, type BackupCatalog, type BackupDestination, type BackupEntry, type BackupJob, type BackupPage, type BackupRestoreReview, type BackupSnapshot, type BackupWorkspaceAdapter, type BackupWorkspaceScope } from './backupWorkspaceModel';

const ThingsFolderPicker = React.lazy(() => import('../Things/ThingsPage').then(module => ({ default: module.ThingsPage })));

type PickerProps = { onLocationChange(id: string | null, name: string): void };
type Props = { collapsed?: boolean; renderDestinationPicker?: (props: PickerProps) => React.ReactNode; scope: BackupWorkspaceScope; adapter: BackupWorkspaceAdapter; accountTransport?: SettingsDocumentHostProps['accountTransport'] };
export function BackupWorkspace(props: Props) {
 const user = useCurrentUser(), plane = useDataPlane();
 const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
 if (identity.pending || user?.id !== props.scope.ownerId || plane !== props.scope.dataPlane || typeof window === 'undefined' || window.location.origin !== props.scope.apiOrigin) return null;
 return <BackupWorkspaceSession key={JSON.stringify([props.scope, identity.generation])} {...props} generation={identity.generation} />;
}
function BackupWorkspaceSession({ scope, adapter, accountTransport, generation, renderDestinationPicker, collapsed }: Props & { generation: number }) {
 const scopeKey = JSON.stringify(scope);
 const [catalog, setCatalog] = React.useState<BackupCatalog | null>(null);
 const [snapshots, setSnapshots] = React.useState<BackupSnapshot[]>([]), [snapshot, setSnapshot] = React.useState<BackupSnapshot | null>(null);
 const [entries, setEntries] = React.useState<BackupPage<BackupEntry>>({ items: [], nextCursor: null });
 const [selected, setSelected] = React.useState(''), [storageId, setStorageId] = React.useState('');
 const [destination, setDestination] = React.useState<BackupDestination | null>(null);
 const [review, setReview] = React.useState<BackupRestoreReview | null>(null), [pendingReview, setPendingReview] = React.useState('');
 const [jobs, setJobs] = React.useState<BackupJob[]>([]);
 const [location, setLocation] = React.useState<{ id: string | null; name: string }>({ id: null, name: 'Choose an ordinary folder' });
 const [picker, setPicker] = React.useState(false);
 const pickerSlotId = 'backup-folder-picker-' + React.useId();
 const locationPicker = React.useMemo(() => ({ onLocationChange: (id: string | null, name: string) => setLocation(previous => previous.id === id && previous.name === name ? previous : { id, name }) }), []);
 const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
 const active = React.useRef<AbortController | null>(null), mounted = React.useRef(true), failures = React.useRef(0);
 const intents = React.useRef(new Map<string, BackupWorkspaceCommand>());
 const merge = <T extends { id: string }>(old: T[], next: T[]) => [...old.filter(item => !next.some(value => value.id === item.id)), ...next];
 const assertCurrent = (signal: AbortSignal) => {
  signal.throwIfAborted(); const identity = rootIdentity.read();
  if (!mounted.current || identity.pending || identity.generation !== generation || window.location.origin !== scope.apiOrigin) throw new DOMException('Scope changed', 'AbortError');
 };
 const run = async (work: (signal: AbortSignal) => Promise<void>, background = false) => {
  if (active.current) return;
  const controller = new AbortController(); active.current = controller; if (!background) { setBusy(true); setError(''); }
  try { assertCurrent(controller.signal); await work(controller.signal); failures.current = 0; }
  catch (cause) { failures.current++; if (!controller.signal.aborted && mounted.current && rootIdentity.read().generation === generation) setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Could not finish. Refresh to check saved progress before retrying.'); }
  finally { if (active.current === controller) active.current = null; if (mounted.current && !controller.signal.aborted && !background) setBusy(false); }
 };
 const refresh = (cursors: { snapshotCursor?: string; jobCursor?: string } = {}, background = false) => run(async signal => {
  const value = await adapter.catalog(signal, cursors); assertCurrent(signal);
  setCatalog(old => ({ ...value, snapshots: cursors.jobCursor && old ? old.snapshots : value.snapshots, jobs: cursors.snapshotCursor && old ? old.jobs : value.jobs }));
  setSnapshots(old => cursors.snapshotCursor ? merge(old, value.snapshots.items) : cursors.jobCursor ? old : value.snapshots.items);
  const observed = [...value.jobs.items];
  // Jobs may have moved off the first catalogue page. Follow their exact IDs.
  if (!cursors.jobCursor && !cursors.snapshotCursor) for (const retained of jobs.filter(backupJobActive)) {
   if (!observed.some(job => job.id === retained.id)) { observed.push(await adapter.job(retained.id, signal)); assertCurrent(signal); }
  }
  setJobs(old => cursors.snapshotCursor ? old : merge(old, observed));
  if (pendingReview && observed.some(job => job.id === pendingReview && job.status === 'completed')) {
   const saved = await adapter.review(pendingReview, signal); assertCurrent(signal); setReview(saved); setPendingReview('');
  }
  if (pendingReview && observed.some(job => job.id === pendingReview && ['cancelled', 'needs-attention'].includes(job.status))) setPendingReview('');
  if (!background) setError('');
 }, background);
 const refreshRef = React.useRef(refresh); refreshRef.current = refresh;
 React.useEffect(() => {
  mounted.current = true; void refreshRef.current();
  const unsubscribe = rootIdentity.subscribe(() => { const state = rootIdentity.read(); if (state.pending || state.generation !== generation) active.current?.abort(); });
  return () => { mounted.current = false; active.current?.abort(); active.current = null; unsubscribe(); };
 }, [adapter, generation]);
 // A visible view observes durable jobs. Closing/hiding it never cancels work.
 const observingJobs = jobs.some(backupJobActive);
 React.useEffect(() => {
  if (!observingJobs) return;
  let timer: ReturnType<typeof setTimeout>;
  const next = () => { timer = setTimeout(async () => { if (document.visibilityState === 'visible' && failures.current < 3) await refreshRef.current({}, true); next(); }, failures.current ? 10000 : 2500); };
  next(); return () => clearTimeout(timer);
 }, [observingJobs]);
 const browse = (id: string, cursor?: string) => run(async signal => {
  const item = snapshots.find(value => value.id === id); if (!item) return;
  const page = await adapter.browse(id, signal, cursor); assertCurrent(signal);
  if (!cursor) { setSnapshot(item); setSelected(''); setReview(null); }
  setEntries(old => cursor ? { ...page, items: merge(old.items, page.items) } : page);
 });
 const updateJob = (job: BackupJob) => setJobs(old => [job, ...old.filter(value => value.id !== job.id)]);
 const command = async (value: BackupWorkspaceCommand, signal: AbortSignal) => {
  // An uncertain response retries the same request identity and frozen payload.
  const key = JSON.stringify({ ...value, requestId: undefined });
  const original = intents.current.get(key) || value; intents.current.set(key, original);
  const job = await adapter.command(original, signal); assertCurrent(signal); intents.current.delete(key); updateJob(job); return job;
 };
 const available = !!catalog?.storage.available && (catalog.worker.available === true || catalog.worker.reason === 'worker-unverified');
 const actions: TransientBlockActions = {
  refresh: () => refresh(), 'next-snapshots': () => catalog?.snapshots.nextCursor ? refresh({ snapshotCursor: catalog.snapshots.nextCursor }) : undefined,
  'next-jobs': () => catalog?.jobs.nextCursor ? refresh({ jobCursor: catalog.jobs.nextCursor }) : undefined,
  storage: ({ inputs }) => { if (!busy) setStorageId(String(inputs.id)); },
  snapshot: () => run(async signal => { if (available && storageId) await command({ action: 'snapshot', requestId: crypto.randomUUID(), destinationId: storageId }, signal); }),
  browse: ({ inputs }) => browse(String(inputs.id)), 'next-entries': () => snapshot && entries.nextCursor ? browse(snapshot.id, entries.nextCursor) : undefined,
  select: ({ inputs, value }) => { if (busy) return; const entry = entries.items.find(item => item.id === inputs.id); if (!entry?.selectable || entry.kind === 'unsupported') return; setSelected(value === true ? entry.id : ''); setReview(null); },
  destination: () => { if (!busy) setPicker(true); },
  'folder-close': () => { if (!busy) setPicker(false); },
  'folder-confirm': () => run(async signal => { if (!location.id) return; const next = await adapter.destination(location.id, signal); assertCurrent(signal); setDestination(next); setReview(null); setPicker(false); }),
  review: () => run(async signal => {
   if (!snapshot || !destination || !selected || !available) return;
   const job = await command({ action: 'review', requestId: crypto.randomUUID(), selection: { snapshotId: snapshot.id, sourceRootId: selected, destination } }, signal); if (job.status === 'completed') { const saved = await adapter.review(job.id, signal); assertCurrent(signal); setReview(saved); } else { setPendingReview(job.id); setReview(null); }
  }),
  'open-review': ({ inputs }) => run(async signal => {
   const saved = await adapter.review(String(inputs.id), signal); assertCurrent(signal);
   // Recover the exact selection without substituting the current draft.
   const item = snapshots.find(value => value.id === saved.snapshotId);
   setSnapshot(item || { id: saved.snapshotId, name: 'Reviewed snapshot', createdAt: '', integrity: 'unverified', coverage: 'unknown', description: '' });
   setEntries({ items: [], nextCursor: null }); setSelected(saved.sourceRootId); setDestination(saved.destination); setReview(saved);
  }),
  execute: () => run(async signal => {
   if (!review?.executable || !available || !snapshot || !destination || !backupRestoreReviewMatches(review, { snapshotId: snapshot.id, sourceRootId: selected, destination })) return;
   await command({ action: 'restore', requestId: crypto.randomUUID(), reviewId: review.id, reviewHash: review.hash }, signal); setReview(null);
  }),
  'close-review': () => { if (!busy) setReview(null); },
  ...Object.fromEntries((['pause', 'resume', 'retry', 'cancel'] as const).map(action => [action, ({ inputs }: { inputs: Record<string, unknown> }) => run(async signal => {
   const job = jobs.find(item => item.id === inputs.id); if (!job || ['completed', 'cancelled'].includes(job.status)) return;
   const next = await command({ action, jobId: job.id }, signal);
   if (job.kind === 'review' && ['resume', 'retry'].includes(action) && backupJobActive(next)) setPendingReview(job.id);
   if (action === 'cancel' && job.id === pendingReview) setPendingReview('');
  })]))
 };
 const display = { backup: {
  hasSnapshot: !!snapshot, picker, hasReview: !!review, busy, status: busy ? 'Updating…' : '', statusDisplay: busy ? 'inline' : 'none', error, errorDisplay: error ? 'block' : 'none',
  storage: !catalog ? '' : catalog.storage.available === true ? 'Independent storage configured · durability verified per snapshot' : `Storage unavailable: ${catalog.storage.reason}`,
  worker: !catalog ? '' : catalog.worker.available === true ? 'Background worker available' : catalog.worker.reason === 'worker-unverified' ? 'Background processing will be checked when work starts' : `Worker unavailable: ${catalog.worker.reason}`,
  coverageNote: catalog?.coverageNote || 'Snapshot integrity, saved coverage and restore readiness are checked separately. Whole-account restore is not implied.',
  storageEmpty: catalog ? 'No configured independent storage returned.' : '', jobsEmpty: catalog ? 'No backup activity returned.' : '',
  storageId, storageLabel: catalog?.destinations.find(item => item.id === storageId)?.label || 'Choose storage below', storageOptions: (catalog?.destinations || []).map(item => ({ ...item, name: `${item.label} · ${item.state}` })), createDisabled: busy || !available || !catalog?.destinations.some(item => item.id === storageId),
  snapshots, snapshotEmpty: catalog ? 'No saved snapshots returned.' : '', snapshotsNextDisabled: busy || !catalog?.snapshots.nextCursor,
  contentsTitle: snapshot ? `Contents · ${snapshot.name}` : 'Saved contents', contentsDisplay: snapshot ? 'flex' : 'none',
  entries: entries.items.map(item => ({ ...item, selected: selected === item.id, disabled: busy || !item.selectable || item.kind === 'unsupported', size: item.bytes === null ? 'Size unavailable' : `${item.bytes.toLocaleString()} bytes`, history: item.versions === null ? 'Version coverage unavailable' : `${item.versions.toLocaleString()} saved versions`, reason: item.reason || '' })),
  entriesNextDisabled: busy || !entries.nextCursor, selectionCount: selected ? 'One graph root selected · includes its supported descendants and dependencies' : 'Choose one saved graph root', destination: destination?.path || 'No destination selected',
  pickerSlotId, folderPath: location.name, folderConfirmDisabled: busy || !location.id,
  reviewStatus: pendingReview ? 'Preparing saved review. Track progress in backup activity.' : 'A saved review must match this source root and the destination revision before restoration can start.',
  reviewDisabled: busy || !available || !selected || !destination || !!pendingReview, executeDisabled: busy || !available || !review?.executable || !snapshot || !destination || !backupRestoreReviewMatches(review, { snapshotId: snapshot.id, sourceRootId: selected, destination }),
  reviewDisplay: review ? 'flex' : 'none', review: { ...review, destination: review ? `Destination: ${review.destination.path} · revision ${review.destination.revision}` : '', limitations: review?.limitations.map(label => ({ label })) || [] },
  jobsNextDisabled: busy || !catalog?.jobs.nextCursor,
  jobs: jobs.map(job => ({ ...job, name: `${job.kind === 'snapshot' ? 'Snapshot' : job.kind === 'review' ? 'Restore review' : 'Restore'} · ${job.id}`, phase: job.progress.phase, progress: backupJobProgress(job), detail: job.issue ? `Needs attention: ${job.issue}. Refresh saved progress before retrying.` : '', pauseDisabled: busy || !backupJobActive(job), resumeDisabled: busy || !available || job.status !== 'paused', retryDisabled: busy || !available || job.status !== 'needs-attention', cancelDisabled: busy || !['queued', 'running', 'paused', 'needs-attention'].includes(job.status), reviewDisabled: busy || job.kind !== 'review' || job.status !== 'completed' }))
 } };
 return <SettingsDocumentHost documentKey="backup-workspace" title="Backup workspace" defaultDocument={collapsed ? backupWorkspaceDisclosureBlocks(backupWorkspaceBlocks) : backupWorkspaceBlocks} migrateBlocks={collapsed ? backupWorkspaceDisclosureBlocks : undefined} scopeKey={scopeKey} accountTransport={accountTransport} layoutEditingDisabled={busy}>
  {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={display} actions={actions} enabled={!editing} onError={() => setError('Could not activate this control. Refresh to check saved progress.')}>
   <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
   <BackupDestinationPicker slotId={pickerSlotId} enabled={picker && !editing} picker={locationPicker} render={renderDestinationPicker} />
  </TransientBlockHost>}
 </SettingsDocumentHost>;
}

/** Shared Things browser retains its normal authorization, pagination, folder
 * creation and editable list/grid controls. The backup document owns its slot
 * and individually editable confirmation controls. */
function BackupDestinationPicker({ slotId, enabled, picker, render }: { slotId: string; enabled: boolean; picker: PickerProps; render?: Props['renderDestinationPicker'] }) {
 const [target, setTarget] = React.useState<HTMLElement | null>(null);
 React.useLayoutEffect(() => { setTarget(enabled ? document.getElementById(slotId) : null); }, [slotId, enabled]);
 return enabled && target ? createPortal(render ? render(picker) : <React.Suspense fallback={<span role="status">Opening folders…</span>}><ThingsFolderPicker locationPicker={picker} /></React.Suspense>, target) : null;
}

/** Normal device Sync & Backup entry. The same scope fence and negotiated
 * adapter used by the workspace refuse missing capability/account access. */
const BackupWorkspaceEntryContext = React.createContext(false);
export function AccountBackupWorkspaceBoundary({ children }: { children: React.ReactNode }) {
 return <BackupWorkspaceEntryContext.Provider value={true}>{children}</BackupWorkspaceEntryContext.Provider>;
}
export function AccountBackupWorkspace({ ownerId }: { ownerId: string }) {
 const parentHasEntry = React.useContext(BackupWorkspaceEntryContext);
 const user = useCurrentUser(), plane = useDataPlane();
 const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
 if (parentHasEntry || !user || user.id !== ownerId || user.temporary || user.isCharacter || user.accountKind !== 'user' || plane !== 'home' || identity.pending || typeof window === 'undefined') return null;
 return <AccountBackupWorkspaceSession key={`${ownerId}:${identity.generation}`} ownerId={ownerId} origin={window.location.origin} />;
}
function AccountBackupWorkspaceSession({ ownerId, origin }: { ownerId: string; origin: string }) {
 const scope = React.useMemo<BackupWorkspaceScope>(() => ({ ownerId, apiOrigin: origin, dataPlane: 'home', identity: 'account-backup-workspace' }), [ownerId, origin]);
 const adapter = useBackupWorkspaceAdapter(scope);
 return <BackupWorkspace scope={scope} adapter={adapter} collapsed />;
}
