import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from '../../../timeline/snapshotParts.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';
import { createHash } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson.ts';
import type { TimelineEntry, TimelineSnapshot } from '../../../timeline/contract.ts';
import { mergeVersionValues, versionContent, type VersionChoices } from '../../../timeline/versions.ts';
import { getThingsCollection } from '../mongodb/collections';
import { findViewableThing, updateThing } from '../things/things';
import { isProtectedThingtime } from '../../../schemas/registry';
import { StorageMutationError } from '../storage/storageCore';
import { readTimelineEntries, readTimelineNodes, type TimelineGraphNode } from './repository.ts';
import { newThingMutationCapture, thingContentSnapshot } from './recordMutation.ts';

export type VersionRequest = { command: 'preview-version' | 'apply-version'; mode: 'restore' | 'merge'; eventId: string; expectedHeadId?: string; operationId?: string; choices?: VersionChoices };
const reject = (status: number, message: string): never => { throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message); };
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const restorableContent = (snapshot: TimelineSnapshot | null, basis?: TimelineSnapshot['value']) => {
 try { return versionContent(snapshot, basis); }
 catch { return reject(422, 'This version has unsupported or incomplete content. Recover the draft in its editor before applying it.'); }
};
export function parseVersionRequest(input: unknown): VersionRequest {
 const value = copyBoundedJson(input, { maxBytes: 64 * 1024, maxDepth: 5, maxNodes: 2000, sortKeys: true }, 'Version request') as any;
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['command', 'mode', 'eventId', 'expectedHeadId', 'operationId', 'choices'].includes(key)) || !['preview-version', 'apply-version'].includes(value.command) || !['restore', 'merge'].includes(value.mode) || !validId(value.eventId)) throw new Error('Invalid version request.');
 if (value.command === 'apply-version' && (!validId(value.expectedHeadId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.operationId ?? ''))) throw new Error('Applying a version requires its preview head and a UUID operation id.');
 if (value.choices !== undefined && (!value.choices || typeof value.choices !== 'object' || Array.isArray(value.choices) || Object.values(value.choices).some(choice => choice !== 'current' && choice !== 'incoming'))) throw new Error('Invalid version choices.');
 return value;
}

/** Bounded batch traversal, independent of how much history a client cached. */
export async function loadVersionGraph(roots: string[], thingId: string, read: (ids: string[]) => Promise<TimelineGraphNode[]>) {
 const entries = new Map<string, TimelineGraphNode>(); let frontier = [...new Set(roots)];
 while (frontier.length) {
  const next: string[] = [];
  for (let offset = 0; offset < frontier.length; offset += 128) {
   const ids = frontier.slice(offset, offset + 128); const found = await read(ids);
   if (found.length !== ids.length || new Set(found.map(entry => entry.id)).size !== ids.length || found.some(entry => !ids.includes(entry.id) || entry.thingId !== thingId)) reject(409, 'Earlier versions are unavailable. History cannot be merged safely.');
   for (const entry of found) { entries.set(entry.id, entry); next.push(...entry.parentIds); }
   if (entries.size > 2048) reject(409, 'This version is too far back for one merge. Choose a more recent version.');
  }
  frontier = [...new Set(next)].filter(id => !entries.has(id));
 }
 return entries;
}
export function versionMergeBase(graph: Map<string, TimelineGraphNode>, left: string, right: string): TimelineGraphNode {
 const ancestors = (id: string) => {
  const seen = new Set<string>(); const queue = [id];
  for (let cursor = 0; cursor < queue.length; cursor++) { const next = queue[cursor]; if (seen.has(next)) continue; seen.add(next); const entry = graph.get(next); if (!entry) reject(409, 'An ancestor is missing.'); queue.push(...entry!.parentIds); }
  return seen;
 };
 const a = ancestors(left); const b = ancestors(right); const common = new Set([...a].filter(id => b.has(id)));
 const older = new Set<string>();
 for (const id of common) for (const parent of graph.get(id)!.parentIds) if (common.has(parent)) older.add(parent);
 const bases = [...common].filter(id => !older.has(id));
 if (bases.length !== 1) reject(409, bases.length ? 'These branches have multiple merge bases. Choose an earlier version to compare.' : 'These versions have no shared ancestor. Review a restore instead.');
 return graph.get(bases[0])!;
}

/** Select the nearest full version and latest replacement of each compact
 * field. Folder moves inherit the preceding crystal and its dependency links;
 * no payload is borrowed from the live Thing. */
