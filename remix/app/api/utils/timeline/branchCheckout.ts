import { parseBranchCheckoutRequest, type BranchCheckoutRequest, type BranchCheckout } from '../../../timeline/branchCheckout.ts';
import { getThingsCollection } from '../mongodb/collections';
import { StorageMutationError } from '../storage/storageCore';
import { readTimelineBranchEntry } from './branches.ts';
import { readTimelineEntries, readTimelineNodes, type TimelineGraphNode } from './repository.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';
import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from '../../../timeline/snapshotParts.ts';
import { createVersionContentReader, loadVersionGraph } from './versions.ts';

const refuse = (status: number, message: string): never => { throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message); };
const defaults = { collection: getThingsCollection, branch: readTimelineBranchEntry, entries: readTimelineEntries, nodes: readTimelineNodes, snapshot: readTimelineSnapshot };
/** Owner-only read at a fixed head. No current Thing is borrowed or updated. */
export function createBranchCheckoutService(overrides: Partial<typeof defaults> = {}) {
 const deps = { ...defaults, ...overrides };
 return async (ownerId: string, input: BranchCheckoutRequest): Promise<{ ok: true; checkout: BranchCheckout }> => {
  const request = parseBranchCheckoutRequest(input); const things = await deps.collection();
  const target = await deps.branch(things, ownerId, request.branchId, request.thingId);
  if (!target || target.branch.ownerId !== ownerId || target.head.ownerId !== ownerId || target.branch.id !== request.branchId || target.head.branchId !== request.branchId || target.head.thingId !== request.thingId) refuse(404, 'Branch not found.');
  if (target.head.revision !== request.expectedRevision || target.head.eventId !== request.expectedHeadId) refuse(409, 'This branch changed. Pull its latest version before opening it.');
  const read = (ids: string[]) => deps.entries(things, ownerId, ids);
  const found = await read([target.head.eventId]); const entry = found[0];
  if (found.length !== 1 || !entry || entry.event.id !== target.head.eventId || entry.event.ownerId !== ownerId || entry.event.thingId !== request.thingId || entry.event.mode === 'effect' || !entry.event.after) refuse(404, 'This branch version is unavailable.');
  const graph = ['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes(entry.event.after!.adapter) ? new Map<string, TimelineGraphNode>() : await loadVersionGraph([entry.event.id], request.thingId, ids => deps.nodes(things, ownerId, ids));
  const content = await createVersionContentReader(graph, read, item => deps.snapshot(things, ownerId, item.event.id, 'after', item.event.after))(entry);
  return { ok: true, checkout: { ...target, entry, snapshot: { adapter: 'thing-content', version: 1, value: content } } };
 };
}
export const checkoutTimelineBranch = createBranchCheckoutService();
