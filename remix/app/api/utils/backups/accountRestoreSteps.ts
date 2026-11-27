import { createHash } from 'node:crypto';
import { BACKUP_CHUNK_BYTES, type BackupItem } from '../../../backups/manifest';
import { canonicalJsonBytes } from '../../../utils/canonicalJsonStream';
import { accountRestoreDestination, type AccountRestoreDestination } from '../../../backups/accountRestore';
import { parseCloudFile, type CloudFile } from '../../../fileSync/cloudFile';
import { parseTimelineNote } from '../../../timeline/notes';
import { parseTimelineVersionName } from '../../../timeline/versionNames';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract';
import { joinTimelineEvent, type TimelineLink } from '../../../timeline/records';
import { folderPlacementValue } from '../../../timeline/folderPlacement';
import { CONTENT_CREATION_REQUIREMENTS } from '../../../backups/contentCreation';
import type { BackupWorkspaceReview } from '../../../backups/workspace';
import { thingtimeCapabilityManifest, capabilitySatisfies } from '../capabilities/thingtimeCapabilities';
import { getCurrentUser } from '../auth/getCurrentUser';
import type { CompositionReference } from '../actions/sharedCompositionCore';
import { rewriteComposition } from '../actions/forkCompositionCore';
import { renderComponentDeclaration } from '../../../components/Thingtime/renderComponentDeclaration';
import { iterateBackupThingReferences, iterateBackupThingMedia, StoredReferenceUnsupportedError } from './storedReferences';
import { parseBackupAttachment, verifyBackupFileReference } from './attachmentRecords';
import { ACCOUNT_FILE_RESTORE_REQUIREMENTS, accountFileRestoreContentKey, accountFileRestoreRecordKey, accountFileRestoreCommandId, openReviewedAccountFileRestoreWriter, type AccountFileRestoreRecord, type AccountFileRestoreReview, type AccountFileRestoreFolder } from './accountFileRestore';
import { advanceAccountFileRestoreBytes, type FileRestoreBytesState } from './accountFileRestoreBytes';
import type { CloudBackupRuntime } from './cloudFolderBackup';
import { readAccountRestoreRecord, type RestoreSourceRecord } from './accountRestoreRecord';
import { openBackupWorkerView, type BackupAccess, type BackupObjectStore, type BackupWorkerItemRef } from './portableBackup';
import { immutableReferenceIndex, type ReferenceBlob } from './immutableReferenceIndex';
import { backupHashOperationId, backupJobDigest } from './backupJobCore';
import type { BackupEngineContext, BackupEngineOutcome, CompletedBackupJob } from './backupJobs';
import { createResumableHashWorker, type HashCheckpointRef, type ImmutableHashSource } from './resumableHash';
import { assertOrdinaryRestoreDestination, openReviewedOrdinaryRestoreWriter, ordinaryRestoreTargetId, type OrdinaryRestoreCreation, type OrdinaryRestoreReview } from './ordinaryRestoreTransaction';

const hash = (value: unknown) => { const h = createHash('sha256'); for (const bytes of canonicalJsonBytes(value)) h.update(bytes); return h.digest('hex'); };
const ZERO = '0'.repeat(64);
const continuation: BackupEngineOutcome = { kind: 'continue' };
type Index = ReturnType<typeof immutableReferenceIndex>;
type Snapshot = { store: BackupObjectStore; snapshotId: string; planHash: string; sealHash: string };
export type AccountRestoreStepDependencies = { access: BackupAccess; openSnapshot(source: CompletedBackupJob): Promise<Snapshot>; runtime?: CloudBackupRuntime };
type Entry = { item: BackupItem; proof: BackupWorkerItemRef; decoded: ReferenceBlob | null };
type Selected = { id: string; descend: boolean; done: boolean; children: number; refs: number; dependencies: number; ordered: boolean; counted?: boolean };
type State = {
 version: 1; annotationContract?: 1; reviewId: string; sourceJobId: string; snapshotId: string; sourcePlanHash: string; sourceSealHash: string;
 sourceRootId: string; destination: AccountRestoreDestination; root: string | null;
 mode: 'census' | 'select' | 'order' | 'intents' | 'hash' | 'seal' | 'sealed' | 'restore-admit' | 'restore-intents' | 'restore-apply' | 'restore-verify' | 'restore-complete' | 'file-plan' | 'file-hash' | 'file-restore-admit' | 'file-restore-apply' | 'file-restore-verify' | 'file-restore-complete';
 page: number; pageHash: string | null; item: number; scanned: number; selected: number; queued: number; selectionIndex: number;
 ordered: number; orderIndex: number; orderProgress: number; intent: number; graphBytes: string; graphHash: string | null;
 ordinary: number; files: number; fileCommands: number; fileGraphBytes: string; fileGraphHash: string | null; filePhase: 'folders' | 'current' | 'versions' | 'history' | 'branches' | 'annotations' | 'finalize'; fileOrdinal: number; filePart: number; annotationIndex: number; fileHistoryExpected: number; fileHistoryWritten: number; sourceRangePage: number; sourceRangeOffset: number; byteState: FileRestoreBytesState | null;
 issues: number; issue: string | null; chain: string; epoch: number | null; reviewHash: string | null;
};
/** The canonical discovery and remapping visitors have overlapping domains.
 * Preserve both: e.g. stored data can carry schemaId plus a schema name. A
 * per-record map deduplicates them; no account-sized list is materialized. */
