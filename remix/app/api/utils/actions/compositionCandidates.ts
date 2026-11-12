import { getThingsCollection } from '../mongodb/collections';
import { getBoundThingsPersistence } from '../things/persistenceContext';
import type { StoredThing, ThingsReads } from '../things/persistence';
import type { CompositionReference } from './sharedCompositionCore';

type Kind = CompositionReference['kind'];
export interface CompositionCandidates {
 exact(id: string, kind?: string, ownerId?: string): Promise<StoredThing | null>;
 named(kind: Kind, ownerId: string, ref: string): Promise<StoredThing | null>;
 addition(kind: Kind, ownerId: string, ref: string): Promise<StoredThing | null>;
}
const compare = (a: StoredThing, b: StoredThing) => (Number(b.crystal?.version) || 0) - (Number(a.crystal?.version) || 0) ||
 +new Date(b.updatedAt) - +new Date(a.updatedAt) || Buffer.compare(Buffer.from(a.shareId), Buffer.from(b.shareId));
const nameField = (kind: Kind) => kind === 'schema' ? 'name' : `${kind}Key`;

/** Lookup vocabulary only; every returned candidate still requires the live
 * canonical composition ACL boundary. Native reads never translate Mongo filters. */
function nativeCandidates(reads: ThingsReads): CompositionCandidates {
 const exact: CompositionCandidates['exact'] = async (id, kind, ownerId) => {
  const row = await reads.readExact(id);
  return row && (!kind || row.thingtime?.includes(kind)) && (!ownerId || row.ownerId === ownerId) ? row : null;
 };
 const named: CompositionCandidates['named'] = async (kind, ownerId, ref) => {
  let cursor: string | null = null, best: StoredThing | null = null;
  do {
   const page = await reads.readWindow({ ownerId, kinds: [kind], limit: 128, cursor });
   for (const row of page.documents) if (row.crystal?.[nameField(kind)] === ref && (!best || compare(row, best) < 0)) best = row;
   cursor = page.nextCursor;
  } while (cursor !== null);
  return best;
 };
 return { exact, named, async addition(kind, ownerId, ref) {
  const rows = [await exact(ref, kind)];
  if (kind === 'action' || kind === 'schema') rows.push(await named(kind, ownerId, ref));
  if (kind === 'schema') rows.push(await named(kind, 'system', ref));
  return rows.filter((row): row is StoredThing => row !== null).sort(compare)[0] ?? null;
 } };
}

export async function compositionCandidates(): Promise<CompositionCandidates> {
 const reads = getBoundThingsPersistence(null);
 if (reads) return nativeCandidates(reads);
 const collection = await getThingsCollection();
 const sort = { 'crystal.version': -1 as const, updatedAt: -1 as const, shareId: 1 as const };
 return {
  exact: (shareId, kind, ownerId) => collection.findOne({ shareId, ...(kind ? { thingtime: kind } : {}), ...(ownerId ? { ownerId } : {}) } as any, { sort }) as Promise<StoredThing | null>,
  named: (kind, ownerId, ref) => collection.findOne({ ownerId, thingtime: kind, [`crystal.${nameField(kind)}`]: ref } as any, { sort }) as Promise<StoredThing | null>,
  addition: (kind, ownerId, ref) => collection.findOne({ thingtime: kind, $or: [{ shareId: ref }, ...(kind === 'action' ? [{ ownerId, 'crystal.actionKey': ref }] : kind === 'schema' ? [{ ownerId: { $in: [ownerId, 'system'] }, 'crystal.name': ref }] : [])] } as any,
   { sort: { 'crystal.version': -1, updatedAt: -1 } }) as Promise<StoredThing | null>
 };
}
