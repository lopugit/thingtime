import { getMongoDb } from './mongodb';

// Single source of truth for the status payload the API returns and the
// footer / status page consume.
export type MongoConnectionStatus = {
  connected: boolean;
  // human-friendly host (credentials stripped) for safe display
  host: string | null;
  dbName: string | null;
  // round-trip time of a `ping` command, in milliseconds
  pingMs: number | null;
  collections: number | null;
  checkedAt: string;
  error: string | null;
};

// The connection string is resolved here so every Mongo entrypoint (status,
// connection, scripts) reads it the same way. Never expose this value raw.
//
// Primary source is the Atlas SRV string in MONGODB_CONNECTION_STRING, which
// ships with a literal `<db_password>` placeholder — we substitute the secret
// from MONGO_PASS (URL-encoded so special characters can't corrupt the URI).
export const getMongoUri = () => {
  const connectionString = process.env.MONGODB_CONNECTION_STRING;

  if (connectionString) {
    const password = process.env.MONGO_PASS;
    return password
      ? connectionString.replaceAll('<db_password>', encodeURIComponent(password))
      : connectionString;
  }

  return process.env.THINGTIME_PRIVATE_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
};

// Strip protocol + credentials so a URI like
// `mongodb+srv://user:pass@cluster0.abc.mongodb.net/thingtime` is shown as
// `cluster0.abc.mongodb.net` and we never leak a password into the UI.
export const sanitiseHost = (uri?: string | null): string | null => {
  if (!uri) return null;
  try {
    const withoutProtocol = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
    const withoutCredentials = withoutProtocol.replace(/^[^@]*@/, '');
    const host = withoutCredentials.split(/[/?]/)[0];
    return host || null;
  } catch {
    return null;
  }
};

// Connects to MongoDB through the Thingtime API layer, pings it, and reports
// what it found. Fails fast (2s) and always closes the client so a status
// check never hangs a request or leaks a connection.
export const getMongoStatus = async (): Promise<MongoConnectionStatus> => {
  const checkedAt = new Date().toISOString();
  const uri = getMongoUri();
  const host = sanitiseHost(uri);

  let client: any;

  try {
    const { MongoClient } = await getMongoDb();

    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000
    });

    await client.connect();

    const db = client.db('thingtime');

    const start = Date.now();
    await db.command({ ping: 1 });
    const pingMs = Date.now() - start;

    const collections = (await db.listCollections().toArray()).length;

    return {
      connected: true,
      host,
      dbName: db.databaseName,
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
      pingMs: null,
      collections: null,
      checkedAt,
      error: err?.message || String(err)
    };
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore close errors — the status is already determined
    }
  }
};
