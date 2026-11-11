import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { BSON } from 'mongodb';
import type { CollectionTransaction } from '../documentStore/collectionContract';
import type { NativeUserStorageSession } from '../documentStore/nativeUserStorage';

/** Internal persistence only. Authorization, kind/crystal validation, accounting
 * and Timeline recording remain responsibilities of the canonical services. */
export type StoredThing = Record<string, any>;
export type ThingsScope = Readonly<{ ownerId: string | null; homePlaneId: string; contentPlaneId: string; providerId: string }>;
export type ThingsSelection = {
 ownerId?: string; kinds?: readonly string[]; folder?: { kind: 'root' } | { kind: 'id'; id: string };
 targetId?: string; schemaId?: string; parentId?: string; cursor?: string | null; limit: number;
};
export type ThingsWindow = { documents: StoredThing[]; nextCursor: string | null };
export type ThingVersion = { id: string; identity: unknown; updatedAt: Date; headId?: string | null; sizeBytes?: number; folderId?: string | null };
export type ThingsTransactionBinding =
 | { kind: 'mongo'; collection: any; session: any }
 | { kind: 'native'; collections: CollectionTransaction; session: NativeUserStorageSession };
export interface ThingsReads {
 readExact(id: string): Promise<StoredThing | null>;
 readBatch(ids: readonly string[]): Promise<StoredThing[]>;
 readWindow(selection: ThingsSelection): Promise<ThingsWindow>;
}
export interface ThingsTransaction extends ThingsReads {
 insert(document: StoredThing): Promise<StoredThing>;
 compareAndSwap(expected: ThingVersion, document: StoredThing): Promise<boolean>;
 remove(expected: ThingVersion): Promise<StoredThing | null>;
 folderAncestors(id: string): Promise<StoredThing[]>;
 folderChildren(id: string): Promise<StoredThing[]>;
 lockFolder(id: string | null, movingFolderId?: string): Promise<void>;
 afterCommit(effect: () => Promise<void>): void;
}
export interface ThingsPersistence extends ThingsReads {
 readonly scope: ThingsScope;
 transaction<T>(mode: 'write' | 'delete', work: (transaction: ThingsTransaction) => Promise<T>): Promise<T>;
 close(): void;
}
export const thingsPersistenceError = (message: string): never => { throw new Error(`Things persistence: ${message}`); };
const string = (value: unknown): string => typeof value === 'string' && !!value && !value.includes('\0') ? value : thingsPersistenceError('invalid identity');
export function normalizeThingsSelection(input: ThingsSelection): Omit<ThingsSelection, 'cursor'> {
 if (!input || !Number.isSafeInteger(input.limit) || input.limit < 1) return thingsPersistenceError('invalid page size');
 const folder = input.folder;
 if (folder && (folder.kind !== 'root' && folder.kind !== 'id')) return thingsPersistenceError('invalid folder selection');
 return { limit: input.limit, ...(input.ownerId !== undefined ? { ownerId: string(input.ownerId) } : {}), ...(input.kinds ? { kinds: [...new Set(input.kinds.map(string))].sort() } : {}),
 ...(folder ? { folder: folder.kind === 'root' ? { kind: 'root' as const } : { kind: 'id' as const, id: string(folder.id) } } : {}),
 ...(input.targetId !== undefined ? { targetId: string(input.targetId) } : {}),
 ...(input.schemaId !== undefined ? { schemaId: string(input.schemaId) } : {}),
 ...(input.parentId !== undefined ? { parentId: string(input.parentId) } : {}) };
}
const selectionKey = (scope: ThingsScope, selection: Omit<ThingsSelection, 'cursor'>) => createHash('sha256').update(JSON.stringify([scope, selection])).digest('hex');
export function decodeThingsCursor(scope: ThingsScope, selection: Omit<ThingsSelection, 'cursor'>, cursor?: string | null): { createdAt: Date; id: string } | null {
 if (cursor === undefined || cursor === null) return null;
 try {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (Object.keys(parsed).sort().join(',') !== 'at,id,key,v' || parsed.v !== 1 || parsed.key !== selectionKey(scope, selection) || !Number.isSafeInteger(parsed.at)) return thingsPersistenceError('cursor selection mismatch');
  const createdAt = new Date(parsed.at); date(createdAt); return { createdAt, id: string(parsed.id) };
 } catch { return thingsPersistenceError('invalid or mismatched cursor'); }
}
export function thingsWindow(scope: ThingsScope, selection: Omit<ThingsSelection, 'cursor'>, documents: StoredThing[]): ThingsWindow {
 const rows = documents.slice(0, selection.limit), last = rows[rows.length - 1];
 return { documents: rows, nextCursor: documents.length > selection.limit && last ? Buffer.from(JSON.stringify({ v: 1, key: selectionKey(scope, selection), at: date(last.createdAt).getTime(), id: last.shareId })).toString('base64url') : null };
}
const date = (value: unknown): Date => value instanceof Date && Number.isFinite(+value) ? value : thingsPersistenceError('invalid content timestamp');
export const sameThingValue = (a: unknown, b: unknown) => Buffer.from(BSON.serialize({ value: a })).equals(Buffer.from(BSON.serialize({ value: b })));
export function matchesThingVersion(row: StoredThing, expected: ThingVersion): boolean {
 return row.shareId === string(expected.id) && sameThingValue(row._id, expected.identity) && +date(row.updatedAt) === +date(expected.updatedAt) &&
  (expected.headId === undefined || (row.timelineHeadId ?? null) === expected.headId) &&
  (expected.sizeBytes === undefined || row.sizeBytes === expected.sizeBytes) &&
  (expected.folderId === undefined || (row.folderId ?? null) === expected.folderId);
}
/** Driver operations are semantic; implementations never translate arbitrary
 * Mongo expressions into native filters. Binding is a trusted internal seam. */
