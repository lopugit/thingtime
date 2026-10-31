import { safeErrorText } from '../errors/safeError';
import { sanitiseMongoHost } from './config';
import { getMongoStatusConnection } from './collections';

// Single source of truth for the status payload the API returns and the
// footer / status page consume.
export type MongoConnectionStatus = {
	connected: boolean;
	// human-friendly host (credentials stripped) for safe display
	host: string | null;
	dbName: string | null;
	// true when the session's custom endpoint override (endpoint.ts) is what
	// was checked, rather than the home deployment DB
	custom: boolean;
	// round-trip time of a `ping` command, in milliseconds
	pingMs: number | null;
	collections: number | null;
	// replica set name from `hello` — null on a STANDALONE mongod, where
	// multi-document transactions (registration, storage accounting) fail
	replicaSet: string | null;
	checkedAt: string;
	error: string | null;
};

type StatusConnection = Exclude<ReturnType<typeof getMongoStatusConnection>, { error: unknown }>;

// No result cache: each completed read is fresh. Only simultaneous reads of
// the exact URI, database and selection share work, never another identity.
export const createMongoStatusReader = (
	connection: typeof getMongoStatusConnection,
	timeoutMs = 2000
) => {
	const inflight = new Map<string, Promise<MongoConnectionStatus>>();
	return async (): Promise<MongoConnectionStatus> => {
		const checkedAt = new Date().toISOString();
		let selected: StatusConnection;
		let custom = false;
		try {
			const snapshot = connection();
			custom = snapshot.custom;
			if ('error' in snapshot) throw snapshot.error;
			selected = snapshot;
		} catch (error) {
			return {
				connected: false, host: null, dbName: null, custom, pingMs: null,
				collections: null, replicaSet: null, checkedAt,
				error: safeErrorText(error, 'mongodb status: config', 'MongoDB configuration error')
			};
		}
		// This key is process-local only and must never be logged or returned.
		const key = JSON.stringify([selected.uri, selected.dbName, selected.custom]);
		const existing = inflight.get(key);
		if (existing) return existing;
		const host = sanitiseMongoHost(selected.uri);
		const failed = (error: unknown): MongoConnectionStatus => ({
			connected: false, host, dbName: null, custom: selected.custom, pingMs: null,
			collections: null, replicaSet: null, checkedAt,
			error: safeErrorText(error, 'mongodb status: connect', 'MongoDB connection failed')
		});
		const deadline = Date.now() + timeoutMs;
		const timeoutError = () => Object.assign(new Error('MongoDB status deadline exceeded'), { name: 'MongoOperationTimeoutError' });
		const options = () => {
			const remaining = deadline - Date.now();
			if (remaining <= 0) throw timeoutError();
			return { timeoutMS: remaining };
		};
		let timer: ReturnType<typeof setTimeout>;
		const probe = async (): Promise<MongoConnectionStatus> => {
			const db = await selected.getDb();
			const start = Date.now();
			await db.command({ ping: 1 }, options());
			const pingMs = Date.now() - start;
			const collections = (await db.listCollections({}, { nameOnly: true, ...options() }).toArray()).length;
			// Preserve the optional hello behavior on deployments denying that command.
			const hello = await db.command({ hello: 1 }, options()).catch((error: unknown) => {
				if (error instanceof Error && error.name === 'MongoOperationTimeoutError') throw error;
				return null;
			});
			// A driver deadline can settle before the outer timer callback runs.
			// Optional replica metadata must never turn an expired probe green.
			if (Date.now() >= deadline) throw timeoutError();
			return {
				connected: true, host, dbName: db.databaseName, custom: selected.custom,
				pingMs, collections, replicaSet: typeof hello?.setName === 'string' ? hello.setName : null,
				checkedAt, error: null
			};
		};
		const pending = Promise.race([
			probe(),
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeoutError()), timeoutMs); })
		]).catch(failed).finally(() => {
			clearTimeout(timer);
			inflight.delete(key);
		});
		inflight.set(key, pending);
		return pending;
	};
};

// Reuse the application pool without closing it, adopting collections, or
// starting indexes. A slow shared connection remains available to ordinary
// requests while this diagnostic returns disconnected at its own deadline.
export const getMongoStatus = createMongoStatusReader(getMongoStatusConnection);
