import type { LocalThing } from './things';
import type { WorkspaceTransaction } from './storage';

export type ThingChanges = Map<string, { before: LocalThing | null; after: LocalThing | null }>;
export type ThingTransactionCapture = <T>(tx: WorkspaceTransaction, run: (tx: WorkspaceTransaction) => Promise<T>) => Promise<T>;

/** Capture before-images before the first write, then record the final batch in
 * the SAME transaction. Imports can resolve dependencies written later in it. */
export async function captureThingChanges<T>(tx: WorkspaceTransaction, run: (tx: WorkspaceTransaction) => Promise<T>,
 record: (tx: WorkspaceTransaction, changes: ThingChanges) => Promise<void>,
 read = async (tx: WorkspaceTransaction, id: string): Promise<LocalThing | null> => await tx.get<LocalThing>('things', id) || null): Promise<T> {
 const before = new Map<string, Promise<LocalThing | null>>();
 const capture = (collection: string, id: string) => {
  if (collection === 'things' && !before.has(id)) before.set(id, read(tx, id));
 };
 const tracked: WorkspaceTransaction = { ...tx,
  put: async (collection, id, value) => { capture(collection, id); await before.get(id); await tx.put(collection, id, value); },
  delete: async (collection, id) => { capture(collection, id); await before.get(id); await tx.delete(collection, id); }
 };
 const result = await run(tracked), changes: ThingChanges = new Map();
 for (const [id, previous] of before) changes.set(id, {before: await previous, after: await read(tx, id)});
 await record(tx, changes);
 return result;
}
