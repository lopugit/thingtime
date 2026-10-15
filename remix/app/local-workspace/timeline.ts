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
import type { TimelinePageRequest } from '../timeline/sync';
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
export async function recordLocalThingChanges(tx: WorkspaceTransaction, changes: Map<string, { before: LocalThing | null; after: LocalThing | null }>, now: () => string, uuid: () => string) {
 let things: LocalThing[] | null = null;
 for (const [id, { before, after }] of changes) {
  const target = after || before;
  if (!target || isProtectedThingtime(target.thingtime) || ['reaction', 'save', 'vote', 'updown', 'action-run'].some(kind => target.thingtime.includes(kind)) || id.startsWith('timeline-')) continue;
  const previous = thingContentSnapshot(before && { ...before, acl: [] }), next = thingContentSnapshot(after && { ...after, acl: [] });
  if (JSON.stringify(previous) === JSON.stringify(next)) continue;
  const parent = await tx.get<string>(META, `head:${id}`);
  const prior = parent ? await localTimelineEntry(tx, parent) : null;
  if (parent && (!prior || prior.event.thingId !== id)) fail('The previous local version is unavailable.');
  let event = parseTimelineEvent({ formatVersion: 1, id: `local-event-${uuid()}`, ownerId: LOCAL_TIMELINE_OWNER, actorId: LOCAL_TIMELINE_OWNER,
   thingId: id, branchId: 'main', parentIds: parent ? [parent] : [], operationId: uuid(), source: 'client', clientId: 'local-workspace',
   occurredAt: now(), mode: 'revision', operation: !before ? 'create' : !after ? 'delete' : 'update',
   label: !before ? 'Created Thing' : !after ? 'Deleted Thing' : 'Edited Thing', before: previous, after: next, dependencies: [] });
  if (!after && before?.thingtime.includes('webpage') && prior) event = parseTimelineEvent({ ...event, dependencies: prior.event.dependencies });
  if (after?.thingtime.includes('webpage')) {
   const bindings: ComponentBindings = Object.create(null);
   const refs = webpageComponentRefs(after.crystal.blocks);
   if (refs.length) things ??= (await tx.list<LocalThing>('things')).map(row => row.value);
   const resolved = resolveWorkspacePage(things || [after], { kind: 'id', id }, LOCAL_TIMELINE_OWNER);
   for (const ref of refs) { const selected = resolved.components.find(row => row.id === resolved.refs[ref]); bindings[ref] = selected ? { id: selected.id, crystal: selected.crystal } : null; }
   const previousCaptures: TimelineEvent[] = [];
   for (const ref of prior?.event.dependencies || []) if (ref.thingId.startsWith('timeline-component-')) {
    const capture = await localTimelineEntry(tx, ref.eventId);
    if (!capture || capture.event.thingId !== ref.thingId) fail('Recorded components are incomplete.');
    previousCaptures.push(capture!.event);
   }
   const captures = captureComponentBindings(event, bindings, previousCaptures, () => `local-event-${uuid()}`);
   for (const capture of captures.events) await appendLocalTimeline(tx, capture);
   event = parseTimelineEvent({ ...event, dependencies: captures.dependencies });
  }
  await appendLocalTimeline(tx, event); await tx.put(META, `head:${id}`, event.id);
 }
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
 async page(request: TimelinePageRequest, signal?: AbortSignal) {
  if (request.related) fail('Related local history is not available yet.', 503);
  if ((request.before !== null && request.after !== null) || [request.before, request.after].some(n => n !== null && (!Number.isSafeInteger(n) || n < 1)) || (request.thingId !== null && (typeof request.thingId !== 'string' || !request.thingId || request.thingId.length > 200)) || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 40) fail('Invalid Timeline page.');
  return this.transaction('readonly', async tx => {
   const rows = (await tx.list<Header>(INDEX)).map(row => parseHeader(row.value, row.id)).filter(row => (!request.thingId || row.thingId === request.thingId) && (request.before === null || row.position < request.before) && (request.after === null || row.position > request.after))
    .sort((a, b) => request.after === null ? b.position - a.position : a.position - b.position);
   const entries: TimelineEntry[] = [], notes: TimelineNote[] = [], names: TimelineVersionName[] = []; let bytes = 512;
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
