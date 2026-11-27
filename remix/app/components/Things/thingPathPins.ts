import type { PublicThing } from '~/api/utils/things/things';
/** Browser placement is a page and its ordered parent path. Presentation and
 * discovery parameters deliberately never participate in its identity. */
export type ThingPinPath = string[];
export type ThingPinSnapshot = { revision: string; pins: { thingId: string; order: number; presentation?: PublicThing }[] };
export type ThingPinIntent = { operation: 'pin'; thingId: string } | { operation: 'unpin'; thingId: string } | { operation: 'reorder'; thingIds: string[] };
export const pinPathKey = (path: ThingPinPath): string => JSON.stringify(path);
export const thingPinPath = (page: string, parents: (string | null)[] = []): ThingPinPath => [page, ...parents.filter((id): id is string => id !== null)];
export function applyPinIntent(ids: string[], intent: ThingPinIntent): string[] {
  if (intent.operation === 'pin') return ids.includes(intent.thingId) ? ids : [...ids, intent.thingId];
  if (intent.operation === 'unpin') return ids.filter(id => id !== intent.thingId);
  // Retain pins hidden by a filter or a concurrent reader. A partial visible
  // reorder only changes the slots occupied by its specified IDs.
  const wanted = [...new Set(intent.thingIds)].filter(id => ids.includes(id));
  const selected = new Set(wanted);
  let index = 0;
  return ids.map(id => selected.has(id) ? wanted[index++] : id);
}
export function movePin(ids: string[], id: string, beforeId: string | null): string[] {
  if (id === beforeId || !ids.includes(id) || (beforeId !== null && !ids.includes(beforeId))) return ids;
  const next = ids.filter(value => value !== id);
  next.splice(beforeId === null ? next.length : next.indexOf(beforeId), 0, id);
  return next;
}
export function orderPinned<T>(items: T[], ids: string[], getId: (item: T) => string): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(getId(a)) ?? Infinity) - (rank.get(getId(b)) ?? Infinity));
}
