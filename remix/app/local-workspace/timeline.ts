import { themeContentSnapshot } from '../timeline/themeContent';
import { isTransferTheme } from '../utils/thingTransfer/theme';
import { algorithmContentSnapshot } from '../timeline/algorithmContent';
import { isTransferAlgorithm } from '../utils/thingTransfer/algorithm';
import { createRelatedTimelineScope, validRelatedTimelineRequest } from '../timeline/relatedHistory';
import { localRelatedThingIds } from './timelineRelated';
import { createVersionExportReader } from '../timeline/exportVersion';
import { createBranchMergePreviewService } from '../timeline/branchMergePreview';
import type { BranchMergeRequest } from '../timeline/branchMerge';
import { readRecordedComponents } from '../timeline/recordedComponentReader';
import { parseTimelineBranchCommand, parseTimelineBranchLookup, type TimelineBranchCommand } from '../timeline/branches';
import { parseBranchCheckoutRequest, type BranchCheckoutRequest } from '../timeline/branchCheckout';
import { readLocalBranch, readLocalBranches, writeLocalBranch, checkoutLocalBranch } from './timelineBranches';
import { parseTimelineVersionNameCommand, type TimelineVersionName, type TimelineVersionNameCommand } from '../timeline/versionNames';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { readLocalVersionNames, localNamesForEntry, writeLocalVersionName } from './timelineVersionNames';
import { parseTimelineEntry, parseTimelineEvent, timelineEventText, TIMELINE_EVENT_MAX_BYTES, type TimelineEvent, type TimelineEntry, type TimelineScope } from '../timeline/contract';
import { splitTimelineEvent, joinTimelineEvent, parseTimelineEventRecord, timelineLinkId, type TimelineEventRecord, type TimelineLink } from '../timeline/records';
import { parseTimelineNoteCommand, type TimelineNote, type TimelineNoteCommand } from '../timeline/notes';
import { readLocalTimelineNotes, localNotesForEntry, writeLocalTimelineNote } from './timelineNotes';
import { thingContentSnapshot } from '../timeline/thingContent';
import { captureComponentBindings, webpageComponentRefs, type ComponentBindings } from '../timeline/componentBindings';
import { resolveWorkspacePage } from './webpageResolution';
import { isProtectedThingtime } from '../schemas/registry';
import type { TimelinePage, TimelinePageRequest } from '../timeline/sync';
import type { LocalThing } from './things';
import { type WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceTransaction } from './storage';

export const LOCAL_TIMELINE_OWNER = 'local-workspace';
export const LOCAL_TIMELINE_PLANE = 'local-workspace';
export const LOCAL_TIMELINE_FOLDER = 'timeline-folder-local-workspace';
const EVENTS = 'timeline-events', LINKS = 'timeline-links', INDEX = 'timeline-index', META = 'timeline-meta';
type Header = { id: string; thingId: string; position: number; bytes: number };
type Stored = { event: TimelineEventRecord; receipt: TimelineEntry['receipt'] };
const fail = (message: string, status = 400): never => { throw new WorkspaceError('LOCAL_TIMELINE', message, status); };
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const PAGE_BYTES = TIMELINE_EVENT_MAX_BYTES + 4096;
function parseHeader(value: Header | undefined, id: string): Header {
 if (!value || value.id !== id || typeof value.thingId !== 'string' || !value.thingId || value.thingId.length > 200 ||
  !Number.isSafeInteger(value.position) || value.position < 1 || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > TIMELINE_EVENT_MAX_BYTES + 2048) fail('Local Timeline index is damaged.');
 return value!;
}
export const localTimelineScope = (origin: string): TimelineScope => ({ apiOrigin: origin, dataPlane: LOCAL_TIMELINE_PLANE, ownerId: LOCAL_TIMELINE_OWNER });

/** Authoritative browser history uses the SAME normalized event/link records as
 * account Timeline. Its receipts order only this isolated local data plane and
 * are never sent to an account. The ordinary IndexedDB Timeline store remains
 * an evictable view/queue cache, not the only copy of saved local history. */
