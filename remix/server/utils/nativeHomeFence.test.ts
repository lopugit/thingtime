import assert from 'node:assert/strict';
import test from 'node:test';
import { MongoClient } from 'mongodb';
import { H3 } from 'nitro/h3';
import { NATIVE_HOME_HOST_KEY, hasNativeHomeSelection } from '../../app/api/utils/documentStore/nativeHomeSelection';
import { getMongoUri } from '../../app/api/utils/mongodb/config';
import { getMongoDb } from '../../app/api/utils/mongodb/mongodb';
import { getCollection, getHomeCollection, getExistingHomeMongoDb, getMongoStatusConnection, withHomeMongoTransaction } from '../../app/api/utils/mongodb/collections';
import { runWithMongoEndpoint } from '../../app/api/utils/mongodb/endpoint';
import { getApiFallbackOrigin, hasSelfHostedApiEnv, proxyApiRequestToFallback, shouldProxyApiToFallback } from './apiFallback';
import handleApi from '../routes/api/[...]';
import handleRootData from '../routes/api/root-data.get';

test('native selection fences generic Mongo construction, cached driver factories, custom endpoints and every fallback before connection', async t => {
 const before = Object.fromEntries(['MONGODB_CONNECTION_STRING', 'JWT_SECRET', 'THINGTIME_DESKTOP', 'THINGTIME_DESKTOP_API_MODE', 'THINGTIME_API_FALLBACK_ORIGIN', 'NODE_ENV'].map(key => [key, process.env[key]]));
 const factory = await getMongoDb();
 const priorFactoryClient = new factory.MongoClient('mongodb://synthetic.invalid/thingtime');
 let attempts = 0, fetches = 0, accessorReads = 0;
 t.mock.method(MongoClient.prototype, 'connect', async function () { attempts++; return this; });
 t.mock.method(globalThis, 'fetch', async () => { fetches++; throw Error('native may not fetch a fallback'); });
 Object.assign(process.env, { MONGODB_CONNECTION_STRING: 'mongodb://synthetic.invalid/thingtime', JWT_SECRET: 'synthetic-conflicting-key', THINGTIME_DESKTOP: '1', THINGTIME_DESKTOP_API_MODE: 'remote', THINGTIME_API_FALLBACK_ORIGIN: 'https://synthetic.invalid', NODE_ENV: 'production' });
 const app = new H3();
 app.all('/api/root-data', handleRootData);
 app.all('/api/**', handleApi);
 const code = (e: any) => e.code === 'NATIVE_HOME_MONGO_UNAVAILABLE';
 try {
  for (const descriptor of [{ value: undefined }, { value: {} }, { get() { accessorReads++; throw Error('do not invoke'); } }]) {
   Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, ...descriptor });
   assert.throws(getMongoUri, code);
   await assert.rejects(getMongoDb(), code);
   await assert.rejects(priorFactoryClient.connect(), code);
   for (const work of [() => getCollection('things'), () => getHomeCollection('sessions'), getExistingHomeMongoDb,
    () => withHomeMongoTransaction(async () => { throw Error('no transaction may start'); }),
    () => runWithMongoEndpoint({ url: 'mongodb://override.invalid/foreign', savedId: null }, () => getCollection('things'))])
    await assert.rejects(work(), code);
   const status = getMongoStatusConnection();
   if ('getDb' in status) await assert.rejects(status.getDb(), code);
   else assert.equal((status.error as any).code, 'NATIVE_HOME_MONGO_UNAVAILABLE');
   assert.equal(hasSelfHostedApiEnv(), false); assert.equal(getApiFallbackOrigin(), null);
   const request = new Request('http://127.0.0.1:29481/api/v1/auth/register', { method: 'POST' });
   assert.equal(shouldProxyApiToFallback(request), false);
   assert.equal((await proxyApiRequestToFallback(request)).status, 503);
   for (const path of ['/api/v1/auth/register', '/api/v1/things', '/api/v1/credentials/import/create', '/api/root-data']) {
    const response = await app.fetch(new Request('http://127.0.0.1:29481' + path, { method: path === '/api/root-data' ? 'GET' : 'POST' }));
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get('Cache-Control') || '', /no-store/);
   }
   Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
  }
  assert.equal(attempts, 0); assert.equal(fetches, 0); assert.equal(accessorReads, 0);
 } finally {
  Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
  await priorFactoryClient.close();
  for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
 }
 assert.equal(hasNativeHomeSelection(), false);
});
