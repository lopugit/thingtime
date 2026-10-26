import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { mongoConnectionPolicy } from './mongoConnectionPolicy';

import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';

export const ENVIRONMENT_GATEWAY_VERSION = '1.0.0';
export const GATEWAY_OWNERSHIP_TTL_MS = 5_000;
export type GatewaySettings = { environment: string; origin: string; deploymentId: string; secret: string };
export type GatewayDescriptor = Omit<GatewaySettings, 'secret'>;
type GatewayManifest = {
  schemaVersion: number; origin: string; gateway?: GatewayDescriptor | null;
  features: Record<string, { version: string }>;
  operations: { feature: string; path: string; methods: string[] }[];
};

export class GatewayUnavailable extends Error {
  constructor() { super('The environment API gateway is unavailable or incompatible.'); }
}

export const gatewayOrigin = (value: string | undefined, env: Record<string, string | undefined> = process.env) => {
  if (!value) throw new GatewayUnavailable();
  let url: URL;
  try { url = new URL(value); } catch { throw new GatewayUnavailable(); }
  const testLoopback = env.NODE_ENV === 'test' && env.THINGTIME_GATEWAY_TEST_LOOPBACK === '1' &&
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !testLoopback) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new GatewayUnavailable();
  return url.origin;
};

export type MongoConnectionMode = 'proxy' | 'dedicated';
/** Deployment configuration only; request headers cannot select database access. */
export const getMongoConnectionMode = (env: Record<string, string | undefined> = process.env): MongoConnectionMode => {
  const mode = env.THINGTIME_MONGODB_CONNECTION_MODE;
  if (mode !== undefined && mode !== 'proxy' && mode !== 'dedicated') throw new GatewayUnavailable();
  return mode || mongoConnectionPolicy;
};

/** Vercel builds default to the gateway. Local/desktop standalone runtimes retain
 * their direct connection; partial deployment configuration always fails closed. */
export const getGatewaySettings = (env: Record<string, string | undefined> = process.env): GatewaySettings | null => {
  const keys = ['THINGTIME_GATEWAY_ENVIRONMENT', 'THINGTIME_GATEWAY_ORIGIN', 'THINGTIME_GATEWAY_SECRET',
    'THINGTIME_GATEWAY_DEPLOYMENT_ID', 'THINGTIME_GATEWAY_SOURCE_ORIGINS'];
  getMongoConnectionMode(env);
  if (!keys.some(key => env[key] !== undefined)) {
    if (env.VERCEL || env.VERCEL_ENV || env.THINGTIME_MONGODB_CONNECTION_MODE === 'proxy') throw new GatewayUnavailable();
    return null;
  }
  const environment = env.THINGTIME_GATEWAY_ENVIRONMENT || '';
  const deploymentId = env.THINGTIME_GATEWAY_DEPLOYMENT_ID || env.VERCEL_DEPLOYMENT_ID || env.VERCEL_URL || '';
  const secret = env.THINGTIME_GATEWAY_SECRET || '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(environment) || !/^[\w.-]{1,255}$/.test(deploymentId) || secret.length < 32 ||
    env.THINGTIME_DESKTOP === '1' || (env.THINGTIME_AGENT_TEST_MODE === '1' && env.NODE_ENV !== 'test')) throw new GatewayUnavailable();
  return { environment, origin: gatewayOrigin(env.THINGTIME_GATEWAY_ORIGIN, env), deploymentId, secret };
};

export const gatewayDescriptor = (env: Record<string, string | undefined> = process.env): GatewayDescriptor | null => {
  const settings = getGatewaySettings(env);
  if (!settings || getMongoConnectionMode(env) === 'dedicated') return null;
  const { secret: _secret, ...descriptor } = settings;
  return descriptor;
};

const readManifest = async (response: Response) => {
  if (!response.ok || !response.body) throw new GatewayUnavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) { await reader.cancel(); throw new GatewayUnavailable(); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GatewayManifest;
  } finally { reader.releaseLock(); }
};