export async function localTimelineEntry(tx: WorkspaceTransaction, id: string): Promise<TimelineEntry | null> {
 const row = await tx.get<Stored>(EVENTS, id);
 if (!row) return null;
 const event = parseTimelineEventRecord(row.event);
 const ids = [timelineLinkId(id, 'thing', 0), timelineLinkId(id, 'branch', 0), timelineLinkId(id, 'operation', 0),
  ...Array.from({ length: event.parentCount }, (_, n) => timelineLinkId(id, 'parent', n)),
  ...Array.from({ length: event.dependencyCount }, (_, n) => timelineLinkId(id, 'dependency', n))];
 if (ids.length > 2053) fail('Local Timeline links are damaged.');
 const links: TimelineLink[] = [];
 for (const key of ids) { const link = await tx.get<TimelineLink>(LINKS, key); if (!link) fail('Local Timeline links are incomplete.'); links.push(link!); }
 const entry = parseTimelineEntry({ event: joinTimelineEvent(event, links), receipt: row.receipt });
 if (entry.event.id !== id || entry.event.ownerId !== LOCAL_TIMELINE_OWNER) fail('Local Timeline identity changed.');
 const header = parseHeader(await tx.get<Header>(INDEX, id), id);
 if (header.thingId !== entry.event.thingId || header.position !== entry.receipt.position || header.bytes !== byteLength(entry)) fail('Local Timeline index does not match its event.');
 return entry;
}

/** A managed library projection over canonical local History, never an authored
 * Thing. Keeping it outside `things` prevents generic copy/import/export, Actions
 * and deletion from treating the Timeline container as editable content.
 *
 * This runs on the ordinary library list and library search, so it reads only the
 * label stamp instead of materializing and validating a whole entry: the hot read
 * path must not pay for every link record, and damage to this evictable view cache
 * must not make the rest of the workspace unreadable. An unusable index projects no
 * folder; History's own strict readers still report the damage when it is opened. */
export async function localTimelineFolder(tx: WorkspaceTransaction): Promise<LocalThing | null> {
 let first: { id: string; position: number } | null = null;
 for (const header of await tx.list<Header>(INDEX)) {
  const position = header.value?.id === header.id ? header.value.position : undefined;
  if (!Number.isSafeInteger(position) || position! < 1) continue;
  if (!first || position! < first.position) first = { id: header.id, position: position! };
 }
 if (!first) return null;
 const stamp = (await tx.get<Stored>(EVENTS, first.id))?.receipt?.acceptedAt;
 if (typeof stamp !== 'string' || Number.isNaN(Date.parse(stamp))) return null;
 return { id: LOCAL_TIMELINE_FOLDER, thingtime: ['folder'], crystal: { name: 'Timeline', icon: '🕰️' }, createdAt: stamp, updatedAt: stamp, revision: 1 };
}

export async function localTimelineHead(tx: WorkspaceTransaction, thingId: string) {
 const id = await tx.get<string>(META, `head:${thingId}`);
 if (!id) return null;
 const entry = await localTimelineEntry(tx, id);
 if (!entry || entry.event.thingId !== thingId || entry.event.mode !== 'revision' || entry.event.branchId !== 'main') fail('The previous local version is unavailable.');
 return entry;
}
export async function localRecordedComponents(tx: WorkspaceTransaction, wanted: Parameters<typeof readRecordedComponents>[0]['wanted'], maxBytes?: number) {
 return readRecordedComponents({ ownerId: LOCAL_TIMELINE_OWNER, wanted, maxBytes,
  readSizes: async ids => { const sizes = []; for (const id of ids) sizes.push({ timelineEntryBytes: parseHeader(await tx.get<Header>(INDEX, id), id).bytes }); return sizes; },
  readEntries: async ids => { const found = []; for (const id of ids) { const entry = await localTimelineEntry(tx, id); if (entry) found.push(entry); } return found; },
  error: (status, message) => new WorkspaceError('LOCAL_VERSION', message, status)
 });
}

