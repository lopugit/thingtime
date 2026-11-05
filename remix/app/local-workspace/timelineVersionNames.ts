import { parseTimelineVersionName, timelineVersionNameId, timelineVersionNameEventId, type TimelineVersionName, type TimelineVersionNameCommand, type TimelineVersionNameResult } from '../timeline/versionNames';
import { planVersionName, replayVersionName, VersionNameMutationError } from '../timeline/versionNameMutation';
import type { TimelineEntry, TimelineEvent } from '../timeline/contract';
import { WorkspaceError, type WorkspaceTransaction } from './storage';

const NAMES = 'timeline-version-names';
type State = { revision: number; updatedAt: string };
const damaged = (): never => { throw new WorkspaceError('LOCAL_VERSION_NAME', 'Local version name metadata is damaged.', 409); };

/** Canonical name records are separate from immutable events. A content-free
 * internal state row retains the monotonic revision when a name is cleared. */
export async function readLocalVersionNames(tx: WorkspaceTransaction, ownerId: string): Promise<TimelineVersionName[]> {
 return (await tx.list<TimelineVersionName>(NAMES)).map(row => {
  const name = parseTimelineVersionName(row.value);
  if (row.id !== name.id || name.ownerId !== ownerId) damaged();
  return name;
 }).sort((a, b) => a.eventId.localeCompare(b.eventId));
}
export function localNamesForEntry(names: TimelineVersionName[], entry: TimelineEntry): TimelineVersionName[] {
 return names.filter(name => {
  if (name.eventId !== entry.event.id) return false;
  if (name.ownerId !== entry.event.ownerId || name.thingId !== entry.event.thingId) damaged();
  return true;
 });
}

export async function writeLocalVersionName(tx: WorkspaceTransaction, ownerId: string, command: TimelineVersionNameCommand, signature: string,
 readEntry: (id: string) => Promise<TimelineEntry | null>, append: (event: TimelineEvent) => Promise<TimelineEntry>, now: string): Promise<TimelineVersionNameResult> {
 try {
  const replay = replayVersionName(await readEntry(timelineVersionNameEventId(command.operationId)), ownerId, signature);
  if (replay) return replay;
  const id = timelineVersionNameId(command.eventId), stateId = `name-state:${command.eventId}`;
  const raw = await tx.get<TimelineVersionName>(NAMES, id), current = raw ? parseTimelineVersionName(raw) : null;
  const state = await tx.get<State>('timeline-meta', stateId);
  if (state && (Object.keys(state).length !== 2 || !Number.isSafeInteger(state.revision) || state.revision < 1 || typeof state.updatedAt !== 'string' ||
   !Number.isFinite(Date.parse(state.updatedAt)) || new Date(state.updatedAt).toISOString() !== state.updatedAt)) damaged();
  if (current && (!state || state.revision !== current.revision || state.updatedAt !== current.updatedAt)) damaged();
  const planned = planVersionName({ ownerId, command, signature, target: await readEntry(command.eventId), current,
   baseRevision: state?.revision ?? 0, previousUpdatedAt: state?.updatedAt ?? null, now });
  if (!planned.event) return { ok: true, name: planned.name, entry: null };
  const entry = await append(planned.event);
  if (planned.name) await tx.put(NAMES, id, planned.name); else await tx.delete(NAMES, id);
  await tx.put('timeline-meta', stateId, { revision: planned.revision, updatedAt: planned.updatedAt } satisfies State);
  return { ok: true, name: planned.name, entry };
 } catch (error) {
  if (error instanceof VersionNameMutationError) throw new WorkspaceError('LOCAL_VERSION_NAME', error.message, error.status);
  throw error;
 }
}