export interface ThingsDriverReads {
 exact(id: string): Promise<StoredThing | null>;
 batch(ids: readonly string[]): Promise<StoredThing[]>;
 window(selection: Omit<ThingsSelection, 'cursor'>, after: { createdAt: Date; id: string } | null): Promise<StoredThing[]>;
}
export interface ThingsDriverTransaction extends ThingsDriverReads {
 binding: ThingsTransactionBinding;
 operation<T>(work: () => Promise<T>): Promise<T>;
 insert(document: StoredThing): Promise<StoredThing>;
 swap(expected: ThingVersion, document: StoredThing): Promise<boolean>;
 remove(expected: ThingVersion): Promise<StoredThing | null>;
}
export interface ThingsDriver extends ThingsDriverReads {
 transaction<T>(mode: 'write' | 'delete', work: (transaction: ThingsDriverTransaction) => Promise<T>): Promise<T>;
}
type Context = { active: boolean; failed: boolean; failure: unknown; ownerId: string; driver: ThingsDriverTransaction; checkOpen: () => void };
const contexts = new WeakMap<object, Context>(), current = new AsyncLocalStorage<Context>();
const refuseCurrent = (message: string): never => {
 const context = current.getStore();
 try { return thingsPersistenceError(message); } catch (error) { if (context) { context.failed = true; context.failure = error; } throw error; }
};
const check = (context: Context) => {
 if (!context.active || current.getStore() !== context) return thingsPersistenceError('expired or foreign transaction');
 if (context.failed) throw context.failure;
};
export function getThingsTransactionBinding(transaction: ThingsTransaction, ownerId: string): ThingsTransactionBinding {
 const context = contexts.get(transaction);
 if (!context) return thingsPersistenceError('unknown transaction');
 try { context.checkOpen(); check(context); if (context.ownerId !== ownerId) return thingsPersistenceError('transaction owner mismatch'); return context.driver.binding; }
 catch (error) { context.failed = true; context.failure = error; throw error; }
}
export function createThingsPersistence(scopeInput: ThingsScope, driver: ThingsDriver): ThingsPersistence {
 const scope = Object.freeze({ ownerId: scopeInput.ownerId === null ? null : string(scopeInput.ownerId), homePlaneId: string(scopeInput.homePlaneId), contentPlaneId: string(scopeInput.contentPlaneId), providerId: string(scopeInput.providerId) });
 let closed = false;
 const open = () => { if (closed) return thingsPersistenceError('repository is closed'); };
 const owned = (row: StoredThing) => { if (row.ownerId !== scope.ownerId) return thingsPersistenceError('document owner mismatch'); string(row.shareId); return row; };
 const reads = (source: ThingsDriverReads, guard: <T>(work: () => Promise<T>) => Promise<T>): ThingsReads => ({
  readExact: id => guard(async () => { const row = await source.exact(string(id)); return row; }),
  readBatch: ids => guard(async () => { const wanted = [...new Set(ids.map(string))], rows = await source.batch(wanted); const byId = new Map(rows.map(row => [row.shareId, row])); return wanted.flatMap(id => byId.has(id) ? [byId.get(id)!] : []); }),
  readWindow: input => guard(async () => { const selection = normalizeThingsSelection(input), after = decodeThingsCursor(scope, selection, input.cursor); const rows = await source.window(selection, after); return thingsWindow(scope, selection, rows); })
 });
 const outerGuard = async <T>(work: () => Promise<T>): Promise<T> => { open(); if (current.getStore()) return refuseCurrent('use the active transaction for reads'); const result = await work(); open(); return result; };
 return Object.freeze({ scope, ...reads(driver, outerGuard), close() { closed = true; },
  async transaction<T>(mode: 'write' | 'delete', work: (transaction: ThingsTransaction) => Promise<T>): Promise<T> {
   open(); if (!scope.ownerId) return thingsPersistenceError('writes require an authenticated owner');
   const ownerId = scope.ownerId;
   if (current.getStore() || !['write', 'delete'].includes(mode)) return refuseCurrent('invalid or nested transaction');
   let effects: (() => Promise<void>)[] = [];
   const result = await driver.transaction(mode, async source => {
    effects = [];
    const context: Context = { active: true, failed: false, failure: undefined, ownerId, driver: source, checkOpen: open };
    const guard = async <R>(operation: () => Promise<R>): Promise<R> => {
     try { open(); check(context); return await source.operation(async () => { const value = await operation(); check(context); open(); return value; }); }
     catch (error) { context.failed = true; context.failure = error; throw error; }
    };
    const tx: ThingsTransaction = {
     ...reads(source, guard),
     insert: row => guard(async () => { if (mode === 'delete') return thingsPersistenceError('deletion scope cannot insert content'); return source.insert(owned(row)); }),
     compareAndSwap: (expected, row) => guard(async () => {
      owned(row); if (row.shareId !== expected.id || !sameThingValue(row._id, expected.identity)) return thingsPersistenceError('immutable Thing identity changed');
      date(expected.updatedAt); return source.swap(expected, row);
     }),
     remove: expected => guard(async () => { date(expected.updatedAt); return source.remove(expected); }),
     folderChildren: id => guard(async () => { const rows: StoredThing[] = []; let cursor: string | null = null;
      do { const page = await tx.readWindow({ ownerId, folder: { kind: 'id', id: string(id) }, limit: 128, cursor }); rows.push(...page.documents); cursor = page.nextCursor; } while (cursor); return rows;
     }),
     folderAncestors: id => guard(async () => {
      const rows: StoredThing[] = [], seen = new Set<string>(); let next: string | null = string(id);
      while (next) { if (seen.has(next) || rows.length >= 64) return thingsPersistenceError('folder cycle or depth exceeded'); seen.add(next);
       const row = await tx.readExact(next); if (!row || row.ownerId !== scope.ownerId || !Array.isArray(row.thingtime) || !row.thingtime.includes('folder')) return thingsPersistenceError('folder unavailable'); rows.push(row); next = row.folderId == null ? null : string(row.folderId);
      } return rows;
     }),
     lockFolder: (id, movingFolderId) => guard(async () => {
      if (id === null) return;
      for (const row of await tx.folderAncestors(id)) {
       if (movingFolderId === row.shareId) return thingsPersistenceError('folder cannot enter itself or descendant');
       if (!await tx.compareAndSwap({ id: row.shareId, identity: row._id, updatedAt: row.updatedAt }, { ...row, folderMutationToken: randomUUID() })) return thingsPersistenceError('folder placement conflict');
      }
     }),
     afterCommit(effect) { try { open(); check(context); if (typeof effect !== 'function') return thingsPersistenceError('invalid effect'); effects.push(effect); } catch (error) { context.failed = true; context.failure = error; throw error; } }
    };
    contexts.set(tx, context);
    return current.run(context, async () => { try { const value = await work(tx); check(context); open(); return value; } finally { context.active = false; } });
   });
   for (const effect of effects) await effect(); return result;
  }
 });
}
