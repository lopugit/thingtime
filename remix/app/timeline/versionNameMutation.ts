import { parseTimelineEvent, type TimelineEntry, type TimelineEvent, type TimelineSnapshot } from './contract';
import { canNameTimelineVersion, parseTimelineVersionName, timelineVersionNameEventId, timelineVersionNameId, TIMELINE_VERSION_NAME_KIND, TIMELINE_VERSION_NAME_LABELS, type TimelineVersionName, type TimelineVersionNameCommand, type TimelineVersionNameResult } from './versionNames';

/** Shared mutation semantics; adapters own scope, transactions, hashing and
 * persistence. A local authority issues the same effect contract in its own
 * data plane, never a receipt that can authorize an account write. */
export class VersionNameMutationError extends Error {
 constructor(readonly status: number, message: string) { super(message); }
}
const refuse = (status: number, message: string): never => { throw new VersionNameMutationError(status, message); };
const snapshot = (name: TimelineVersionName): TimelineSnapshot => ({ adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: name });

export function replayVersionName(prior: TimelineEntry | null, ownerId: string, signature: string): TimelineVersionNameResult | null {
 if (!prior) return null;
 if (prior.event.ownerId !== ownerId || prior.event.operationId !== signature || prior.event.source !== 'api' || prior.event.actorId !== ownerId ||
  (prior.event.after ?? prior.event.before)?.adapter !== TIMELINE_VERSION_NAME_KIND) refuse(409, 'This operation id was already used for another request.');
 return { ok: true, name: prior.event.after ? parseTimelineVersionName(prior.event.after.value) : null, entry: prior };
}

export function planVersionName(input: {
 ownerId: string; command: TimelineVersionNameCommand; signature: string; target: TimelineEntry | null;
 current: TimelineVersionName | null; baseRevision: number; previousUpdatedAt: string | null; now: string;
}): { name: TimelineVersionName | null; event: TimelineEvent | null; revision: number; updatedAt: string } {
 const { ownerId, command, signature, target, current, baseRevision, previousUpdatedAt, now } = input;
 if (!target || target.event.ownerId !== ownerId || target.event.thingId !== command.thingId || target.event.id !== command.eventId) refuse(404, 'Version not found.');
 if (!canNameTimelineVersion(target!.event)) refuse(422, 'Only a retained content version can be named.');
 if (current && (current.ownerId !== ownerId || current.eventId !== command.eventId || current.thingId !== command.thingId || current.revision !== baseRevision)) refuse(409, 'This version name record is damaged.');
 if (current ? current.revision !== command.expectedRevision : command.expectedRevision !== 0) refuse(409, 'This version name changed on another device. Refresh and try again.');
 if (command.name === null ? !current : current?.name === command.name) return { name: current, event: null, revision: baseRevision, updatedAt: previousUpdatedAt ?? now };
 if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || baseRevision >= Number.MAX_SAFE_INTEGER) refuse(409, 'This version name revision limit has been reached.');
 const updatedAt = new Date(Math.max(Date.parse(now), current ? Date.parse(current.updatedAt) + 1 : 0, previousUpdatedAt ? Date.parse(previousUpdatedAt) + 1 : 0)).toISOString();
 const name = command.name === null ? null : parseTimelineVersionName({ formatVersion: 1, id: timelineVersionNameId(command.eventId), ownerId,
  eventId: command.eventId, thingId: command.thingId, name: command.name, revision: baseRevision + 1, createdAt: current?.createdAt ?? now, updatedAt });
 const event = parseTimelineEvent({ formatVersion: 1, id: timelineVersionNameEventId(command.operationId), ownerId, thingId: command.thingId,
  branchId: target!.event.branchId, parentIds: [], operationId: signature, actorId: ownerId, source: 'api', clientId: null,
  occurredAt: now, mode: 'effect', operation: 'effect', label: !name ? TIMELINE_VERSION_NAME_LABELS.cleared : current ? TIMELINE_VERSION_NAME_LABELS.renamed : TIMELINE_VERSION_NAME_LABELS.named,
  before: current ? snapshot(current) : null, after: name ? snapshot(name) : null, dependencies: [{ thingId: command.thingId, eventId: command.eventId }] });
 return { name, event, revision: baseRevision + 1, updatedAt };
}
