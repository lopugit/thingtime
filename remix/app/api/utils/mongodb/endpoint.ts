import { AsyncLocalStorage } from 'node:async_hooks';

import { createCookie } from '~/api/cookies';

import { PublicError, safeErrorText } from '../errors/safeError';
import { getMongoUri, sanitiseMongoHost } from './config';
import { getMongoDb } from './mongodb';

// Request-scoped MongoDB endpoint override — "Thingtime as a thin frontend".
// A browser session (logged in or not) may point the DATA PLANE (the `things`
// collection: posts, comments, reactions, data, schemas, app-data) at any
// MongoDB it can reach; identity and auth (users, sessions, rosters, the
// protected system kinds and every satellite collection) always stay on the
// home deployment DB so login, saved endpoints and revocation keep working
// while an override is active. collections.ts encodes that split.
//
// The selection travels as an httpOnly SESSION cookie (`tt_mongo`) set only by
// the endpoint API routes — JS never sees the URL, and closing the browser
// drops the override — or as an `x-tt-mongo-url` header for Bearer API
// clients. The API dispatcher (server/routes/api/[...].ts) resolves it once
// per request and establishes this AsyncLocalStorage context around the route
// handler, so every util below it resolves the same endpoint without threading
// a request through the whole call graph.

export type MongoEndpointSelection = {
  // full mongodb:// URI, possibly with embedded credentials — SERVER-SIDE ONLY,
  // never echo it (or any error text containing it) back to a client
  url: string;
  // id of the saved endpoint this selection came from (null for a raw URL)
  savedId: string | null;
};

const MAX_MONGO_URL_LENGTH = 2048;
const DEFAULT_DB_NAME = 'thingtime';

// Validate a user-supplied MongoDB connection string. Shape-only — reachability
// is probeMongoUrl's job. Throws PublicError with messages that never echo the
// URL itself (it may embed credentials).
export const validateMongoUrl = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new PublicError('MongoDB URL is required');
  }
  const url = raw.trim();
  if (url.length > MAX_MONGO_URL_LENGTH) {
    throw new PublicError(`MongoDB URL must be at most ${MAX_MONGO_URL_LENGTH} characters`);
  }
  if (!/^mongodb(\+srv)?:\/\//i.test(url)) {
    throw new PublicError('MongoDB URL must start with mongodb:// or mongodb+srv://');
  }
  // control characters / whitespace would corrupt the cookie + driver parse
  if (/[\s\u0000-\u001f]/.test(url)) {
    throw new PublicError('MongoDB URL must not contain whitespace or control characters');
  }
  if (!sanitiseMongoHost(url)) {
    throw new PublicError('MongoDB URL must include a host');
  }
  return url;
};

// Database name from the URI path (`mongodb://host:port/mydb?opts` → `mydb`),
// falling back to the canonical `thingtime` when the URL names none.
export const dbNameFromMongoUrl = (url: string): string => {
  try {
    const afterHost = url.replace(/^mongodb(\+srv)?:\/\//i, '').replace(/^[^@]*@/, '');
    const path = afterHost.split('?')[0].split('/').slice(1).join('/');
    const name = decodeURIComponent(path).trim();
    return name || DEFAULT_DB_NAME;
  } catch {
    return DEFAULT_DB_NAME;
  }
};

// httpOnly session cookie (no maxAge → dropped when the browser closes, which
// is exactly the "override for this frontend session" contract).
const mongoEndpointCookie = createCookie('tt_mongo', {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/'
});

// Resolve the request's endpoint selection: header first (API-client parity
// with Bearer auth), then cookie. Anything malformed counts as no selection —
// the request just runs against the home DB.
export const getRequestMongoEndpoint = async (request: Request): Promise<MongoEndpointSelection | null> => {
  const header = request.headers.get('x-tt-mongo-url');
  if (header) {
    try {
      return { url: validateMongoUrl(header), savedId: null };
    } catch {
      return null;
    }
  }

  const value = await mongoEndpointCookie.parse(request.headers.get('Cookie'));
  const raw = typeof value === 'string' ? { url: value, savedId: null } : value;
  if (!raw || typeof raw !== 'object' || typeof (raw as any).url !== 'string') return null;
  try {
    return {
      url: validateMongoUrl((raw as any).url),
      savedId: typeof (raw as any).savedId === 'string' ? (raw as any).savedId : null
    };
  } catch {
    return null;
  }
};

export const serializeMongoEndpointCookie = (selection: MongoEndpointSelection) =>
  mongoEndpointCookie.serialize({ url: selection.url, savedId: selection.savedId });
export const clearMongoEndpointCookie = () => mongoEndpointCookie.serialize('', { maxAge: 0 });

const mongoEndpointStorage = new AsyncLocalStorage<MongoEndpointSelection>();

// Establish (or skip, for null) the endpoint context around a request handler.
export const runWithMongoEndpoint = <T>(selection: MongoEndpointSelection | null, fn: () => T): T =>
  selection ? mongoEndpointStorage.run(selection, fn) : fn();

export const getActiveMongoEndpoint = (): MongoEndpointSelection | null =>
  mongoEndpointStorage.getStore() ?? null;

// The data plane's URI: the request's override when one is active, else home.
// A custom selection that equals the home URI is treated as home (no override).
export const getActiveMongoUri = (): string => {
  const selection = getActiveMongoEndpoint();
  if (!selection) return getMongoUri();
  return selection.url;
};

export const isCustomMongoEndpointActive = (): boolean => {
  const selection = getActiveMongoEndpoint();
  if (!selection) return false;
  try {
    return selection.url !== getMongoUri();
  } catch {
    // home URI unconfigured — the override is all we have, so it is custom
    return true;
  }
};

export const getActiveMongoDbName = (): string => {
  const selection = getActiveMongoEndpoint();
  return selection && isCustomMongoEndpointActive() ? dbNameFromMongoUrl(selection.url) : DEFAULT_DB_NAME;
};

export type MongoProbeResult =
  | { ok: true; host: string | null; dbName: string; pingMs: number }
  | { ok: false; error: string };

// Reachability check before an endpoint is activated or saved: connect + ping
// with tight timeouts, always closed. Errors surface via safeErrorText (class
// name + code only), so a URL with embedded credentials can never leak back.
export const probeMongoUrl = async (url: string): Promise<MongoProbeResult> => {
  let client: any;
  try {
    const { MongoClient } = await getMongoDb();
    client = new MongoClient(url, {
      serverSelectionTimeoutMS: 2500,
      connectTimeoutMS: 2500
    });
    await client.connect();
    const start = Date.now();
    await client.db(dbNameFromMongoUrl(url)).command({ ping: 1 });
    return { ok: true, host: sanitiseMongoHost(url), dbName: dbNameFromMongoUrl(url), pingMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: safeErrorText(err, 'mongodb endpoint: probe', 'Could not connect to MongoDB endpoint') };
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore close errors — the probe outcome is already determined
    }
  }
};
