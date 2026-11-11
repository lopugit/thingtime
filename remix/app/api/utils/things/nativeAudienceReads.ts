import { thingsPersistenceError, type ThingsPersistence, type ThingsSelection, type StoredThing } from './persistence';

/** Relationship candidates are home identity data. This read-only handle does
 * not select another authenticated owner or authorize exposing any candidate. */
export async function nativeAudienceRows(repository: ThingsPersistence, selection: Omit<ThingsSelection, 'cursor' | 'limit'>): Promise<StoredThing[]> {
 if (repository.scope.ownerId !== null || repository.scope.homePlaneId !== repository.scope.contentPlaneId)
  return thingsPersistenceError('audience reads require the read-only home binding');
 const rows: StoredThing[] = [];
 let cursor: string | null = null;
 do {
  const page = await repository.readWindow({ ...selection, limit: 128, cursor });
  rows.push(...page.documents); cursor = page.nextCursor;
 } while (cursor !== null);
 return rows;
}

export async function nativeFriendIds(repository: ThingsPersistence, userId: string): Promise<Set<string>> {
 const pages = await Promise.all([
  nativeAudienceRows(repository, { kinds: ['friend'], ownerId: userId }),
  nativeAudienceRows(repository, { kinds: ['friend'], targetId: userId })
 ]);
 const ids = new Set<string>();
 for (const row of pages.flat()) {
  if (row.crystal?.status !== 'accepted') continue;
  const other = String(row.ownerId) === userId ? String(row.targetId) : String(row.ownerId);
  if (other && other !== userId) ids.add(other);
 }
 return ids;
}

export async function nativeGroupIds(repository: ThingsPersistence, userId: string): Promise<Set<string>> {
 const rows = await nativeAudienceRows(repository, { kinds: ['group-member'], targetId: userId });
 return new Set(rows.map(row => String(row.crystal?.groupId || '')).filter(Boolean));
}
