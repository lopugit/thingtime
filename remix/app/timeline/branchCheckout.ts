import { copyBoundedJson } from '../utils/boundedJson.ts';
import { TIMELINE_EVENT_MAX_BYTES, parseTimelineEntry, type TimelineEntry, type TimelineSnapshot } from './contract.ts';
import { isTimelineBranchId, parseTimelineBranchEntry, parseTimelineBranchCommand, type TimelineBranchEntry } from './branches.ts';
import { versionContent } from './versions.ts';

export type BranchCheckoutRequest = { command: 'checkout-branch'; branchId: string; thingId: string; expectedHeadId: string; expectedRevision: number };
export type BranchCheckout = TimelineBranchEntry & { entry: TimelineEntry; snapshot: TimelineSnapshot };
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const keys = (value: any, names: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.prototype.hasOwnProperty.call(value, name));
export function parseBranchCheckoutRequest(input: unknown): BranchCheckoutRequest {
 const value = copyBoundedJson(input, { maxBytes: 4096, maxDepth: 3, maxNodes: 20, sortKeys: true }, 'Branch checkout') as any;
 if (!keys(value, ['command', 'branchId', 'thingId', 'expectedHeadId', 'expectedRevision']) || value.command !== 'checkout-branch' || !isTimelineBranchId(value.branchId) || !id(value.thingId) || !id(value.expectedHeadId) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) throw new Error('Invalid branch checkout');
 return value;
}
export function branchCheckoutRequest(target: TimelineBranchEntry): BranchCheckoutRequest {
 return parseBranchCheckoutRequest({ command: 'checkout-branch', branchId: target.branch.id, thingId: target.head.thingId, expectedHeadId: target.head.eventId, expectedRevision: target.head.revision });
}
/** Transient materialized view. The entry retains its exact canonical format;
 * a checkout never rewrites that event or creates a second persistence schema. */
export function parseBranchCheckout(input: unknown, ownerId: string, request: BranchCheckoutRequest): BranchCheckout {
 const value = copyBoundedJson(input, { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 100, maxNodes: 200_000, sortKeys: true }, 'Branch checkout') as any;
 if (!keys(value, ['branch', 'head', 'entry', 'snapshot'])) throw new Error('Invalid branch checkout');
 const target = parseTimelineBranchEntry(value); const entry = parseTimelineEntry(value.entry);
 if (target.branch.ownerId !== ownerId || target.branch.id !== request.branchId || target.head.thingId !== request.thingId || target.head.eventId !== request.expectedHeadId || target.head.revision !== request.expectedRevision || entry.event.id !== request.expectedHeadId || entry.event.ownerId !== ownerId || entry.event.thingId !== request.thingId || entry.event.mode === 'effect' || !entry.event.after) throw new Error('This checkout belongs to another branch version');
 if (!keys(value.snapshot?.value, ['crystal', 'extended', 'tags', 'geo', 'acl', 'folderId'])) throw new Error('Invalid branch checkout content');
 const snapshot = branchEditableSnapshot(value.snapshot);
 return { ...target, entry, snapshot };
}
export function branchEditableSnapshot(input: TimelineSnapshot): TimelineSnapshot {
 if (!keys(input, ['adapter', 'version', 'value']) || input.adapter !== 'thing-content' || input.version !== 1) throw new Error('Reconnect to load this branch before editing.');
 return { adapter: 'thing-content', version: 1, value: versionContent(input) };
}
export function branchCrystalSnapshot(basis: TimelineSnapshot, crystal: unknown): TimelineSnapshot {
 const checked = branchEditableSnapshot(basis);
 return branchEditableSnapshot({ ...checked, value: { ...(checked.value as Record<string, any>), crystal: copyBoundedJson(crystal, { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 80, maxNodes: 100_000, sortKeys: true }, 'Branch fields') } });
}
export function branchEditCommand(target: TimelineBranchEntry, eventId: string, operationId = crypto.randomUUID()) {
 return parseTimelineBranchCommand({ command: 'advance-branch', operationId, branchId: target.branch.id, thingId: target.head.thingId, eventId, expectedRevision: target.head.revision, name: null });
}
