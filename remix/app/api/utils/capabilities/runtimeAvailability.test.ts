import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEndpointDocs, apiRouteCapabilityId, createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { thingtimeCapabilityManifest } from './thingtimeCapabilities';
import { projectRuntimeCapabilities, type NativeCapabilitySnapshot } from './runtimeAvailability';
import { createThingtimeCapabilityChecker } from './requireCapability.client';
import { nativeHomeCapabilitySnapshot } from '../../../../server/utils/nativeHomeCapabilities';
import { NATIVE_HOME_HOST_KEY } from '../documentStore/nativeHomeSelection';
const origin = 'http://127.0.0.1:17873';
const runtime: NativeCapabilitySnapshot = { provider: 'sqlite', ready: true, supportedOperations: [
 ['POST', 'v1/auth/register'], ['POST', 'v1/login'], ['POST', 'v1/auth/logout'],
 ['GET', 'v1/auth/me'], ['GET', 'v1/auth/accounts'], ['GET', 'v1/auth/verify-email'],
 ['GET', 'v1/notifications'], ['POST', 'v1/notifications/read']
].map(([method, path]) => ({ method, path })) };
const keys = [...apiEndpointDocs.filter(doc => doc.endpoint.startsWith('/api/')).flatMap(doc => [doc.endpoint.slice(5), doc.endpoint.slice(5) + '-docs']), 'v1/private-diagnostic'];

test('both native manifests retain full registry while supported contracts and methods are explicit', () => {
 const hosted = thingtimeCapabilityManifest(origin), native = thingtimeCapabilityManifest(origin, runtime);
 const flatHosted = createApiCapabilitiesManifest(keys), flat = createApiCapabilitiesManifest(keys, null, runtime);
 assert.equal(native.origin, origin); assert.deepEqual(native.runtime, { provider: 'sqlite', ready: true }); assert.equal(native.gateway, null);
 assert.deepEqual(native.registeredFeatures, hosted.features); assert.deepEqual(flat.registeredFeatures, flatHosted.features);
 assert.deepEqual(native.operations.map(({ feature, methods, path }) => ({ feature, methods, path })), hosted.operations);
 assert.equal(flat.operations!.some(op => op.feature === apiRouteCapabilityId('v1/private-diagnostic')), true);
 for (const id of ['api.auth-register', 'api.login', 'api.auth-logout', 'api.auth-me', 'api.auth-accounts', 'api.auth-verify-email', 'api.notifications-read']) {
  assert.equal(native.features[id]?.version, hosted.features[id].version); assert.equal(flat.features[id], flatHosted.features[id]);
 }
 assert.equal(native.features['api.auth-register'].version, '1.4.0'); assert.equal(flat.features['api.capabilities'], '1.3.0');
 for (const id of ['api.things', 'api.storage-accounting', 'api.chatgpt-mcp', apiRouteCapabilityId('v1/private-diagnostic')]) {
  assert.equal(native.features[id], undefined); assert.equal(flat.features[id], undefined);
 }
 const registered = native.operations.find(op => op.path === '/api/v1/things')!;
 assert.deepEqual(registered.availableMethods, []); assert.equal(registered.available, false);
 assert.equal(native.operations.find(op => op.path === '/api/v1/auth/register')!.available, true);
 // Registry metadata is not authority to perform an unsupported operation.
 assert.ok(native.registeredFeatures!['api.things']);
 assert.equal(JSON.stringify(native).includes('supportedOperations'), false);
});
test('not-ready native retains discovery and docs but cannot claim account operations', () => {
 for (const ready of [false]) {
  const unavailable = { ...runtime, ready }, native = thingtimeCapabilityManifest(origin, unavailable), flat = createApiCapabilitiesManifest(keys, null, unavailable);
  assert.deepEqual(Object.keys(native.features), ['api.capabilities']);
  assert.equal(flat.features['api.capabilities'], '1.3.0'); assert.equal(flat.features['route.v1.capabilities'], '1.0.0');
  for (const id of ['api.auth-register', 'api.login', 'api.auth-me', 'api.things']) { assert.equal(native.features[id], undefined); assert.equal(flat.features[id], undefined); }
  assert.equal(native.operations.find(op => op.path === '/api/v1/things-docs')!.available, true);
 }
});
test('partial method support never advertises the whole semantic contract', () => {
 const result = projectRuntimeCapabilities({ 'api.synthetic': '1.0.0' }, [{ feature: 'api.synthetic', path: '/api/v1/synthetic', methods: ['GET', 'POST'] }], { provider: 'sqlite', ready: true, supportedOperations: [{ method: 'GET', path: 'v1/synthetic' }] });
 assert.equal(result.features['api.synthetic'], undefined); assert.deepEqual(result.operations[0].availableMethods, ['GET']); assert.equal(result.operations[0].available, false);
});
test('no selection preserves hosted shape; malformed native selection reports no authority or private data', async () => {
 const original = Object.getOwnPropertyDescriptor(globalThis, NATIVE_HOME_HOST_KEY);
 try {
  Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
  assert.equal(await nativeHomeCapabilitySnapshot(origin), undefined);
  const hosted = thingtimeCapabilityManifest(origin); assert.equal('runtime' in hosted, false); assert.equal('registeredFeatures' in hosted, false);
  assert.deepEqual(Object.keys(createApiCapabilitiesManifest()), ['ok', 'schemaVersion', 'features', 'dataEnvironment']);
  Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: { privatePath: '/private/must-not-publish', secret: 'must-not-publish' } });
  const status = await nativeHomeCapabilitySnapshot(origin); assert.deepEqual(status, { provider: 'sqlite', ready: false, supportedOperations: [] });
  assert.equal(JSON.stringify(thingtimeCapabilityManifest(origin, status)).includes('must-not-publish'), false);
 } finally { if (original) Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, original); else Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY); }
});
test('existing clients accept supported native contracts and refuse registry-only/missing/breaking/wrong-origin contracts', async t => {
 const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window'); Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
 t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window'); });
 for (const source of ['origin', 'active-api'] as const) {
  let body: unknown = source === 'origin' ? thingtimeCapabilityManifest(origin, runtime) : createApiCapabilitiesManifest(keys, null, runtime);
  const fetch = async () => Response.json(body), check = createThingtimeCapabilityChecker({ source });
  const transport = { fetch: fetch as typeof globalThis.fetch, currentOrigin: () => origin };
  await check('api.auth-register', '1.4.0', origin, transport);
  await assert.rejects(check('api.things', '1.64.0', origin, transport), /incompatible/);
  await assert.rejects(check('api.auth-register', '2.0.0', origin, transport), /incompatible/);
  body = source === 'origin' ? { ...thingtimeCapabilityManifest(origin, runtime), origin: 'https://other.invalid' } : { ...createApiCapabilitiesManifest(keys, null, runtime), origin: 'https://other.invalid' };
  await assert.rejects(check('api.auth-register', '1.4.0', origin, transport), /incompatible/);
 }
});
