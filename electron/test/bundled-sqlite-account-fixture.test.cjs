'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fixture = path.resolve(__dirname, '../scripts/test-bundled-sqlite-account.cjs');
test('compiled SQLite fixture refuses unguarded direct invocation before opening any app/profile/server', () => {
 const result = spawnSync(process.execPath, [fixture], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 });
 assert.equal(result.status, 1);
 assert.match(result.stderr, /Protected SQLite account fixture failed/);
 assert.equal(result.stdout, '');
});
test('requiring the fixture does not execute it; opt-in still requires an exact independently recorded payload hash', () => {
 const { guard } = require(fixture), keys = ['THINGTIME_RUN_BUNDLED_SQLITE_ACCOUNT_TEST', 'THINGTIME_SQLITE_EXPECTED_NITRO_SHA'];
 const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
 try {
  delete process.env.THINGTIME_RUN_BUNDLED_SQLITE_ACCOUNT_TEST; assert.throws(guard, /opt-in/);
  process.env.THINGTIME_RUN_BUNDLED_SQLITE_ACCOUNT_TEST = '1'; delete process.env.THINGTIME_SQLITE_EXPECTED_NITRO_SHA;
  assert.throws(guard, process.platform === 'darwin' ? /Nitro SHA/ : /macOS/);
 } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('compiled fixture negotiates actual available account operations and refuses registered-only or false-ready advertisements', () => {
 const { assertNativeManifest, failureReceipt } = require(fixture);
 const manifest = () => ({ schemaVersion: 1, origin: 'http://127.0.0.1:19885', runtime: { provider: 'sqlite', ready: true },
  features: { 'api.root-data': { version: '1.2.0' }, 'api.auth-register': { version: '1.4.0' }, 'api.login': { version: '1.0.0' } }, registeredFeatures: { 'api.things': { version: '1.64.0' } },
  operations: [
   { path: '/api/root-data', methods: ['GET'], availableMethods: ['GET'] },
   { path: '/api/v1/auth/register', methods: ['POST'], availableMethods: ['POST'] },
   { path: '/api/v1/login', methods: ['POST'], availableMethods: ['POST'] },
   { path: '/api/v1/things', methods: ['GET', 'POST'], availableMethods: [] }
  ] });
 assert.doesNotThrow(() => assertNativeManifest(manifest()));
 const docsShape = manifest(); delete docsShape.origin; docsShape.ok = true;
 docsShape.features['api.auth-register'] = '1.4.0'; docsShape.features['api.login'] = '1.0.0';
 const flat = { kind: 'flat', responseUrl: 'http://127.0.0.1:19885/api/v1/capabilities' };
 assert.doesNotThrow(() => assertNativeManifest(docsShape, flat));
 assert.throws(() => assertNativeManifest(docsShape, { ...flat, responseUrl: 'https://other.invalid/api/v1/capabilities' }));
 assert.throws(() => assertNativeManifest(docsShape, { ...flat, responseUrl: 'http://127.0.0.1:19885/wrong' }));
 assert.throws(() => assertNativeManifest({ ...docsShape, ok: false }, flat));
 for (const mutate of [value => { value.runtime.ready = false; }, value => { value.origin = 'https://other.invalid'; },
  value => { value.features['api.auth-register'].version = '1.3.0'; }, value => { delete value.features['api.login']; },
  value => { value.features['api.things'] = value.registeredFeatures['api.things']; }, value => { value.operations[0].availableMethods = []; }]) {
  const value = manifest(); mutate(value); assert.throws(() => assertNativeManifest(value));
 }
 assert.deepEqual(Object.keys(failureReceipt()).sort(), ['httpStatus', 'manifestInvariant', 'ok', 'stage']);
});

test('Electron main entry runs the owned guarded child despite require.main differing; ordinary imports/renderers remain inert', () => {
 const { isFixtureEntry } = require(fixture);
 assert.equal(isFixtureEntry({ direct: true, electron: false }), true);
 assert.equal(isFixtureEntry({ direct: false, electron: true, processType: 'browser', childFlag: '1' }), true);
 for (const value of [{ direct: false, electron: false, childFlag: '1' }, { direct: false, electron: true, processType: 'renderer', childFlag: '1' },
  { direct: false, electron: true, processType: 'browser', childFlag: undefined }, { direct: false, electron: true, processType: 'browser', childFlag: '0' }])
  assert.equal(isFixtureEntry(value), false);
});
