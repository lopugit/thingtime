import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { BSON } from 'mongodb';
import { DocumentStoreError, type DocumentAddress, type DocumentPage, type DocumentScan, type DocumentStore, type DocumentTransaction } from './contract';

// The repo currently targets Node 20 types; the actual native runtime must ship
// node:sqlite. Keep this minimal binding local rather than changing global types.
type SqliteStatement = {
	get(...values: (string | Uint8Array | number)[]): Record<string, unknown> | undefined;
	all(...values: (string | Uint8Array | number)[]): Record<string, unknown>[];
	run(...values: (string | Uint8Array | number)[]): { changes: number | bigint };
};
type SqliteDatabase = { exec(sql: string): void; prepare(sql: string): SqliteStatement; close(): void };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
	DatabaseSync: new (path: string, options: { allowExtension: boolean; timeout: number }) => SqliteDatabase;
};
type Owner = { active: boolean; failed: boolean; failure: unknown };
const ownership = new AsyncLocalStorage<Owner>();
const lanes = new Map<string, { tail: Promise<void>; pending: number }>();

/** Handles for the same real file share a queue, including open/close, so an
 * async callback never deadlocks another local handle's synchronous busy wait. */
const enqueue = <T>(path: string, work: () => T | Promise<T>): Promise<T> => {
	let lane = lanes.get(path);
	if (!lane) {
		lane = { tail: Promise.resolve(), pending: 0 };
		lanes.set(path, lane);
	}
	lane.pending++;
	const result = lane.tail.then(work);
	lane.tail = result.then(() => undefined, () => undefined);
	return result.finally(() => {
		if (--lane.pending === 0 && lanes.get(path) === lane) lanes.delete(path);
	});
};
const refuseNested = () => {
	if (ownership.getStore()) throw new DocumentStoreError('TRANSACTION_OWNERSHIP', 'Nested or escaped transaction context cannot admit store operations');
};
const identifier = (value: string) => {
	if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.from(value, 'utf8').toString('utf8') !== value) throw new DocumentStoreError('INVALID_ADDRESS', 'Collection and document keys must be nonempty Unicode strings without NUL');
};
const addressValues = (address: DocumentAddress): [string, string] => {
	identifier(address?.collection);
	identifier(address?.key);
	return [address.collection, address.key];
};
const bsonBytes = (value: Uint8Array): Uint8Array => {
	if (!(value instanceof Uint8Array)) throw new DocumentStoreError('INVALID_BSON', 'Document must be BSON bytes');
	const bytes = Uint8Array.from(value);
	try { BSON.deserialize(bytes); }
	catch { throw new DocumentStoreError('INVALID_BSON', 'Document must contain one complete BSON document'); }
	return bytes;
};

