import type { ThingsReads, StoredThing } from '../things/persistence';

/** Native semantic reads supply candidates only. The canonical resolver still
 * authorizes each stored document through the live composition boundary. */
export async function nativeComponentCandidates(reads: ThingsReads, refs: string[], slugRefs: string[], ownerId: string | null): Promise<StoredThing[]> {
 const exactIds = new Set([...refs, ...slugRefs.map(ref => `component-${ref}`)]);
 const compare = (a: StoredThing, b: StoredThing) => (Number(b.crystal?.version) || 0) - (Number(a.crystal?.version) || 0) ||
  +new Date(b.updatedAt) - +new Date(a.updatedAt) || Buffer.compare(Buffer.from(a.shareId), Buffer.from(b.shareId));
 const best = new Map<string, StoredThing>();
 const retain = (row: StoredThing) => {
  const key = JSON.stringify(exactIds.has(row.shareId) ? ['exact', row.shareId] : ['owner', row.ownerId, row.crystal?.componentKey ?? row.shareId]);
  const previous = best.get(key);
  if (!previous || compare(row, previous) < 0) best.set(key, row);
 };
 const exact = await reads.readBatch([...new Set([...refs, ...slugRefs.map(ref => `component-${ref}`)])]);
 for (const row of exact) if (row.thingtime?.includes('component') && (refs.includes(row.shareId) || row.ownerId === 'system')) retain(row);
 if (ownerId && slugRefs.length) {
  let cursor: string | null = null;
  do {
   const page = await reads.readWindow({ ownerId, kinds: ['component'], limit: 128, cursor });
   for (const row of page.documents) if (slugRefs.includes(row.crystal?.componentKey)) retain(row);
   cursor = page.nextCursor;
  } while (cursor !== null);
 }
 // Match the hosted pre-selection order, including deterministic equal-version
 // ties. Identity deduplication must not let many revisions crowd out another key.
 return [...best.values()].sort(compare);
}

export async function nativeSitePageCandidates(reads: ThingsReads, owners: string[], match: Record<string, unknown>): Promise<StoredThing[]> {
 const documents: StoredThing[] = [];
 for (const ownerId of owners) {
  let cursor: string | null = null;
  do {
   const page = await reads.readWindow({ ownerId, kinds: ['webpage'], limit: 128, cursor });
   documents.push(...page.documents.filter(row => Object.entries(match).every(([key, value]) =>
    key.startsWith('crystal.') && row.crystal?.[key.slice('crystal.'.length)] === value)));
   documents.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
   documents.splice(8);
   cursor = page.nextCursor;
  } while (cursor !== null);
 }
 return documents.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}