function* ordinaryReferences(value: RestoreSourceRecord, signal?: AbortSignal) {
 const seen = new Set<string>();
 for (const ref of iterateBackupThingReferences(value.kinds, value.crystal, { signal })) if (ref) {
  seen.add(JSON.stringify([ref.kind, ref.ref])); yield ref;
 }
 const extra = new Map<string, CompositionReference>();
 rewriteComposition(value.kinds, value.crystal, (kind, ref) => {
  const key = JSON.stringify([kind, ref]); if (!seen.has(key)) extra.set(key, { kind, ref }); return ref;
 });
 yield* extra.values();
}
const namespace = (id: string) => `restore-plans/${id}/references`;
async function destination(ctx: BackupEngineContext, selected: { destinationId: string; destinationRevision: string }) {
 await ctx.guard(); const user = await getCurrentUser(ctx.request);
 if (!user || user.id === undefined) throw Error('Restore account is unavailable');
 const origin = new URL(ctx.request.url).origin, available = thingtimeCapabilityManifest(origin).features;
 const capabilities: Record<string, string> = {};
 for (const [feature, required] of Object.entries({ ...CONTENT_CREATION_REQUIREMENTS, ...ACCOUNT_FILE_RESTORE_REQUIREMENTS })) {
  const version = available[feature]?.version ?? '';
  if (!capabilitySatisfies(version, required)) throw Error('A canonical restore writer contract is unavailable'); capabilities[feature] = version;
 }
 await ctx.guard();
 const target = accountRestoreDestination({ scope: { apiOrigin: origin, ownerId: user.id, dataPlane: 'home' }, rootId: selected.destinationId, rootRevision: selected.destinationRevision, capabilities });
 await assertOrdinaryRestoreDestination(ctx.request, target); return target;
}
const fileReview = (s: State): AccountFileRestoreReview => ({ format: 'thingtime-selected-file-restore-v1', operationId: s.reviewId, sourceSealHash: s.sourceSealHash, graphHash: s.fileGraphHash ?? ZERO, count: s.fileCommands, destination: s.destination });
const ordinaryReview = (state: State): OrdinaryRestoreReview => ({ format: 'thingtime-selected-ordinary-restore-v1', referenceDomain: 'ordinary-composition-v1',
 operationId: state.reviewId, sourceSealHash: state.sourceSealHash, reviewHash: backupJobDigest([state.sourcePlanHash, state.sourceSealHash, state.destination, state.sourceRootId]), graphHash: state.graphHash ?? ZERO,
 count: state.ordered, destination: state.destination });
const summary = (s: State) => ({ format: 'thingtime-selected-restore-review-v1', reviewId: s.reviewId, sourceJobId: s.sourceJobId,
 snapshotId: s.snapshotId, sourcePlanHash: s.sourcePlanHash, sourceSealHash: s.sourceSealHash, sourceRootId: s.sourceRootId,
 destination: s.destination, selected: s.selected, count: s.ordered, graphHash: s.graphHash, graphBytes: s.graphBytes, files: s.files, fileCommands: s.fileCommands, fileGraphBytes: s.fileGraphBytes, fileGraphHash: s.fileGraphHash,
 issues: s.issues, issue: s.issue, root: s.root, wholeAccountReady: false, ...(s.annotationContract===1?{annotationContract:1}:{}) });
function validateState(s: State, reviewId: string, source: Snapshot) {
 if (!s || s.version !== 1 || s.reviewId !== reviewId || s.snapshotId !== source.snapshotId || s.sourcePlanHash !== source.planHash ||
  s.sourceSealHash !== source.sealHash || ![s.scanned, s.selected, s.selectionIndex, s.ordered, s.orderIndex, s.intent, s.issues].every(v => Number.isSafeInteger(v) && v >= 0) ||
  s.selectionIndex > s.queued || s.ordered > s.selected || !/^\d+$/.test(s.graphBytes) || !/^[a-f0-9]{64}$/.test(s.chain)) throw Error('Restore continuation changed');
 accountRestoreDestination(s.destination);
}
/** Safe projection of a currently authorized completed review. The exact
 * completed job pins both the immutable certificate and private continuation. */
export type AccountRestoreReviewContext = Pick<BackupEngineContext, 'jobId' | 'guard' | 'completedSource'>;
export async function readAccountRestoreReview(ctx: AccountRestoreReviewContext, deps: Pick<AccountRestoreStepDependencies, 'access' | 'openSnapshot'>, completed?: CompletedBackupJob): Promise<BackupWorkspaceReview> {
 const review = await ctx.completedSource(completed?.jobId ?? ctx.jobId, 'review');
 if (review.operation.kind !== 'review' || !review.cursor.restoreStateHash) throw Error('A sealed review is unavailable');
 const snapshotJob = await ctx.completedSource(review.operation.sourceJobId, 'snapshot'), source = await deps.openSnapshot(snapshotJob);
 const index = immutableReferenceIndex(source.store, namespace(review.jobId), ctx.guard);
 const state: State = await index.readState(review.cursor.restoreStateHash); validateState(state, review.jobId, source);
 if (state.mode !== 'sealed' || state.reviewHash !== review.cursor.sealHash || hash(summary(state)) !== state.reviewHash ||
  backupJobDigest([state.sourcePlanHash, state.sourceSealHash, state.destination, state.sourceRootId]) !== review.cursor.planHash) throw Error('The reviewed certificate changed');
 return { id: review.jobId, hash: state.reviewHash!, snapshotId: state.sourceJobId, sourceRootId: state.sourceRootId,
  destination: { id: state.destination.rootId, revision: state.destination.rootRevision, name: 'Selected destination', path: 'Selected destination' },
  summary: `${state.ordered} ordinary content records and ${state.files} files in the selected graph.`,
  coverage: state.issues ? `Selected graph is unsupported: ${state.issue}.` : 'Complete selected ordinary content and stored-reference closure. Whole-account readiness is false.',
  history: state.files && state.annotationContract===1 ? 'Complete selected file revisions, branch names, notes and version labels with fresh destination identities. New canonical restore audit history. Original ordinary Timeline history is not imported.' : 'New canonical restore audit history. Original ordinary Timeline history remains in the sealed backup and is not imported.',
  limitations: ['Original grants, credentials and live account authority are never copied.', 'Original ordinary Timeline history is retained in the backup, not imported.', ...(state.files&&state.annotationContract!==1?['This earlier review retains file notes and custom version labels in the backup only. Create a new review to import them.']:[]), ...(state.issues ? [state.issue ?? 'The selected graph is unsupported.'] : [])],
  executable: state.issues === 0 && (state.ordered > 0 || state.files > 0) };
}
/** Fixed state pointer plus immutable trie sidecars. Each call reads one source
 * entry, advances one closure/order record, hashes one byte segment, or commits
 * one canonical intent/effect. No full archive traversal or SQLite preflight is
 * hidden inside an invocation. Dataset size does not enlarge the job cursor. */