const APPLICATION_ID = 0x54544453; // TTDS: distinct from unrelated SQLite files.
const FORMAT = 1;
const prepareDatabase = (db: SqliteDatabase) => {
	const applicationId = db.prepare('PRAGMA application_id').get()?.application_id;
	const version = db.prepare('PRAGMA user_version').get()?.user_version;
	if (applicationId === 0) {
		if (version !== 0 || db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) {
			throw new DocumentStoreError('STORE_FORMAT', 'Refusing an unrelated SQLite database');
		}
	} else if (applicationId !== APPLICATION_ID || version !== FORMAT) {
		throw new DocumentStoreError('STORE_FORMAT', 'Unsupported document store format');
	}
	db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
	db.exec('BEGIN IMMEDIATE');
	try {
		db.exec(`CREATE TABLE IF NOT EXISTS documents (
			collection TEXT NOT NULL COLLATE BINARY,
			document_key TEXT NOT NULL COLLATE BINARY,
			bson BLOB NOT NULL CHECK(typeof(bson) = 'blob'),
			PRIMARY KEY (collection, document_key)
		) WITHOUT ROWID;
		PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${FORMAT};`);
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
};

/** Opens only the caller-provided absolute file. Parent directory must already
 * exist. Does not choose a profile, configure authority, or claim API readiness. */
export const openSqliteDocumentStore = async (path: string): Promise<DocumentStore> => {
	refuseNested();
	if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new DocumentStoreError('INVALID_PATH', 'An absolute database file path is required');
	let canonicalPath: string;
	try { canonicalPath = realpathSync(path); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		canonicalPath = join(realpathSync(dirname(path)), basename(path));
	}
	return enqueue(canonicalPath, () => {
		const db = new DatabaseSync(canonicalPath, { allowExtension: false, timeout: 5_000 });
		try { prepareDatabase(db); }
		catch (error) { db.close(); throw error; }
		let closing = false;
		let closeResult: Promise<void> | undefined;
		return {
			transaction<T>(work: (session: DocumentTransaction) => T | Promise<T>): Promise<T> {
				try {
					refuseNested();
					if (closing) throw new DocumentStoreError('STORE_CLOSED', 'Document store is closing or closed');
					if (typeof work !== 'function') throw new DocumentStoreError('INVALID_TRANSACTION', 'Transaction callback required');
				} catch (error) { return Promise.reject(error); }
				return enqueue(canonicalPath, async () => {
					const owner: Owner = { active: true, failed: false, failure: undefined };
					const operation = <V>(work: () => V): V => {
						if (!owner.active || ownership.getStore() !== owner) throw new DocumentStoreError('TRANSACTION_OWNERSHIP', 'Session is outside its owning transaction');
						if (owner.failed) throw new DocumentStoreError('TRANSACTION_ABORTED', 'Transaction has already failed');
						try { return work(); }
						catch (error) { owner.failed = true; owner.failure = error; throw error; }
					};
					const session: DocumentTransaction = Object.freeze({
						read: (address: DocumentAddress) => operation(() => {
							const row = db.prepare('SELECT bson FROM documents WHERE collection=? AND document_key=?').get(...addressValues(address));
							return row ? Uint8Array.from(row.bson as Uint8Array) : undefined;
						}),
						insert: (address: DocumentAddress, bson: Uint8Array) => operation(() => {
							try { db.prepare('INSERT INTO documents(collection,document_key,bson) VALUES(?,?,?)').run(...addressValues(address), bsonBytes(bson)); }
							catch (error) {
								if ((error as { errcode?: number }).errcode === 1555 || (error as { errcode?: number }).errcode === 2067) throw new DocumentStoreError('DUPLICATE_DOCUMENT', 'Document key already exists in this collection');
								throw error;
							}
						}),
						put: (address: DocumentAddress, bson: Uint8Array) => operation(() => {
							db.prepare('INSERT INTO documents(collection,document_key,bson) VALUES(?,?,?) ON CONFLICT(collection,document_key) DO UPDATE SET bson=excluded.bson').run(...addressValues(address), bsonBytes(bson));
						}),
						delete: (address: DocumentAddress) => operation(() => Number(db.prepare('DELETE FROM documents WHERE collection=? AND document_key=?').run(...addressValues(address)).changes) > 0),
						scan: (collection: string, page: DocumentScan): DocumentPage => operation(() => {
							identifier(collection);
							if (!page || !Number.isSafeInteger(page.limit) || page.limit < 1) throw new DocumentStoreError('INVALID_SCAN', 'Scan requires a positive safe integer page size');
							if (page.after !== undefined) identifier(page.after);
							const rows = page.after === undefined
								? db.prepare('SELECT document_key,bson FROM documents WHERE collection=? ORDER BY document_key COLLATE BINARY LIMIT ?').all(collection, page.limit)
								: db.prepare('SELECT document_key,bson FROM documents WHERE collection=? AND document_key>? ORDER BY document_key COLLATE BINARY LIMIT ?').all(collection, page.after, page.limit);
							const documents = rows.map(row => ({ key: row.document_key as string, bson: Uint8Array.from(row.bson as Uint8Array) }));
							const last = documents[documents.length - 1]?.key;
							const more = last !== undefined && db.prepare('SELECT 1 FROM documents WHERE collection=? AND document_key>? LIMIT 1').get(collection, last);
							return { documents, nextAfter: more ? last : null };
						}),
					});
					db.exec('BEGIN IMMEDIATE');
					try {
						const result = await ownership.run(owner, () => work(session));
						if (owner.failed) throw owner.failure;
						db.exec('COMMIT');
						return result;
					} catch (error) {
						db.exec('ROLLBACK');
						throw error;
					} finally { owner.active = false; }
				});
			},
			close(): Promise<void> {
				try { refuseNested(); } catch (error) { return Promise.reject(error); }
				if (!closeResult) { closing = true; closeResult = enqueue(canonicalPath, () => db.close()); }
				return closeResult;
			},
		};
	});
};