export async function appendLocalTimeline(tx: WorkspaceTransaction, input: TimelineEvent): Promise<TimelineEntry> {
 const event = parseTimelineEvent(input);
 if (event.ownerId !== LOCAL_TIMELINE_OWNER || event.actorId !== LOCAL_TIMELINE_OWNER) fail('This event belongs to another workspace.');
 const previous = await localTimelineEntry(tx, event.id);
 if (previous) { if (timelineEventText(previous.event) !== timelineEventText(event)) fail('Timeline event identity was reused with different content.', 409); return previous; }
 for (const [id, thingId] of [...event.parentIds.map(id => [id, event.thingId]), ...event.dependencies.map(ref => [ref.eventId, ref.thingId])]) {
  const ancestor = await localTimelineEntry(tx, id);
  if (!ancestor || ancestor.event.thingId !== thingId) fail('Timeline ancestry or dependencies are missing.', 409);
 }
 const position = (await tx.get<number>(META, 'position') || 0) + 1;
 if (!Number.isSafeInteger(position)) fail('Local Timeline ordering is exhausted.');
 const entry = parseTimelineEntry({ event, receipt: { formatVersion: 1, eventId: event.id, ownerId: event.ownerId, position, acceptedAt: event.occurredAt } });
 const split = splitTimelineEvent(event);
 await tx.put(EVENTS, event.id, { event: split.event, receipt: entry.receipt });
 for (const link of split.links) await tx.put(LINKS, link.id, link);
 await tx.put(INDEX, event.id, { id: event.id, thingId: event.thingId, position, bytes: byteLength(entry) } satisfies Header);
 await tx.put(META, 'position', position);
 return entry;
}

/** Track successful ordinary content writes inside their own transaction.
 * Protected families need their dedicated snapshot adapters; never copy vault,
 * attachment bookkeeping or Action outcomes through the generic projection. */
export type LocalMutationCapture = Pick<TimelineEvent, 'id' | 'operationId' | 'label' | 'operation' | 'parentIds'> & Partial<Pick<TimelineEvent, 'source' | 'clientId'>>;
export type ThingHistoryWriter = {
 ownerId: string; clientId: string; branchId: string; mode: 'draft' | 'revision';
 read(id: string): Promise<{ event: TimelineEvent } | null>;
 append(event: TimelineEvent): Promise<unknown>;
 /** Only the dedicated account theme and algorithm writers supply these projections.
  * Generic account captures continue to exclude every protected kind. */
 themeSnapshots?: ReadonlyMap<string, Pick<TimelineEvent, 'before' | 'after'>>;
 algorithmSnapshots?: ReadonlyMap<string, Pick<TimelineEvent, 'before' | 'after'>>;
};

export async function recordLocalThingChanges(tx: WorkspaceTransaction, changes: Map<string, { before: LocalThing | null; after: LocalThing | null }>, now: () => string, uuid: () => string, captures = new Map<string, LocalMutationCapture>(), writer?: ThingHistoryWriter) {
 const history: ThingHistoryWriter = writer || { ownerId: LOCAL_TIMELINE_OWNER, clientId: 'local-workspace', branchId: 'main', mode: 'revision', read: id => localTimelineEntry(tx, id), append: event => appendLocalTimeline(tx, event) };
 let things: LocalThing[] | null = null;
 for (const [id, { before, after }] of changes) {
  const target = after || before;
  const themeSnapshots = writer?.themeSnapshots?.get(id);
  const algorithmSnapshots = writer?.algorithmSnapshots?.get(id);
  if (!target || (isProtectedThingtime(target.thingtime) && !((isTransferTheme(target) && (!writer || themeSnapshots)) || (isTransferAlgorithm(target) && (!writer || algorithmSnapshots)))) || ['reaction', 'save', 'vote', 'updown', 'action-run'].some(kind => target.thingtime.includes(kind)) || id.startsWith('timeline-')) continue;
  const snapshot = (row: LocalThing | null) => row && isTransferTheme(row)
   ? themeContentSnapshot({crystal:row.crystal,tags:row.tags ?? [],visibility:'private',folderId:row.folderId ?? null})
   : row && isTransferAlgorithm(row) ? algorithmContentSnapshot({crystal:row.crystal,folderId:row.folderId ?? null})
   : thingContentSnapshot(row && {...row,...(!writer ? {acl:[]} : {})});
  const supplied = themeSnapshots ?? algorithmSnapshots;
  const previous = supplied ? supplied.before : snapshot(before), next = supplied ? supplied.after : snapshot(after);
  if (JSON.stringify(previous) === JSON.stringify(next) && !captures.has(id)) continue;
  const parent = await tx.get<string>(META, `head:${id}`);
  const prior = parent ? await history.read(parent) : null;
  if (parent && (!prior || prior.event.thingId !== id)) fail('The previous local version is unavailable.');
  let event = parseTimelineEvent({ formatVersion: 1, id: `${writer ? 'device' : 'local'}-event-${uuid()}`, ownerId: history.ownerId, actorId: history.ownerId,
   thingId: id, branchId: history.branchId, parentIds: parent ? [parent] : [], operationId: uuid(), source: 'client', clientId: history.clientId,
   occurredAt: now(), mode: history.mode, operation: !before ? 'create' : !after ? 'delete' : 'update',
   label: (!before ? 'Created Thing' : !after ? 'Deleted Thing' : 'Edited Thing') + (writer ? ' on this device' : ''), before: previous, after: next, dependencies: [], ...captures.get(id) });
  if (!after && before?.thingtime.includes('webpage') && prior) event = parseTimelineEvent({ ...event, dependencies: prior.event.dependencies });
  if (after?.thingtime.includes('webpage')) {
   const bindings: ComponentBindings = Object.create(null);
   const refs = webpageComponentRefs(after.crystal.blocks);
   if (refs.length) things ??= (await tx.list<LocalThing>('things')).map(row => row.value);
   const resolved = resolveWorkspacePage(things || [after], { kind: 'id', id }, history.ownerId);
   for (const ref of refs) { const selected = resolved.components.find(row => row.id === resolved.refs[ref]); bindings[ref] = selected ? { id: selected.id, crystal: selected.crystal } : null; }
   const previousCaptures: TimelineEvent[] = [];
   for (const ref of prior?.event.dependencies || []) if (ref.thingId.startsWith('timeline-component-')) {
    const capture = await history.read(ref.eventId);
    if (!capture || capture.event.thingId !== ref.thingId) fail('Recorded components are incomplete.');
    previousCaptures.push(capture!.event);
   }
   const captures = captureComponentBindings(event, bindings, previousCaptures, () => `local-event-${uuid()}`);
   for (const capture of captures.events) await history.append(capture);
   event = parseTimelineEvent({ ...event, dependencies: captures.dependencies });
  }
  await history.append(event); await tx.put(META, `head:${id}`, event.id);
 }
}

