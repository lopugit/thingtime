import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Connection state the shared MongoDB code keeps between requests: cached
 * clients, the home database handle and the readiness checks that use them.
 *
 * Node runtimes (Vercel, desktop, local dev) use one process-wide state, so
 * behaviour there is unchanged. Cloudflare Workers forbid using a socket opened
 * by one request or Durable Object from another, and several Durable Objects
 * can share an isolate, so each Cloudflare connection-pool shard runs its
 * requests inside its own state through `withMongoRuntimeState`. That keeps the
 * number of MongoDB connections bounded by the shard count, not by traffic.
 */
export type MongoRuntimeState = {
	clientCache: Map<string, Promise<any>>;
	homeDbPromise: Promise<any> | null;
	homeDbClient: any;
	transactionSupportProbed: boolean;
	homeRelationshipKeys: { promise: Promise<boolean>; expires: number } | null;
	indexesEnsured: Promise<void> | null;
	ensuredFingerprint: string | null;
	customIndexesEnsured: Map<string, Map<string, Promise<void>>>;
};

export const createMongoRuntimeState = (): MongoRuntimeState => ({
	clientCache: new Map(),
	homeDbPromise: null,
	homeDbClient: null,
	transactionSupportProbed: false,
	homeRelationshipKeys: null,
	indexesEnsured: null,
	ensuredFingerprint: null,
	customIndexesEnsured: new Map()
});

const processState = createMongoRuntimeState();
const scopedState = new AsyncLocalStorage<MongoRuntimeState>();

/** The state for the current request: its Durable Object's on Cloudflare, otherwise the process-wide one. */
export const mongoRuntimeState = (): MongoRuntimeState => scopedState.getStore() ?? processState;

/** Runs `work` with its own MongoDB connection state (used by Cloudflare pool shards). */
export const withMongoRuntimeState = <T>(state: MongoRuntimeState, work: () => T): T => scopedState.run(state, work);

/** Closes every cached client in `state` (a pool shard going idle). */
export const closeMongoRuntimeState = async (state: MongoRuntimeState) => {
	const clients = [...state.clientCache.values()];
	state.clientCache.clear();
	state.customIndexesEnsured.clear();
	state.homeDbPromise = null;
	state.homeDbClient = null;
	state.indexesEnsured = null;
	state.ensuredFingerprint = null;
	state.homeRelationshipKeys = null;
	state.transactionSupportProbed = false;
	await Promise.allSettled(clients.map(async (entry) => (await entry).close()));
};
