/** Storage primitives only. Filters, updates, indexes, ACLs and accounting belong
 * to the canonical provider integration; this is not a Mongo-compatible API. */
export type DocumentAddress = Readonly<{ collection: string; key: string }>;
export type StoredDocument = Readonly<{ key: string; bson: Uint8Array }>;
export type DocumentScan = Readonly<{ after?: string; limit: number }>;
export type DocumentPage = Readonly<{ documents: StoredDocument[]; nextAfter: string | null }>;

/** Explicit session, usable only in its owning transaction's async context.
 * Byte buffers are copied on both input and output. BSON is never JSON encoded.
 * Operations are synchronous so unawaited writes cannot outlive the callback. */
export interface DocumentTransaction {
	read(address: DocumentAddress): Uint8Array | undefined;
	insert(address: DocumentAddress, bson: Uint8Array): void;
	put(address: DocumentAddress, bson: Uint8Array): void;
	delete(address: DocumentAddress): boolean;
	scan(collection: string, page: DocumentScan): DocumentPage;
}

export interface DocumentStore {
	/** The callback may await work. All work on this database file is serialized
	 * in-process, and any thrown/rejected error rolls back the entire callback.
	 * A failed session operation also aborts commit even if its error was caught.
	 * Nested transactions (including another store) are explicitly refused. */
	transaction<T>(work: (session: DocumentTransaction) => T | Promise<T>): Promise<T>;
	/** Waits for previously admitted transactions; rejects new admission. */
	close(): Promise<void>;
}

export class DocumentStoreError extends Error {
	constructor(public readonly code: string, message: string) {
		super(message);
		this.name = 'DocumentStoreError';
	}
}