async function readLocalTimelinePage(tx: WorkspaceTransaction, request: TimelinePageRequest, targets?: ReadonlySet<string>, envelopeBytes = 0) {
   const rows = (await tx.list<Header>(INDEX)).map(row => parseHeader(row.value, row.id)).filter(row => (targets ? targets.has(row.thingId) : !request.thingId || row.thingId === request.thingId) && (request.before === null || row.position < request.before) && (request.after === null || row.position > request.after))
    .sort((a, b) => request.after === null ? b.position - a.position : a.position - b.position);
   const entries: TimelineEntry[] = [], notes: TimelineNote[] = [], names: TimelineVersionName[] = []; let bytes = 512 + envelopeBytes;
   const allNotes = await readLocalTimelineNotes(tx, LOCAL_TIMELINE_OWNER);
   const allNames = await readLocalVersionNames(tx, LOCAL_TIMELINE_OWNER);
   const limit = request.limit;
   for (const row of rows) {
    if (entries.length >= limit || bytes + row.bytes + 1 > PAGE_BYTES) break;
    const entry = await localTimelineEntry(tx, row.id); if (!entry) fail('Local Timeline is incomplete.');
    const attached = localNotesForEntry(allNotes, entry!);
    const named = localNamesForEntry(allNames, entry!);
    const size = row.bytes + byteLength(attached) + byteLength(named) + 3;
    if (bytes + size > PAGE_BYTES) break;
    entries.push(entry!); notes.push(...attached); names.push(...named); bytes += size;
   }
   if (rows.length && !entries.length) fail('This history entry exceeds the page limit.', 413);
   const next = rows.length > entries.length ? entries.at(-1)!.receipt.position : null;
   return { ok: true as const, entries, nextBefore: request.after === null ? next : null, nextAfter: request.after === null ? null : next, notes, names };
}