export async function runAccountRestoreStep(ctx: BackupEngineContext, deps: AccountRestoreStepDependencies): Promise<BackupEngineOutcome> {
 await ctx.guard(); deps.access.signal?.throwIfAborted();
 if (ctx.operation.kind === 'snapshot') throw Error('Invalid restore worker operation');
 const reviewJob = ctx.operation.kind === 'restore' ? await ctx.completedSource(ctx.operation.reviewJobId, 'review') : null;
 const operation = reviewJob?.operation ?? ctx.operation;
 if (operation.kind !== 'review') throw Error('The selected review is unavailable');
 const sourceJob = await ctx.completedSource(operation.sourceJobId, 'snapshot'), source = await deps.openSnapshot(sourceJob);
 const reviewId = reviewJob?.jobId ?? ctx.jobId;
 const view = await openBackupWorkerView(source.store, source.snapshotId, deps.access, source);
 const priorHash = ctx.cursor.restoreStateHash ?? reviewJob?.cursor.restoreStateHash ?? null;
 const index = immutableReferenceIndex(source.store, namespace(reviewId), ctx.guard, () => deps.access.signal?.throwIfAborted(), hash([ctx.jobId, priorHash]));
 let state: State;
 if (priorHash) { state = await index.readState(priorHash); validateState(state, reviewId, source); }
 else {
  const target = await destination(ctx, operation);
  state = { version: 1, annotationContract:1, reviewId, sourceJobId: operation.sourceJobId, snapshotId: source.snapshotId, sourcePlanHash: source.planHash, sourceSealHash: source.sealHash,
   sourceRootId: operation.sourceRootId, destination: target, root: null, mode: 'census', page: 0, pageHash: null, item: 0, scanned: 0, selected: 0, queued: 0, selectionIndex: 0,
   ordered: 0, orderIndex: 0, orderProgress: 0, intent: 0, graphBytes: '0', graphHash: null, ordinary: 0, files: 0, fileCommands: 0, fileGraphBytes: '0', fileGraphHash: null, filePhase: 'folders', fileOrdinal: 0, filePart: 0, annotationIndex: 0, fileHistoryExpected: 0, fileHistoryWritten: 0, sourceRangePage: 0, sourceRangeOffset: 0, byteState: null, issues: 0, issue: null, chain: ZERO, epoch: null, reviewHash: null };
 }
 const get = (...key: unknown[]) => index.get(state.root, index.key(key));
 const set = async (value: unknown, ...key: unknown[]) => { state.root = await index.set(state.root, index.key(key), value); };
 const save = async (overrides: Partial<BackupEngineContext['cursor']> = {}, clearHashSlots?: ('manifest')[]) => {
  const restoreStateHash = await index.putState(state); await ctx.guard();
  await ctx.checkpoint({ ...ctx.cursor, restoreStateHash, itemsProcessed: state.mode.startsWith('restore') ? state.intent : state.scanned, ...overrides }, { clearHashSlots });
  return continuation;
 };
 const issue = async (reason: string) => { state.issues++; state.issue ??= reason; };
 const entry = async (id: string): Promise<Entry | null> => get('entry', id);
 const decoded = async (id: string): Promise<RestoreSourceRecord | null> => { const value = await entry(id); return value?.decoded ? index.openBlob(value.decoded) : null; };
 const select = async (id: string, descend: boolean) => {
  const found: Selected | null = await get('selected', id);
  if (found) { if (descend && !found.descend) { found.descend = true; found.done = false; await set(found, 'selected', id); await set(id, 'queue', state.queued++); } return; }
  const record: Selected = { id, descend, done: false, children: 0, refs: 0, dependencies: 0, ordered: false };
  await set(record, 'selected', id); await set(id, 'queue', state.queued++); state.selected++;
 };
 const resolve = async (kind: string, id: string) => {
  const found = await decoded(id);
  if (found && (kind === 'thing' || found.kinds.includes(kind))) return id;
  const alias = await get('alias', kind, id);
  if (alias?.id && !alias.ambiguous) return alias.id as string;
  await issue(alias?.ambiguous ? 'Ambiguous stored dependency' : 'Unavailable stored dependency'); return null;
 };
 const addDependency = async (selected: Selected, kind: string, ref: string, ordered: boolean) => {
  const id = await resolve(kind, ref); if (!id) return;
  await set(id, 'resolve', kind, ref); await select(id, false);
  if (ordered && !await get('dependency-key', selected.id, id)) {
   await set(true, 'dependency-key', selected.id, id); await set(id, 'dependency', selected.id, selected.dependencies++);
  }
 };
 const event = async (id: string): Promise<{ event: TimelineEvent; eventThingId: string }> => {
  const eventThingId = await get('event', id), record = eventThingId ? await decoded(eventThingId) : null;
  if (record?.family !== 'timeline' || record.value.kind !== 'timeline-event') throw Error('An archived file event is missing');
  const raw = record.value.value.event;
  if (!('parentCount' in raw)) return { eventThingId, event: parseTimelineEvent(raw) };
  const links: TimelineLink[] = [];
  for (const relation of ['thing', 'branch', 'operation'] as const) links.push(await get('timeline-link', id, relation, 0));
  for (let n = 0; n < raw.parentCount; n++) links.push(await get('timeline-link', id, 'parent', n));
  for (let n = 0; n < raw.dependencyCount; n++) links.push(await get('timeline-link', id, 'dependency', n));
  return { eventThingId, event: joinTimelineEvent(raw, links) };
 };
 const relevantFileEvent = async (archived: TimelineEvent, eventThingId: string) => archived.mode === 'revision' ||
  [archived.before, archived.after].some(s => s && ['file-content','folder-placement','managed-folder-placement','timeline-version-name'].includes(s.adapter)) ||
  Boolean(await get('required-file-event',archived.id)) || (await get('event-notes-count',archived.id) ?? 0)>0 ||
  Boolean(await get('event-name',archived.id)) || Boolean(await get('event-cleared-name',eventThingId));
 const fileRecord = async (record: AccountFileRestoreRecord) => {
  const identity = accountFileRestoreRecordKey(record);
  if (await get('file-command-key', identity) != null) return;
  const blob = await index.blob(record); await set(blob, 'file-intent', state.fileCommands); await set(state.fileCommands, 'file-command-key', identity);
  if (record.kind === 'current' || record.kind === 'version') await set({ commandKey: identity }, 'file-bytes', accountFileRestoreContentKey(record.file));
  if (record.kind === 'branch' && await get('file-branch-first', record.branch.id) == null) await set(state.fileCommands, 'file-branch-first', record.branch.id);
  state.fileCommands++; state.fileGraphBytes = (BigInt(state.fileGraphBytes) + BigInt(blob.bytes + 1)).toString();
 };
 if (ctx.operation.kind === 'restore' && !ctx.cursor.restoreStateHash) {
  if (state.mode !== 'sealed' || state.reviewHash !== ctx.operation.reviewHash || reviewJob!.cursor.sealHash !== state.reviewHash || hash(summary(state)) !== state.reviewHash || state.issues || (!state.ordered && !state.files)) throw Error('The exact executable review changed');
  const target = await destination(ctx, operation);
  if (hash(target) !== hash(state.destination)) throw Error('Reviewed destination capabilities changed');
  state.mode = state.ordered ? 'restore-admit' : 'file-restore-admit'; state.intent = 0; state.chain = ZERO;
  return save({ planHash: reviewJob!.cursor.planHash, sealHash: null });
 }
 // Live destination identity/revision is checked at every review unit and again
 // transactionally by the canonical writer for every content effect.
 if (ctx.operation.kind === 'review') {
  const target = await destination(ctx, operation); if (hash(target) !== hash(state.destination)) throw Error('Reviewed destination changed');
 }
 if (state.mode === 'census') {
  if (state.page === view.plan.pages) {
   if (state.scanned !== view.plan.items || (view.plan.pages && state.pageHash !== view.plan.headHash)) throw Error('The sealed source census changed');
   if (!await entry(state.sourceRootId)) throw Error('The selected source root is unavailable');
   await select(state.sourceRootId, true); state.mode = 'select'; return save();
  }
  const { page, pageHash } = await view.readNextPlanPage(state.page, state.pageHash), item = page.items[state.item];
  if (!item || item.ordinal !== state.scanned) throw Error('Restore source order changed');
  const proof = { planPage: state.page, pageHash, itemIndex: state.item };
  async function* ranges() {
   let ordinal = 0, offset = 0;
   while (item.content && offset < item.content.size) {
    const range = await view.readRangePage(proof, ordinal, offset);
    for (let i = 0; i < range.page.ranges.length; i++) { const rangeIndex = i, p = ordinal, start = offset; yield { read: async () => (await view.readChunk(proof, p, start, range.pageHash, rangeIndex)).bytes }; }
    offset += range.page.ranges.reduce((total, r) => total + r.length, 0); ordinal++;
   }
  }
  // Attachment bytes are verified by the source seal; review stores their
  // descriptor only. Current ordinary records use the canonical decoder.
  const family = item.snapshot.adapter;
  const value: RestoreSourceRecord | null = family === 'backup-attachment' ? { family: 'attachments', kinds: ['attachment'], crystal: {}, value: parseBackupAttachment(item.snapshot.value) } :
   await readAccountRestoreRecord(item, ranges(), deps.access.scope.ownerId, () => deps.access.signal?.throwIfAborted());
  const stored: Entry = { item, proof, decoded: value ? await index.blob(value) : null };
  await set(stored, 'entry', item.thingId);
  if (value) {
   const parent = value.value.folderId;
   if (typeof parent === 'string') { const count = await get('children-count', parent) ?? 0; await set(item.thingId, 'child', parent, count); await set(count + 1, 'children-count', parent); }
   if (value.family === 'ordinary') for (const kind of ['component', 'action', 'schema']) if (value.kinds.includes(kind)) {
    const name = value.crystal[kind === 'schema' ? 'name' : `${kind}Key`];
    if (typeof name === 'string') { const old = await get('alias', kind, name); await set(old && old.id !== item.thingId ? { ambiguous: true } : { id: item.thingId }, 'alias', kind, name); }
   }
  }
  if (value?.family === 'attachments' && item.content && state.sourceRangeOffset < item.content.size) {
   const ranges = await view.readRangePage(proof, state.sourceRangePage, state.sourceRangeOffset);
   for (let rangeIndex = 0; rangeIndex < ranges.page.ranges.length; rangeIndex++) {
    const range = ranges.page.ranges[rangeIndex], locator = { proof, page: state.sourceRangePage, offset: state.sourceRangeOffset, pageHash: ranges.pageHash, rangeIndex, start: range.offset, length: range.length };
    // Exact integer interval decomposition gives O(53) scalar lookups without
    // assuming uniform archived chunks or growing per-bucket arrays.
    let start = BigInt(range.offset), remaining = BigInt(range.length);
    while (remaining > BigInt(0)) {
     let width = start === BigInt(0) ? BigInt(1) << BigInt(53) : start & -start;
     while (width > remaining) width >>= BigInt(1);
     const bits = width.toString(2).length - 1, prefix = start.toString(2).padStart(53, '0').slice(0, 53 - bits);
     await set(locator, 'range', item.thingId, prefix); start += width; remaining -= width;
    }
   }
   state.sourceRangeOffset += ranges.page.ranges.reduce((n, r) => n + r.length, 0); state.sourceRangePage++;
   return save();
  }
  state.sourceRangePage = 0; state.sourceRangeOffset = 0;
  if (value?.family === 'timeline') {
   const archived = value.value, raw = archived.value;
   const append = async (type: string, id: string) => { const count = await get(type + '-count', id) ?? 0; await set(item.thingId, type, id, count); await set(count + 1, type + '-count', id); };
   if (archived.kind === 'timeline-event') {
    await set(item.thingId, 'event', raw.event.id); await append('file-events', raw.event.thingId);
    if(raw.event.before?.adapter==='timeline-version-name'&&raw.event.after===null){const prior=parseTimelineVersionName(raw.event.before.value);await set(raw.event.id,'version-clear',prior.eventId,prior.revision+1);}
   }
   if (archived.kind === 'timeline-note') { const note=parseTimelineNote(raw), count=await get('event-notes-count',note.eventId)??0;await set(item.thingId,'event-note',note.eventId,count);await set(count+1,'event-notes-count',note.eventId); }
   if (archived.kind === 'timeline-version-name') {
    if(raw.cleared)await set(item.thingId,'event-cleared-name',raw.eventThingId);else await set(item.thingId,'event-name',raw.name.eventId);
   }
   if (archived.kind === 'timeline-link') await set(raw, 'timeline-link', raw.eventId, raw.relation, raw.ordinal);
   if (archived.kind === 'timeline-branch') await set(item.thingId, 'timeline-branch', raw.id);
   if (archived.kind === 'timeline-branch-head') await append('file-heads', raw.thingId);
  }
  state.scanned++; state.item++;
  if (state.item === page.items.length) { state.page++; state.pageHash = pageHash; state.item = 0; }
  return save();
 }
 if (state.mode === 'select') {
  if (state.selectionIndex === state.queued) { state.mode = state.issues ? 'seal' : 'order'; state.orderIndex = 0; return save(); }
  const id: string = await get('queue', state.selectionIndex), selected: Selected = await get('selected', id), value = await decoded(id);
  if (value?.family === 'files') {
   const file = parseCloudFile(value.value);
   if (!selected.done) { await set(file, 'current-file', id); await set(id, 'file', state.files++); selected.done = true; }
   const attachment = await decoded(file.content.attachmentId);
   if (attachment?.family !== 'attachments') await issue('Selected file bytes are missing');
   else verifyBackupFileReference(file.content, id, attachment.value);
   if (file.folderId) await addDependency(selected, 'folder', file.folderId, false);
   const count = await get('file-events-count', id) ?? 0;
   if (selected.refs < count) {
    const sourceEvent = await decoded(await get('file-events', id, selected.refs++));
    if (sourceEvent?.family !== 'timeline') throw Error('Selected history descriptor changed');
    const found = await event(sourceEvent.value.value.event.id), archived = found.event;
    const relevant = await relevantFileEvent(archived,found.eventThingId);
    if (!relevant) { await set(selected, 'selected', id); return save(); }
    for (const reference of [...archived.parentIds.map(eventId=>({eventId,thingId:id})),...archived.dependencies]) {
     const target=await event(reference.eventId);
     if(reference.thingId!==id||target.event.thingId!==id)await issue('A file-history dependency belongs to another Thing');
     else if(!await relevantFileEvent(target.event,target.eventThingId)) {await set(true,'required-file-event',reference.eventId);selected.refs=0;}
    }
    for (const snapshot of [archived.before, archived.after]) if (snapshot) {
     if (['folder-placement', 'managed-folder-placement'].includes(snapshot.adapter)) {
      const folderId = folderPlacementValue(snapshot).folderId; if (folderId) await addDependency(selected, 'folder', folderId, false);
     } else if(snapshot.adapter==='timeline-version-name'&&snapshot.version===1){
      const name=parseTimelineVersionName(snapshot.value),target=await event(name.eventId);
      if(name.ownerId!==deps.access.scope.ownerId||name.thingId!==id||target.event.thingId!==id||target.event.mode!=='revision'||!target.event.after)await issue('An archived version label targets another or unavailable file version');
     } else if (snapshot.adapter === 'file-content' && snapshot.version === 1) {
      const version = parseCloudFile(snapshot.value); if (version.id !== id) await issue('A historical file snapshot belongs to another file');
      const bytes = await decoded(version.content.attachmentId); if (bytes?.family !== 'attachments') await issue('Historical file bytes are missing'); else verifyBackupFileReference(version.content, id, bytes.value);
      if (version.folderId) await addDependency(selected, 'folder', version.folderId, false);
     } else await issue('Selected file history has an unsupported snapshot adapter');
    }
    await set(found, 'selected-event', archived.id);
    await set(selected, 'selected', id); return save();
   }
  } else if (!value || value.family !== 'ordinary') { await issue('Selected graph requires an unsupported managed adapter'); selected.done = true; }
  else {
   if (!selected.counted) { state.ordinary++; selected.counted = true; }
   if (value.kinds.filter(kind => kind !== 'builder-thing').length !== 1 || value.kinds.some(kind => !['folder', 'data', 'schema', 'component', 'action', 'webpage', 'builder-thing'].includes(kind))) await issue('The selected content kind has no canonical restore writer');
   if (selected.descend && value.kinds.includes('folder') && selected.children < (await get('children-count', id) ?? 0)) {
    await select(await get('child', id, selected.children++), true); await set(selected, 'selected', id); return save();
   }
   const references = ordinaryReferences(value, deps.access.signal);
   let n = 0, handled = false;
   try {
    for (const ref of references) {
     if (!ref) continue; if (n++ < selected.refs) continue;
     if (ref.args) { await issue('Context-dependent stored Component arguments require a supported remapping adapter'); }
     await addDependency(selected, ref.kind, ref.ref, (value.kinds.includes('data') && ref.kind === 'schema') || (value.kinds.includes('webpage') && ref.kind === 'component'));
     selected.refs++; handled = true; break;
    }
   } catch (error) { if (!(error instanceof StoredReferenceUnsupportedError)) throw error; await issue('Unsupported stored dependency traversal'); selected.done = true; }
   if (handled) { await set(selected, 'selected', id); return save(); }
   for (const ref of iterateBackupThingMedia(value.kinds, value.crystal, { signal: deps.access.signal })) if (ref) { await issue('Selected graph contains media requiring a supported attachment restore adapter'); break; }
   if (value.kinds.includes('data') && typeof value.crystal.parentId === 'string') await addDependency(selected, 'thing', value.crystal.parentId, false);
   if (typeof value.value.targetId === 'string') await issue('Selected ordinary target relationships require a supported adapter');
   if (value.kinds.includes('action') && value.crystal.steps?.some((step: any) => step?.op === 'http.request')) await issue('HTTP payload dependency remapping is unsupported');
   if (id !== state.sourceRootId && typeof value.value.folderId === 'string') await addDependency(selected, 'folder', value.value.folderId, true);
   selected.done = true;
  }
  await set(selected, 'selected', id); state.selectionIndex++; return save();
 }
 if (state.mode === 'order') {
  if (state.orderIndex === state.queued) {
   if (state.ordered === state.ordinary) { state.mode = 'intents'; state.intent = 0; return save(); }
   if (state.orderProgress === 0) { await issue('Selected structural/dependency cycle or unsupported writer'); state.mode = 'seal'; return save(); }
   state.orderProgress = 0; state.orderIndex = 0; return save();
  }
  const id: string = await get('queue', state.orderIndex++), selected: Selected = await get('selected', id);
  if (!selected.ordered) {
   const value = await decoded(id); let ready = value?.family === 'ordinary';
   for (let n = 0; ready && n < selected.dependencies; n++) ready = Boolean((await get('selected', await get('dependency', id, n)))?.ordered);
   if (ready) { selected.ordered = true; await set(selected, 'selected', id); await set(id, 'ordered', state.ordered++); state.orderProgress++; }
  }
  return save();
 }
 if (state.mode === 'intents') {
  if (state.intent === state.ordered) { state.mode = state.issues ? 'seal' : state.ordered ? 'hash' : state.files ? 'file-plan' : 'seal'; state.intent = 0; return save({ fileIndex: 0, rangeOffset: '0', bytesProcessed: '0', manifestByteLength: state.graphBytes }); }
  const id: string = await get('ordered', state.intent), value = (await decoded(id))!;
  const mappings = new Map<string, string>();
  const reference = async (kind: string, ref: string) => { const source = await get('resolve', kind, ref); if (!source) throw Error('The certified dependency mapping is unavailable'); mappings.set(JSON.stringify([kind, ref]), ordinaryRestoreTargetId(ordinaryReview(state), source)); };
  for (const ref of ordinaryReferences(value, deps.access.signal)) if (ref) await reference(ref.kind, ref.ref);
  const crystal = rewriteComposition(value.kinds, value.crystal, (kind, ref) => { const target = mappings.get(JSON.stringify([kind, ref])); if (!target) throw Error('Unreviewed executable reference'); return target; });
  const declared = renderComponentDeclaration(value.crystal);
  if (declared?.kind === 'reference') crystal.renderComponent = mappings.get(JSON.stringify(['component', declared.id]));
  if (declared?.kind === 'embedded') { await issue('Embedded Component remapping requires a supported adapter'); }
  const map = (id: string) => ordinaryRestoreTargetId(ordinaryReview(state), id);
  for (const field of ['componentKey', 'actionKey']) if (typeof crystal[field] === 'string') crystal[field] = 'restore-key-' + hash([state.reviewId, id, field]).slice(0, 40);
  if (value.kinds.includes('schema')) crystal.name = map(id).slice(0, 60);
  if (value.kinds.includes('data')) {
   if (typeof value.crystal.parentId === 'string') crystal.parentId = map(await get('resolve', 'thing', value.crystal.parentId));
   const schema = value.crystal.schemaId ?? value.crystal.schema;
   if (typeof schema === 'string') crystal.schema = map(await get('resolve', 'schema', schema)).slice(0, 60);
  }
  const record: OrdinaryRestoreCreation = { sourceId: id, input: { shareId: map(id), thingtime: value.kinds, crystal, extended: value.value.extended ?? null,
   tags: value.value.tags ?? [], geo: value.value.geo ?? null, acl: ['tt:user'], folderId: id === state.sourceRootId || value.value.folderId == null ? state.destination.rootId : map(value.value.folderId) } };
  const blob = await index.blob(record); await set(blob, 'intent', state.intent++);
  state.graphBytes = (BigInt(state.graphBytes) + BigInt(blob.bytes + 1)).toString(); return save();
 }
 if (state.mode === 'file-plan') {
  if (state.filePhase === 'folders') {
   if (state.fileOrdinal === state.ordered) { state.filePhase = 'current'; state.fileOrdinal = 0; return save(); }
   const id: string = await get('ordered', state.fileOrdinal++), value = (await decoded(id))!;
   if (value.kinds.includes('folder')) {
    const original = ordinaryReview(state), record: AccountFileRestoreFolder = { kind: 'folder', sourceId: id, targetId: ordinaryRestoreTargetId(original, id),
     targetRevision: 'restore-created-' + hash([original.operationId, id]), priorBinding: hash(original), priorOperationId: original.operationId,
     priorCompletionEventId: 'restore-graph-' + hash([original.destination.scope.ownerId, original.operationId]),
     parentSourceId: id === state.sourceRootId ? null : value.value.folderId ?? null, name: value.crystal.name };
    await set(record, 'file-folder', id); await fileRecord(record);
   }
   return save();
  }
  if (state.filePhase === 'current') {
   if (state.fileOrdinal === state.files) { state.filePhase = 'versions'; state.fileOrdinal = 0; state.filePart = 0; return save(); }
   const id: string = await get('file', state.fileOrdinal++); await fileRecord({ kind: 'current', file: await get('current-file', id) }); return save();
  }
  if (state.filePhase === 'versions' || state.filePhase === 'history') {
   if (state.fileOrdinal === state.files) {
    if (state.filePhase === 'history' && state.fileHistoryWritten < state.fileHistoryExpected && state.orderProgress === 0) { await issue('The selected file-history ancestry is cyclic or incomplete'); state.mode = 'seal'; return save(); }
    if (state.filePhase === 'history' && state.orderProgress) { state.orderProgress = 0; state.fileOrdinal = 0; state.filePart = 0; return save(); }
    state.filePhase = state.filePhase === 'versions' ? 'history' : 'branches'; state.fileOrdinal = 0; state.filePart = 0; return save();
   }
   const id: string = await get('file', state.fileOrdinal), count = await get('file-events-count', id) ?? 0;
   if (state.filePart === count) { state.fileOrdinal++; state.filePart = 0; return save(); }
   const raw = (await decoded(await get('file-events', id, state.filePart++)))!, found = await event(raw.value.value.event.id), archived = found.event;
   const relevant = await relevantFileEvent(archived,found.eventThingId);
   if (!relevant) return save();
   if (state.filePhase === 'versions') {
    state.fileHistoryExpected++;
    for (const side of ['before', 'after'] as const) {
     const snapshot = archived[side]; if (snapshot?.adapter !== 'file-content' || snapshot.version !== 1) continue;
     const version = parseCloudFile(snapshot.value);
     if (!await get('file-bytes', accountFileRestoreContentKey(version))) await fileRecord({ kind: 'version', eventThingId: found.eventThingId, side, file: version });
    }
   } else if (await get('file-command-key', `history:${archived.id}`) == null) {
    let ready = true;
    for (const parent of [...archived.parentIds,...archived.dependencies.map(d=>d.eventId)]) if (await get('file-command-key', `history:${parent}`) == null) ready = false;
    if (ready) { await fileRecord({ kind: 'history', eventThingId: found.eventThingId, event: archived }); state.orderProgress++; state.fileHistoryWritten++; }
    else if (!await get('file-history-pending', archived.id)) await set(true, 'file-history-pending', archived.id);
   }
   return save();
  }
  if (state.filePhase === 'branches') {
   if (state.fileOrdinal === state.files) { state.filePhase = 'annotations'; state.fileOrdinal = 0; state.filePart=0;state.annotationIndex=0;return save(); }
   const id: string = await get('file', state.fileOrdinal), count = await get('file-heads-count', id) ?? 0;
   if (state.filePart === count) { state.fileOrdinal++; state.filePart = 0; return save(); }
   const headThingId: string = await get('file-heads', id, state.filePart++), headRecord = (await decoded(headThingId))!, head = headRecord.value.value;
   const branchThingId: string = await get('timeline-branch', head.branchId), branchRecord = branchThingId ? await decoded(branchThingId) : null;
   if (!branchRecord || await get('file-command-key', `history:${head.eventId}`) == null) await issue('A selected file branch or its complete history is unavailable');
   else await fileRecord({ kind: 'branch', branchThingId, headThingId, branch: branchRecord.value.value, head });
   return save();
  }
  if(state.filePhase==='annotations'){
   if(state.fileOrdinal===state.files){state.filePhase='finalize';state.fileOrdinal=0;return save();}
   const id:string=await get('file',state.fileOrdinal),count=await get('file-events-count',id)??0;
   if(state.filePart===count){state.fileOrdinal++;state.filePart=0;state.annotationIndex=0;return save();}
   const eventThingId:string=await get('file-events',id,state.filePart),source=(await decoded(eventThingId))!,eventId:string=source.value.value.event.id;
   const notes=await get('event-notes-count',eventId)??0;
   if(state.annotationIndex<notes){
    const sourceThingId:string=await get('event-note',eventId,state.annotationIndex++),note=parseTimelineNote((await decoded(sourceThingId))!.value.value);
    if(note.ownerId!==deps.access.scope.ownerId||note.thingId!==id||await get('file-command-key',`history:${note.eventId}`)==null)await issue('An archived note is outside the selected imported history');
    else await fileRecord({kind:'note',sourceThingId,note});return save();
   }
   if(state.annotationIndex===notes){
    state.annotationIndex++;
    const sourceThingId:string|null=await get('event-name',eventId)??await get('event-cleared-name',eventThingId);
    if(sourceThingId){
     const archived=(await decoded(sourceThingId))!,value=archived.value.value;
     if(await get('file-command-key',`history:${eventId}`)==null)await issue('An archived version name targets history outside the selected graph');
     else if(value.cleared){
      const clearEventId:string|null=await get('version-clear',eventId,value.revision),found=clearEventId?await event(clearEventId):null;
      const prior=found?.event.before?.adapter==='timeline-version-name'?parseTimelineVersionName(found.event.before.value):null;
      if(value.ownerId!==deps.access.scope.ownerId||!found||found.event.thingId!==id||found.event.after!==null||!prior||prior.eventId!==eventId||prior.thingId!==id||prior.revision+1!==value.revision||await get('file-command-key',`history:${clearEventId}`)==null)await issue('A cleared version label has no exact archived predecessor');
      else await fileRecord({kind:'version-name',sourceThingId,eventId,thingId:id,value,previousName:prior,clearEventId});
     }else{
      const name=parseTimelineVersionName(value.name);
      if(name.ownerId!==deps.access.scope.ownerId||name.eventId!==eventId||name.thingId!==id)await issue('An archived version name belongs to another history target');
      else await fileRecord({kind:'version-name',sourceThingId,eventId,thingId:id,value:{cleared:false,name},previousName:null,clearEventId:null});
     }
    }
    return save();
   }
   state.filePart++;state.annotationIndex=0;return save();
  }
  if (state.fileOrdinal < state.files) {
   const id: string = await get('file', state.fileOrdinal++), file: CloudFile = await get('current-file', id);
   if (file.trashed) await fileRecord({ kind: 'finalize-current', sourceId: id }); return save();
  }
  state.mode = state.issues ? 'seal' : 'file-hash'; state.intent = 0;
  return save({ fileIndex: 0, rangeOffset: '0', bytesProcessed: '0', manifestByteLength: state.fileGraphBytes });
 }
 if (state.mode === 'hash' || state.mode === 'file-hash') {
  const isFile = state.mode === 'file-hash', streamId = isFile ? 'restore-file-graph' : 'restore-graph', total = isFile ? state.fileCommands : state.ordered;
  const terminal = ctx.cursor.fileIndex === total;
  const blob: ReferenceBlob | null = terminal ? null : await get(isFile ? 'file-intent' : 'intent', ctx.cursor.fileIndex);
  const record = blob ? await index.openBlob(blob) : null;
  const segmentLength = blob ? blob.bytes + 1 : 0;
  const start = BigInt(ctx.cursor.bytesProcessed) - BigInt(ctx.cursor.rangeOffset);
  const sourceHash: ImmutableHashSource = { assertIdentity: async () => { await ctx.guard(); await view.assertCurrent(); }, read: async (offset, length) => {
   const local = Number(offset - start); if (terminal || local < 0 || local + length > segmentLength) throw Error('Restore hash segment changed');
   const output = new Uint8Array(length); let position = 0, copied = 0;
   for (const part of canonicalJsonBytes(record)) {
    const begin = Math.max(0, local - position), end = Math.min(part.length, local + length - position);
    if (end > begin) { output.set(part.subarray(begin, end), copied); copied += end - begin; }
    position += part.length; if (copied === length) return output;
   }
   if (local + length === segmentLength && copied === length - 1) { output[copied++] = 10; }
   if (copied !== length) throw Error('Restore canonical bytes changed'); return output;
  } };
  const binding = { operationId: backupHashOperationId(ctx.jobId, 'manifest', streamId, 'stream'), snapshotId: source.snapshotId, streamId,
   objectVersion: hash([state.sourcePlanHash, state.sourceSealHash, state.root, state.destination]), bytes: isFile ? state.fileGraphBytes : state.graphBytes, expectedSha256: null };
  const accepted = (ref: HashCheckpointRef) => {
   const advanced = ref.offset !== ctx.cursor.bytesProcessed, local = advanced ? BigInt(ref.offset) - start : BigInt(ctx.cursor.rangeOffset), end = local === BigInt(segmentLength);
   return { ...ctx.cursor, bytesProcessed: ref.offset, rangeOffset: end ? '0' : local.toString(), fileIndex: end ? ctx.cursor.fileIndex + 1 : ctx.cursor.fileIndex };
  };
  const worker = createResumableHashWorker({ store: source.store, keys: ctx.hashKeys, access: deps.access, coordinator: ctx.hashCoordinator('manifest', accepted) });
  const previous = await worker.start(binding, sourceHash);
  if (previous.complete) { if (isFile) state.fileGraphHash = previous.finalDigest; else state.graphHash = previous.finalDigest; state.mode = !isFile && state.files ? 'file-plan' : 'seal'; state.intent = 0; return save({ fileIndex: 0, rangeOffset: '0', bytesProcessed: '0' }, ['manifest']); }
  const result = await worker.advance(binding, previous, backupHashOperationId(ctx.jobId, 'manifest', streamId, `step-${previous.sequence + 1}`), sourceHash,
   Math.min(BACKUP_CHUNK_BYTES, segmentLength - Number(ctx.cursor.rangeOffset)));
  if (result.complete) { if (isFile) state.fileGraphHash = result.finalDigest; else state.graphHash = result.finalDigest; state.mode = !isFile && state.files ? 'file-plan' : 'seal'; state.intent = 0; return save({ fileIndex: 0, rangeOffset: '0', bytesProcessed: '0' }, ['manifest']); }
  return continuation;
 }
 if (state.mode === 'seal') {
  await view.assertCurrent(); state.reviewHash = hash(summary(state)); state.mode = 'sealed';
  return save({ phase: 'complete', planHash: backupJobDigest([state.sourcePlanHash, state.sourceSealHash, state.destination, state.sourceRootId]), sealHash: state.reviewHash });
 }
 if (state.mode === 'sealed') return { kind: 'complete' };
 if (state.mode.startsWith('file-restore')) {
  const review = fileReview(state), writer = await openReviewedAccountFileRestoreWriter(ctx.request, review, {
   folder: id => get('file-folder', id), current: id => get('current-file', id),
   bytes: file => get('file-bytes', accountFileRestoreContentKey(file)), branchFirst: id => get('file-branch-first', id)
  });
  const completed = await writer.completed();
  if (completed) return save({ phase: 'complete', sealHash: hash([state.reviewHash, completed.eventId, completed.count]) }).then(() => ({ kind: 'complete' }));
  if (state.mode === 'file-restore-admit') { await writer.admit(); state.mode = 'file-restore-apply'; state.intent = 0; return save(); }
  if (state.mode === 'file-restore-apply') {
   if (state.intent === state.fileCommands) { state.epoch = await writer.epoch(); state.mode = 'file-restore-verify'; state.intent = 0; return save(); }
   const record: AccountFileRestoreRecord = await index.openBlob(await get('file-intent', state.intent));
   if (await writer.receipt(record, state.intent)) { state.intent++; state.byteState = null; return save(); }
   let content: CloudFile['content'] | undefined;
   if (record.kind === 'current' || record.kind === 'version') {
    if (!deps.runtime) throw Error('The canonical bounded file byte transport is unavailable');
    const sourceEntry = await entry(record.file.content.attachmentId);
    if (!sourceEntry || sourceEntry.item.snapshot.adapter !== 'backup-attachment') throw Error('The reviewed byte source is unavailable');
    const result = await advanceAccountFileRestoreBytes({ ctx, store: source.store, access: deps.access, snapshotId: state.snapshotId, sourceSealHash: state.sourceSealHash,
     streamId: `file-command-${state.intent}`, commandId: accountFileRestoreCommandId(review, record), name: record.file.name, file: record.file, runtime: deps.runtime,
     state: state.byteState, checkpoint: async (next, clearHashSlots) => { state.byteState = next; const restoreStateHash = await index.putState(state); await ctx.checkpoint({ ...ctx.cursor, restoreStateHash }, { clearHashSlots }); },
     putPartDigest: async (part, digest) => {
      const key = ['file-part-digest', state.intent, part], prior = await get(...key);
      if (prior !== null && prior !== digest) throw Error('Reviewed part digest changed'); await set(digest, ...key);
     },
     getPartDigest: part => get('file-part-digest', state.intent, part),
     read: async (offset, length) => {
      const output = new Uint8Array(length); let copied = 0;
      while (copied < length) {
       const position = offset + copied, bits = BigInt(position).toString(2).padStart(53, '0'); let locator: any = null;
       for (let depth = 53; depth >= 0 && !locator; depth--) locator = await get('range', sourceEntry.item.thingId, bits.slice(0, depth));
       if (!locator || position < locator.start || position >= locator.start + locator.length) throw Error('The reviewed source range is unavailable');
       const found = await view.readChunk(sourceEntry.proof, locator.page, locator.offset, locator.pageHash, locator.rangeIndex);
       if (found.range.offset !== locator.start || found.range.length !== locator.length) throw Error('The reviewed source range changed');
       const start = position - locator.start, count = Math.min(length - copied, found.bytes.length - start); if (count <= 0) throw Error('Source range is incomplete');
       output.set(found.bytes.subarray(start, start + count), copied); copied += count;
      }
      return output;
     }
    });
    if (!result.done) return continuation; content = result.content;
   }
   await writer.apply(record, state.intent, content); state.intent++; state.byteState = null; return save();
  }
  if (state.mode === 'file-restore-verify') {
   if (state.intent === state.fileCommands) { state.mode = 'file-restore-complete'; return save(); }
   const record: AccountFileRestoreRecord = await index.openBlob(await get('file-intent', state.intent++));
   if (record.kind === 'folder') await writer.verifyFolder(record.sourceId);
   if (record.kind === 'current') await writer.verifyFile(record.file.id);
   if(record.kind==='note'||record.kind==='version-name')await writer.verifyAnnotation(record);
   return save();
  }
  const result = await writer.complete(state.epoch!);
  return save({ phase: 'complete', sealHash: hash([state.reviewHash, result.eventId, result.count]) }).then(() => ({ kind: 'complete' }));
 }
 const writer = await openReviewedOrdinaryRestoreWriter(ctx.request, ordinaryReview(state), deps.access.signal);
 const completed = await writer.completed();
 if (completed && state.files && !state.mode.startsWith('file-restore')) { state.mode = 'file-restore-admit'; state.intent = 0; state.epoch = null; return save(); }
 if (completed) return save({ phase: 'complete', sealHash: hash([state.reviewHash, completed.eventId, completed.count]) }).then(() => ({ kind: 'complete' }));
 if (state.mode === 'restore-admit') { await writer.admit(); state.mode = 'restore-intents'; return save(); }
 if (state.mode === 'restore-intents') {
  if (state.intent === state.ordered) { await writer.beginEffects(state.chain); state.mode = 'restore-apply'; state.intent = 0; return save(); }
  const record = await index.openBlob(await get('intent', state.intent)); state.chain = await writer.intent(record, state.intent++, state.chain); return save();
 }
 if (state.mode === 'restore-apply') {
  if (state.intent === state.ordered) { state.epoch = await writer.epoch(); state.intent = 0; state.mode = 'restore-verify'; return save(); }
  await writer.apply(await index.openBlob(await get('intent', state.intent)), state.intent); state.intent++; return save();
 }
 if (state.mode === 'restore-verify') {
  if (state.intent === state.ordered) { state.mode = 'restore-complete'; return save(); }
  const record: OrdinaryRestoreCreation = await index.openBlob(await get('intent', state.intent)), current = await writer.current(record.sourceId);
  // Canonical writers may normalize metadata, but executable/placement content
  // must still be exactly the certified content. Never overwrite owner edits.
  if (hash(current.input.crystal) !== hash(record.input.crystal) || current.input.folderId !== record.input.folderId) throw Error('Restored content changed before completion');
  state.intent++; return save();
 }
 if (state.mode === 'restore-complete') {
  const result = await writer.complete(state.epoch!, state.chain);
  if (state.files) { state.mode = 'file-restore-admit'; state.intent = 0; state.epoch = null; return save(); }
  return save({ phase: 'complete', sealHash: hash([state.reviewHash, result.eventId, result.count]) }).then(() => ({ kind: 'complete' }));
 }
 throw Error('Unsupported restore continuation');
}
