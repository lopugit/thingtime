import type { Binary, Decimal128, Double, Int32, Long, ObjectId } from 'mongodb';

/** Explicit native collection vocabulary, deliberately not Mongo query syntax.
 * Equality is BSON-type-exact (Int32 != Double != Long); null != missing.
 * Paths address object fields only, never array positions or implicit traversal.
 * Comparison requires the same scalar BSON type. No collation or query code. */
export type CollectionIdentity = string | ObjectId;
export type CollectionScalar = null | boolean | string | number | Date | ObjectId | Binary | Decimal128 | Int32 | Double | Long;
export type CollectionFilter =
 | { op: 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; path: readonly string[]; value: CollectionScalar }
 | { op: 'exists'; path: readonly string[]; value: boolean }
 | { op: 'and' | 'or'; filters: readonly CollectionFilter[] };
export type CollectionUpdate =
 | { op: 'set'; path: readonly string[]; value: unknown }
 | { op: 'unset'; path: readonly string[] }
 | { op: 'increment'; path: readonly string[]; amount: number };
export type CollectionDefinition = { unique: readonly { name: string; path: readonly string[]; sparse: boolean; multikey: boolean }[] };
export type CollectionPage = { documents: Uint8Array[]; nextAfter: CollectionIdentity | null };
export type CollectionMutation = { matched: boolean; modified: boolean; document: Uint8Array | null };
/** Identity-key order is deterministic (ObjectIds before UTF-8 strings), not
 * Mongo sort order. Pages have caller-chosen sizes; internal scan batches never
 * truncate a collection. Current implementation scans O(n) rows per operation. */
export interface NativeCollection {
 insert(bson: Uint8Array): void;
 find(options: { filter?: CollectionFilter; after?: CollectionIdentity; limit: number }): CollectionPage;
 updateOne(filter: CollectionFilter, updates: readonly CollectionUpdate[]): CollectionMutation;
 deleteOne(filter: CollectionFilter): boolean;
}
export interface CollectionTransaction {
 /** Persist immutable definitions and validate existing rows before accepting
  * them. Names are separate per collection; sparse skips only missing fields.
  * Non-sparse missing is a null key. Multikey expands one scalar array level,
  * deduplicates a document's keys, and refuses nested arrays/objects. */
 defineCollection(name: string, definition: CollectionDefinition): void;
 collection(name: string): NativeCollection;
}
export interface CollectionProvider {
 transaction<T>(work: (session: CollectionTransaction) => T | Promise<T>): Promise<T>;
 /** Owns and closes the supplied primitive store. */
 close(): Promise<void>;
}