export class LocalTimeline {
 constructor(private db: WorkspaceDatabase, private lease: WorkspaceLease, readonly origin: string, private now = () => new Date().toISOString()) {}
 assertScope(scope: Pick<TimelineScope, 'ownerId' | 'dataPlane'> & Partial<Pick<TimelineScope, 'apiOrigin'>>) {
  this.lease.assertCurrent();
  if (scope.ownerId !== LOCAL_TIMELINE_OWNER || scope.dataPlane !== LOCAL_TIMELINE_PLANE || (scope.apiOrigin !== undefined && scope.apiOrigin !== this.origin)) fail('Timeline belongs to another workspace.', 409);
 }
 private transaction<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return this.db.transaction({ kind: 'anonymous' }, mode, this.lease, async tx => { const value = await run(tx); signal?.throwIfAborted(); return value; });
 }
 async discover(ownerId: string) {
  this.assertScope({ ownerId, dataPlane: LOCAL_TIMELINE_PLANE });
  return { ok: true as const, ownerId, dataPlane: LOCAL_TIMELINE_PLANE, folderId: LOCAL_TIMELINE_FOLDER };
 }
 async push(input: TimelineEvent, signal?: AbortSignal) {
  const event = parseTimelineEvent(input);
  if (event.ownerId !== LOCAL_TIMELINE_OWNER || event.actorId !== LOCAL_TIMELINE_OWNER || event.source !== 'client' || event.mode !== 'draft' || !event.clientId) fail('Only authored local drafts can be submitted.');
  return { ok: true as const, entry: await this.transaction('readwrite', tx => appendLocalTimeline(tx, event), signal) };
 }
 async exportVersion(eventId: string, signal?: AbortSignal) {
  return this.transaction('readonly', async tx => {
   const entries = async (ids: string[]) => { const found: TimelineEntry[] = []; for (const id of ids) { signal?.throwIfAborted(); const entry = await localTimelineEntry(tx, id); if (entry) found.push(entry); } return found; };
   const result = await createVersionExportReader({
    entries,
    nodes: async ids => (await entries(ids)).map(({ event }) => ({ id: event.id, thingId: event.thingId, parentIds: event.parentIds, afterAdapter: event.after?.adapter ?? null })),
    snapshot: async (entry, side) => entry.event[side],
    notes: async entry => localNotesForEntry(await readLocalTimelineNotes(tx, LOCAL_TIMELINE_OWNER), entry),
    names: async entry => localNamesForEntry(await readLocalVersionNames(tx, LOCAL_TIMELINE_OWNER), entry),
    now: () => new Date(this.now()), refuse: (status, message) => fail(message, status), retainedLocation: 'this device', allowClientDrafts: true
   })(LOCAL_TIMELINE_OWNER, eventId);
   if (!result) fail('This version is not stored in this workspace.', 404);
   return { ok: true as const, export: result! };
  }, signal);
 }
 async branchMerge(input: BranchMergeRequest, signal?: AbortSignal) {
  return this.transaction('readonly', tx => {
   const entries = async (ids: string[]) => { const found: TimelineEntry[] = []; for (const id of ids) { const entry = await localTimelineEntry(tx, id); if (entry) found.push(entry); } return found; };
   return createBranchMergePreviewService({
    branch: (owner, branchId, thingId) => readLocalBranch(tx, owner, branchId, thingId),
    entries: (_owner, ids) => entries(ids),
    nodes: async (_owner, ids) => (await entries(ids)).map(({ event }) => ({ id: event.id, thingId: event.thingId, parentIds: event.parentIds, afterAdapter: event.after?.adapter ?? null })),
    snapshot: async (_owner, entry) => entry.event.after,
    recorded: (_owner, wanted, maxBytes) => localRecordedComponents(tx, wanted, maxBytes),
    refuse: (status, message) => fail(message, status)
   })(LOCAL_TIMELINE_OWNER, input);
  }, signal);
 }
 async branch(input: TimelineBranchCommand, signal?: AbortSignal) {
  this.lease.assertCurrent(); signal?.throwIfAborted();
  const command = parseTimelineBranchCommand(input);
  const signature = await transferChecksum(new TextEncoder().encode(JSON.stringify(command)));
  return this.transaction('readwrite', tx => writeLocalBranch(tx, LOCAL_TIMELINE_OWNER, command, signature,
   id => localTimelineEntry(tx, id), event => appendLocalTimeline(tx, event), this.now()), signal);
 }
 async branches(thingId: string, before: number | null = null, limit = 40, signal?: AbortSignal) {
  return this.transaction('readonly', tx => readLocalBranches(tx, LOCAL_TIMELINE_OWNER, thingId, before, limit), signal);
 }
 async branchHead(branchId: string, thingId: string, signal?: AbortSignal) {
  const lookup = parseTimelineBranchLookup({ branchId, thingId });
  return this.transaction('readonly', tx => readLocalBranch(tx, LOCAL_TIMELINE_OWNER, lookup.branchId, lookup.thingId), signal);
 }
 async checkoutBranch(input: BranchCheckoutRequest, signal?: AbortSignal) {
  const request = parseBranchCheckoutRequest(input);
  return this.transaction('readonly', tx => checkoutLocalBranch(tx, LOCAL_TIMELINE_OWNER, request, id => localTimelineEntry(tx, id)), signal);
 }
 async nameVersion(input: TimelineVersionNameCommand, signal?: AbortSignal) {
  this.lease.assertCurrent(); signal?.throwIfAborted();
  const command = parseTimelineVersionNameCommand(input);
  // Hash before opening IDB: WebCrypto must never suspend a live transaction.
  // The canonical parser sorts keys, exactly matching the server signature.
  const signature = await transferChecksum(new TextEncoder().encode(JSON.stringify(command)));
  return this.transaction('readwrite', tx => writeLocalVersionName(tx, LOCAL_TIMELINE_OWNER, command, signature,
   id => localTimelineEntry(tx, id), event => appendLocalTimeline(tx, event), this.now()), signal);
 }
 async note(input: TimelineNoteCommand, signal?: AbortSignal) {
  const command = parseTimelineNoteCommand(input);
  return this.transaction('readwrite', tx => writeLocalTimelineNote(tx, LOCAL_TIMELINE_OWNER, command, id => localTimelineEntry(tx, id), this.now), signal);
 }
 async entry(id: string, signal?: AbortSignal) {
  return this.transaction('readonly', async tx => { const entry = await localTimelineEntry(tx, id); if (!entry) fail('This version is not stored in this workspace.', 404); return { ok: true as const, entry: entry!, notes: localNotesForEntry(await readLocalTimelineNotes(tx, LOCAL_TIMELINE_OWNER), entry!), names: localNamesForEntry(await readLocalVersionNames(tx, LOCAL_TIMELINE_OWNER), entry!) }; }, signal);
 }
 async page(request: TimelinePageRequest, signal?: AbortSignal): Promise<TimelinePage & { ok: true; notes: TimelineNote[]; names: TimelineVersionName[] }> {
  if ((request.before !== null && request.after !== null) || [request.before, request.after].some(n => n !== null && (!Number.isSafeInteger(n) || n < 1)) || (request.thingId !== null && (typeof request.thingId !== 'string' || !request.thingId || request.thingId.length > 200)) || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 40) fail('Invalid Timeline page.');
  if (!request.related) {
   if (request.relatedRevision !== undefined) fail('A related revision requires Page + related.');
   return this.transaction('readonly', tx => readLocalTimelinePage(tx, request), signal);
  }
  if (!validRelatedTimelineRequest(request)) fail('Invalid related history request.');
  const rootId = request.thingId;
  const ids = await this.transaction('readonly', tx => localRelatedThingIds(tx, rootId), signal);
  // SHA-256 must not suspend an IDB transaction. Recheck membership inside the
  // read transaction after hashing, so a concurrent removal cannot leak stale
  // scope rows or silently page against an obsolete membership revision.
  const related = await createRelatedTimelineScope(rootId, ids, 0, text => transferChecksum(new TextEncoder().encode(text)));
  const reset = request.relatedRevision !== undefined && request.relatedRevision !== related.revision;
  return this.transaction('readonly', async tx => {
   const current = await localRelatedThingIds(tx, rootId);
   if (JSON.stringify(current) !== JSON.stringify(ids)) fail('This page’s related Things changed while loading. Refresh History to continue.', 409);
   const extra = { related, ...(reset ? { reset: true as const } : {}) };
   const page = await readLocalTimelinePage(tx, reset ? { ...request, before: null, after: null } : request, new Set(ids), byteLength(extra));
   return { ...page, ...extra };
  }, signal);
 }
 async componentBindings(id: string, signal?: AbortSignal) {
  return this.transaction('readonly', async tx => {
   const source = await localTimelineEntry(tx, id); if (!source) fail('This version is not stored in this workspace.', 404);
   const entries: TimelineEntry[] = []; let bytes = byteLength({ eventId: id, entries: [] });
   for (const ref of source!.event.dependencies.filter(ref => ref.thingId.startsWith('timeline-component-'))) {
    const found = await localTimelineEntry(tx, ref.eventId); if (!found || found.event.thingId !== ref.thingId) fail('Recorded components are incomplete.');
    bytes += byteLength(found) + 1; if (bytes > TIMELINE_EVENT_MAX_BYTES) fail('These recorded components are too large to preview together.', 413);
    entries.push(found!);
   }
   return { ok: true as const, eventId: id, entries };
  }, signal);
 }
}
