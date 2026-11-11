import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { types } from 'node:util';
import { BSON } from 'mongodb';
import type { CollectionProvider } from '../../app/api/utils/documentStore/collectionContract';
import { NATIVE_HOME_HOST_KEY, hasNativeHomeSelection } from '../../app/api/utils/documentStore/nativeHomeSelection';
import { enforceExpectedDataPlaneIdentity } from '../../app/api/utils/mongodb/dataPlane';

export { hasNativeHomeSelection as isNativeHomeSelected };
export type NativeHomeOperation = Readonly<{ method: string; path: string }>;
export type NativeHomeComposition = {
 run<T>(work: () => T | Promise<T>): Promise<T>;
 supportedOperations: readonly NativeHomeOperation[];
 close?(): void;
};
export type NativeHomeComposer = (input: { provider: CollectionProvider; homePlaneId: string; keyId: string;
 vaultKey: Uint8Array; outboxKey: Uint8Array }) => Promise<NativeHomeComposition>;
type Profile = { format: 1; provider: 'sqlite'; profileId: string; homePlaneId: string; origin: string; sqliteFile: string; keyId: string;
 protectedKeys(): { jwt: Uint8Array; vault: Uint8Array; outbox: Uint8Array } };
export class NativeHomeRuntimeError extends Error {
 readonly code = 'NATIVE_HOME_UNAVAILABLE';
 constructor() { super('The protected native account profile is unavailable'); this.name = 'NativeHomeRuntimeError'; }
}
const unavailable = (): never => { throw new NativeHomeRuntimeError(); };
const ownValues = (value: unknown, names: string[]) => {
 if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return unavailable();
 const fields = Object.getOwnPropertyDescriptors(value);
 if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !names.includes(key)) ||
  names.some(key => !fields[key] || !Object.prototype.hasOwnProperty.call(fields[key], 'value'))) return unavailable();
 return Object.fromEntries(names.map(key => [key, fields[key].value]));
};
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function profile(value: unknown): Profile {
 const p = ownValues(value, ['format','provider','profileId','homePlaneId','origin','sqliteFile','keyId','protectedKeys']);
 if (p.format !== 1 || p.provider !== 'sqlite' || !uuid(p.profileId) || !uuid(p.keyId) ||
  p.homePlaneId !== 'native-sqlite:' + p.profileId || typeof p.sqliteFile !== 'string' || !isAbsolute(p.sqliteFile) || resolve(p.sqliteFile) !== p.sqliteFile ||
  typeof p.protectedKeys !== 'function' || typeof p.origin !== 'string') return unavailable();
 let url: URL;
 try { url = new URL(p.origin); } catch { return unavailable(); }
 if (url.origin !== p.origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1024) return unavailable();
 return Object.freeze(p) as Profile;
}
function assertAppliedKeys(result: { jwt: Buffer; vault: Buffer }, env: NodeJS.ProcessEnv) {
 const matches = (actual: string | undefined, expected: Buffer) => {
  const encoded = Buffer.from(expected.toString('base64url')), received = Buffer.from(actual || '');
  try { return encoded.length === received.length && timingSafeEqual(encoded, received); }
  finally { encoded.fill(0); received.fill(0); }
 };
 if (env.THINGTIME_DESKTOP_API_MODE === 'remote' || env.JWT_PRIVATE_KEY || env.JWT_PUBLIC_KEY || env.THINGTIME_ADMIN_VAULT_KEY ||
  !matches(env.JWT_SECRET, result.jwt) || !matches(env.THINGTIME_USER_VAULT_KEY, result.vault)) return unavailable();
}
function keys(p: Profile, env: NodeJS.ProcessEnv) {
 const supplied = ownValues(p.protectedKeys(), ['jwt','vault','outbox']);
 const result: Record<string, Buffer> = {};
 try {
  for (const name of ['jwt','vault','outbox']) {
   if (!types.isUint8Array(supplied[name]) || types.isProxy(supplied[name]) || supplied[name].byteLength !== 32) return unavailable();
   result[name] = Buffer.from(supplied[name]);
  }
  assertAppliedKeys(result as { jwt: Buffer; vault: Buffer }, env);
  return result as { jwt: Buffer; vault: Buffer; outbox: Buffer };
 } catch { for (const bytes of Object.values(result)) bytes.fill(0); return unavailable(); }
}
const readHost = () => {
 const descriptor = Object.getOwnPropertyDescriptor(globalThis, NATIVE_HOME_HOST_KEY);
 if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return unavailable();
 return descriptor.value;
};
const defaultComposer: NativeHomeComposer = async input => {
 const { createNativeAccountHttpHome } = await import('../../app/api/utils/documentStore/nativeAccountHttpHome');
 return createNativeAccountHttpHome(input);
};
export const nativeHomeUnavailableResponse = (code = 'NATIVE_HOME_UNAVAILABLE') => Response.json({ ok: false, code,
 error: 'This operation is unavailable in the selected protected native account profile.' },
 { status: 503, headers: { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' } });

/** One provider, one protected identity and one compiled repository composition.
 * Never accepts a database/key selector from a request or a downloadable file. */
export async function createNativeHomeRuntime(value: unknown, compose: NativeHomeComposer = defaultComposer, env: NodeJS.ProcessEnv = process.env) {
 const p = profile(value), protectedKeys = keys(p, env);
 let provider: CollectionProvider | undefined;
 let composition: NativeHomeComposition | undefined;
 try {
  let existing = false;
  try { const stat = await lstat(p.sqliteFile); if (!stat.isFile() || stat.isSymbolicLink()) return unavailable(); existing = stat.size > 0; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const { openSqliteDocumentStore } = await import('../../app/api/utils/documentStore/sqliteStore');
  const { createCollectionProvider } = await import('../../app/api/utils/documentStore/collectionProvider');
  provider = createCollectionProvider(await openSqliteDocumentStore(p.sqliteFile));
  const identity = createHmac('sha256', protectedKeys.vault).update('thingtime-native-home-store-binding-v1\0')
   .update(JSON.stringify([p.profileId, p.homePlaneId, p.keyId, p.sqliteFile, protectedKeys.jwt.toString('base64url'), protectedKeys.outbox.toString('base64url')])).digest('hex');
  await provider.transaction(tx => {
   const namespace = '@native-home-profile-v1';
   tx.defineCollection(namespace, { unique: [{ name: 'profile', path: ['id'], sparse: false, multikey: false }] });
   const collection = tx.collection(namespace), rows = collection.find({ filter: { op: 'eq', path: ['id'], value: 'identity' }, limit: 2 }).documents;
   if (rows.length) {
    const row = BSON.deserialize(rows[0]);
    if (rows.length !== 1 || row.format !== 1 || row.profileId !== p.profileId || row.keyId !== p.keyId || row.binding !== identity) return unavailable();
   } else {
    if (existing) return unavailable(); // Never adopt another populated native file.
    collection.insert(BSON.serialize({ _id: 'identity', id: 'identity', format: 1, profileId: p.profileId, keyId: p.keyId, binding: identity }));
   }
  });
  composition = await compose({ provider, homePlaneId: p.homePlaneId, keyId: p.keyId, vaultKey: protectedKeys.vault, outboxKey: protectedKeys.outbox });
  if (!composition || typeof composition.run !== 'function' || !Array.isArray(composition.supportedOperations)) return unavailable();
  const operations = composition.supportedOperations.map(operation => {
   if (!operation || !['GET','POST','PATCH','PUT','DELETE','HEAD'].includes(operation.method) ||
    !/^v1\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(operation.path)) return unavailable();
   return Object.freeze({ method: operation.method, path: operation.path });
  });
  if (new Set(operations.map(op => op.method + ' ' + op.path)).size !== operations.length) return unavailable();
  let closed = false, active = 0;
  const publicDataPlane = 'custom-' + createHash('sha256').update('native-home-v1\0' + p.profileId).digest('hex');
  return Object.freeze({
   publicDataPlane, origin: p.origin,
   snapshot: () => {
    let ready = !closed;
    try { if (ready) assertAppliedKeys(protectedKeys, env); } catch { ready = false; }
    return Object.freeze({ provider: 'sqlite', ready, supportedOperations: Object.freeze([...operations]) });
   },
   async dispatch(request: Request, operation: NativeHomeOperation, handler: () => Promise<Response>): Promise<Response> {
    if (closed) return nativeHomeUnavailableResponse();
    if (new URL(request.url).origin !== p.origin || request.headers.has('x-tt-mongo-url') || /(?:^|;)\s*tt_mongo\s*=/.test(request.headers.get('cookie') || ''))
     return nativeHomeUnavailableResponse('NATIVE_HOME_SELECTION_MISMATCH');
    const origin = request.headers.get('Origin');
    // Webmail opens the canonical token validation URL as a top-level page.
    // Fetches and every mutation retain the same-origin boundary.
    const verificationNavigation = operation.method === 'GET' && operation.path === 'v1/auth/verify-email' &&
     request.headers.get('sec-fetch-mode') === 'navigate' && request.headers.get('sec-fetch-dest') === 'document';
    if ((origin !== null && origin !== p.origin) || (request.headers.get('sec-fetch-site') === 'cross-site' && !verificationNavigation))
     return Response.json({ ok: false, error: 'The request origin is not permitted.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    if (!operations.some(op => op.method === operation.method && op.path === operation.path)) return nativeHomeUnavailableResponse('NATIVE_HOME_OPERATION_UNAVAILABLE');
    const planeFailure = enforceExpectedDataPlaneIdentity(request, publicDataPlane); if (planeFailure) return planeFailure;
    active++;
    try { assertAppliedKeys(protectedKeys, env); return await composition.run(handler); }
    catch (error) { return error instanceof Response ? error : nativeHomeUnavailableResponse(); }
    finally { active--; }
   },
   async close() {
    if (closed) return;
    if (active) throw new NativeHomeRuntimeError();
    closed = true;
    try { composition.close?.(); } finally {
     try { await provider!.close(); } finally { for (const bytes of Object.values(protectedKeys)) bytes.fill(0); }
    }
   }
  });
 } catch {
  try { composition?.close?.(); } catch { /* Retire owned provider/keys even if disposal refuses. */ }
  await provider?.close().catch(() => {});
  for (const bytes of Object.values(protectedKeys)) bytes.fill(0);
  return unavailable();
 }
}
export type NativeHomeRuntime = Awaited<ReturnType<typeof createNativeHomeRuntime>>;
let runtime: { host: unknown; promise: Promise<NativeHomeRuntime> } | null = null;
export async function getNativeHomeRuntime(): Promise<NativeHomeRuntime | null> {
 if (!hasNativeHomeSelection()) { if (runtime) return unavailable(); return null; }
 const host = readHost();
 if (runtime && runtime.host !== host) return unavailable();
 runtime ??= { host, promise: createNativeHomeRuntime(host) };
 return runtime.promise;
}
export async function runNativeHomeRequest(request: Request, operation: NativeHomeOperation, handler: () => Promise<Response>): Promise<Response> {
 try {
  const current = await getNativeHomeRuntime(); if (!current) return nativeHomeUnavailableResponse();
  return await current.dispatch(request, operation, async () => {
   if (readHost() !== runtime?.host) return unavailable();
   const response = await handler();
   if (readHost() !== runtime?.host) { await response.body?.cancel().catch(() => {}); return unavailable(); }
   return response;
  });
 } catch { return nativeHomeUnavailableResponse(); }
}
export async function closeNativeHomeRuntime() { if (runtime) await (await runtime.promise).close(); }
