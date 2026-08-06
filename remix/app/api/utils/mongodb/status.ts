import { safeErrorText } from '../errors/safeError';
import { sanitiseMongoHost } from './config';
import { getActiveMongoDbName, getActiveMongoUri, isCustomMongoEndpointActive } from './endpoint';
import { getMongoDb } from './mongodb';

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
	checkedAt: string;
	error: string | null;
};

// Connects to MongoDB through the Thingtime API layer, pings it, and reports
// what it found. Checks the request's ACTIVE endpoint (the session's custom
// override when one is set, else home). Fails fast (2s) and always closes the
// client so a status check never hangs a request or leaks a connection.
export const getMongoStatus = async (): Promise<MongoConnectionStatus> => {
	const checkedAt = new Date().toISOString();
	const custom = isCustomMongoEndpointActive();
	let uri: string;
	let host: string | null = null;

	try {
		uri = getActiveMongoUri();
		host = sanitiseMongoHost(uri);
	} catch (err: any) {
		return {
			connected: false,
			host,
			dbName: null,
			custom,
			pingMs: null,
			collections: null,
			checkedAt,
			error: safeErrorText(err, 'mongodb status: config', 'MongoDB configuration error')
		};
	}

	let client: any;

	try {
		const { MongoClient } = await getMongoDb();

		client = new MongoClient(uri, {
			serverSelectionTimeoutMS: 2000,
			connectTimeoutMS: 2000
		});

		await client.connect();

		const db = client.db(getActiveMongoDbName());

		const start = Date.now();
		await db.command({ ping: 1 });
		const pingMs = Date.now() - start;

		const collections = (await db.listCollections().toArray()).length;

		return {
			connected: true,
			host,
			dbName: db.databaseName,
			custom,
			pingMs,
			collections,
			checkedAt,
			error: null
		};
	} catch (err: any) {
		return {
			connected: false,
			host,
			dbName: null,
			custom,
			pingMs: null,
			collections: null,
			checkedAt,
			error: safeErrorText(err, 'mongodb status: connect', 'MongoDB connection failed')
		};
	} finally {
		try {
			await client?.close();
		} catch {
			// ignore close errors — the status is already determined
		}
	}
};