export function versionContentSources(graph: Map<string, TimelineGraphNode>, entry: TimelineEntry) {
  const selected: string[] = []; const fields = new Set<string>(); const seen = new Set<string>();
  let id = entry.event.id;
  while (true) {
   if (seen.has(id) || seen.size >= 2048) reject(409, 'This version has incomplete or cyclic ancestry.');
   seen.add(id);
   const node = graph.get(id) ?? (id === entry.event.id ? { id, parentIds: entry.event.parentIds, afterAdapter: entry.event.after?.adapter } : null);
   if (!node) reject(409, 'An earlier version is unavailable.');
   if (['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes(node.afterAdapter ?? '')) { selected.push(id); break; }
   const field = node.afterAdapter === 'folder-placement' ? 'folderId' : ['webpage-draft', 'definition-source'].includes(node.afterAdapter ?? '') ? 'crystal' : null;
   if (!field || node.parentIds.length !== 1) reject(422, 'This draft has no unambiguous saved basis. Recover it in its editor first.');
   if (!fields.has(field)) { fields.add(field); selected.push(id); }
   id = node.parentIds[0];
  }
  const crystalId = selected.find(key => (graph.get(key)?.afterAdapter ?? (key === entry.event.id ? entry.event.after?.adapter : null)) !== 'folder-placement')!;
  return { selected, crystalId };
}

export function createVersionContentReader(
 graph: Map<string, TimelineGraphNode>,
 read: (ids: string[]) => Promise<TimelineEntry[]>,
 snapshot: (entry: TimelineEntry) => Promise<TimelineSnapshot | null>
) {
 const cached = new Map<string, TimelineEntry>();
 return async (entry: TimelineEntry) => {
  cached.set(entry.event.id, entry);
  const { selected } = versionContentSources(graph, entry);
  const missing = selected.filter(key => !cached.has(key));
  if (missing.length) {
   const found = await read(missing);
   if (found.length !== missing.length || new Set(found.map(item => item.event.id)).size !== missing.length || found.some(item => !missing.includes(item.event.id) || item.event.ownerId !== entry.event.ownerId || item.event.thingId !== entry.event.thingId)) reject(409, 'An earlier version is unavailable.');
   for (const item of found) cached.set(item.event.id, item);
  }
  let content: ReturnType<typeof versionContent> | undefined;
  for (const key of selected.reverse()) content = restorableContent(await snapshot(cached.get(key)!), content);
  return content!;
 };
}

const dependencies = { collection: getThingsCollection, find: findViewableThing, update: updateThing };
export function createVersionService(overrides: Partial<typeof dependencies> = {}) {
 const deps = { ...dependencies, ...overrides };
 return async (ownerId: string, request: VersionRequest) => {
  const things = await deps.collection();
  const read = (ids: string[]) => readTimelineEntries(things, ownerId, ids);
  const signature = createHash('sha256').update(JSON.stringify({ mode: request.mode, eventId: request.eventId, expectedHeadId: request.expectedHeadId ?? null, choices: request.choices ?? {} })).digest('hex');
  const committedId = request.operationId ? `version-${request.operationId}` : null;
  const existing = async () => {
   if (!committedId) return null;
   const entry = (await read([committedId]))[0];
   if (entry && (entry.event.operationId !== signature || entry.event.actorId !== ownerId || entry.event.source !== 'api' || entry.event.mode !== 'revision')) reject(409, 'This operation id was already used for another version request.');
   return entry ?? null;
  };
  const prior = request.command === 'apply-version' ? await existing() : null;
  if (prior) return { ok: true as const, entry: prior };
  const source = (await read([request.eventId]))[0];
  if (!source) reject(404, 'Version not found.');
  const doc = await deps.find(source.event.thingId, { id: ownerId });
  if (!doc || doc.ownerId !== ownerId || isProtectedThingtime(doc.thingtime ?? [])) reject(404, 'This Thing is not available for version changes.');
  const headId = (doc as any).timelineHeadId as string;
  if (!headId) reject(409, 'Save this Thing once before applying an earlier version.');
  if (request.command === 'apply-version' && headId !== request.expectedHeadId) reject(409, 'Thing changed after the version preview. Refresh and compare again.');
  const graph = request.mode === 'merge' || !['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes(source.event.after?.adapter ?? '') ? await loadVersionGraph(request.mode === 'merge' ? [source.event.id, headId] : [source.event.id], source.event.thingId, ids => readTimelineNodes(things, ownerId, ids)) : new Map<string, TimelineGraphNode>();
  const baseNode = request.mode === 'merge' ? versionMergeBase(graph, headId, source.event.id) : null;
  const base = baseNode ? (await read([baseNode.id]))[0] : null;
  const resolved = (entry: TimelineEntry) => readTimelineSnapshot(things, ownerId, entry.event.id, 'after', entry.event.after);
  const contentFor = createVersionContentReader(graph, read, resolved);
  const currentSnapshot = thingContentSnapshot(doc)!;
  const current = restorableContent(currentSnapshot);
  const incoming = await contentFor(source);
  const baseContent = base ? await contentFor(base) : null;
  let merged: ReturnType<typeof mergeVersionValues>;
  try { merged = baseContent ? mergeVersionValues(baseContent, current, incoming, request.choices) : { value: incoming, conflicts: [] }; }
  catch { return reject(422, 'This comparison or its conflict choices are no longer valid. Refresh the comparison before applying it.'); }
  if (request.mode === 'restore' && Object.keys(request.choices ?? {}).length) reject(400, 'Restores do not accept merge choices.');
  const snapshot = (value: any): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value });
  if (request.command === 'preview-version') return { ok: true as const, preview: { eventId: source.event.id, thingId: source.event.thingId, mode: request.mode, expectedHeadId: headId, current: snapshot(current), incoming: snapshot(incoming), result: snapshot(merged.value), baseEventId: base?.event.id ?? null, conflicts: merged.conflicts } };
  if (merged.conflicts.length) reject(409, 'Choose which overlapping changes to keep before merging.');
  if (request.mode === 'merge' && headId === source.event.id) reject(409, 'This version is already current.');
  const capture = { ...newThingMutationCapture(ownerId, 'api'), id: committedId!, operationId: signature, operation: request.mode, parentIds: [...new Set([headId, source.event.id])], label: request.mode === 'merge' ? 'Merged branch into current version' : 'Restored earlier version' };
  const result = await deps.update({ id: ownerId }, source.event.thingId, merged.value as any, { replaceCrystal: true, expectedUpdatedAt: new Date(doc!.updatedAt).toISOString(), timeline: { expectedHeadId: headId, capture } });
  if (result.ok === false) { const completed = await existing(); if (completed) return { ok: true as const, entry: completed }; reject(result.status, result.error); }
  const entry = await existing();
  if (!entry) throw new Error('Version was saved but its Timeline receipt could not be read. Retry this operation.');
  return { ok: true as const, entry };
 };
}
export const handleVersionRequest = createVersionService();