export const createGatewayAuthority = (options: {
  settings?: () => GatewaySettings | null; fetch?: typeof fetch; now?: () => number; demoted?: () => void;
} = {}) => {
  const settings = options.settings || getGatewaySettings;
  const now = options.now || Date.now;
  let cache: { key: string; expires: number; value: GatewayManifest } | null = null;
  let pending: { key: string; promise: Promise<GatewayManifest> } | null = null;
  let wasOwner = false;
  const current = async (fresh = false) => {
    const selected = settings();
    if (!selected) return null;
    const key = createHash('sha256').update(JSON.stringify(selected)).digest('hex');
    try {
      if (!fresh && cache?.key === key && cache.expires > now()) return { settings: selected, manifest: cache.value, owner: cache.value.gateway!.deploymentId === selected.deploymentId };
      if (!pending || pending.key !== key) {
        const promise = (async () => {
          const response = await (options.fetch || globalThis.fetch)(new URL(THINGTIME_CAPABILITY_MANIFEST_PATH, selected.origin), {
            redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000)
          });
          const manifest = await readManifest(response);
          if (manifest.schemaVersion !== 1 || manifest.origin !== selected.origin ||
            manifest.gateway?.origin !== selected.origin || manifest.gateway.environment !== selected.environment ||
            typeof manifest.gateway.deploymentId !== 'string' || !manifest.gateway.deploymentId ||
            !capabilitySatisfies(manifest.features?.['api.environment-gateway']?.version, ENVIRONMENT_GATEWAY_VERSION) ||
            !Array.isArray(manifest.operations)) throw new GatewayUnavailable();
          cache = { key, expires: now() + GATEWAY_OWNERSHIP_TTL_MS, value: manifest };
          return manifest;
        })();
        pending = { key, promise };
      }
      const active = pending;
      let manifest: GatewayManifest;
      try { manifest = await active.promise; }
      finally { if (pending === active) pending = null; }
      // Never authorize an old selection after an asynchronous config change.
      if (JSON.stringify(settings()) !== JSON.stringify(selected)) throw new GatewayUnavailable();
      const owner = manifest.gateway!.deploymentId === selected.deploymentId;
      if (wasOwner && !owner) options.demoted?.();
      wasOwner = owner;
      return { settings: selected, manifest, owner };
    } catch {
      cache = null;
      if (wasOwner) options.demoted?.();
      wasOwner = false;
      throw new GatewayUnavailable();
    }
  };
  return { current, requireDatabase: async () => { const authority = await current(); if (authority && !authority.owner && getMongoConnectionMode() !== 'dedicated') throw new GatewayUnavailable(); } };
};

let activeWork = 0;
let draining = false;
let drainBarrier: Promise<unknown> = Promise.resolve();
const drains = new Set<() => Promise<void>>();
const finishDrain = () => {
  if (draining && activeWork === 0) {
    draining = false;
    // A rollback may re-admit this worker while close is still pending. All
    // new work waits for close + cache eviction before opening a fresh pool.
    drainBarrier = drainBarrier.then(() => Promise.allSettled([...drains].map(drain => drain())));
  }
};
export const registerGatewayDrain = (drain: () => Promise<void>) => { drains.add(drain); return () => drains.delete(drain); };
export const beginGatewayWork = () => {
  activeWork++;
  let ended = false;
  return () => { if (!ended) { ended = true; activeWork--; finishDrain(); } };
};
/** Detached waitUntil jobs must keep their lease through the final save. */
export const withGatewayWork = async <T>(work: () => Promise<T>): Promise<T> => {
  const end = beginGatewayWork();
  try { return await work(); } finally { end(); }
};
export const gatewayAuthority = createGatewayAuthority({ demoted: () => { draining = true; finishDrain(); } });
const admittedWork = new AsyncLocalStorage<boolean>();
export const runAdmittedGatewayWork = async <T>(work: () => Promise<T>) => {
  await drainBarrier;
  return admittedWork.run(true, work);
};
export const requireGatewayDatabaseAccess = async () => {
  // A request admitted while this was the owner may finish its transaction or
  // stream after promotion; new requests cannot borrow that scoped admission.
  if (admittedWork.getStore()) return;
  await drainBarrier;
  await gatewayAuthority.requireDatabase();
};
