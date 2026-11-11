import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Execute the actual bootstrap filter without importing Nitro or using the host's
// real environment. Delimiters fail closed if bootstrap structure changes.
const source = fs.readFileSync(new URL('./entry.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const osKeys=new Set(');
const end = source.indexOf('const preservedOSKeys=', start);
assert(start >= 0 && end > start, 'Actual bootstrap environment filter must be located');
const filter = source.slice(start, end);

test('native Simulator root survives actual filter; account/API and lookalike keys do not', () => {
  const env = {
    IPHONE_SIMULATOR_ROOT: '/synthetic/runtime',
    SIMULATOR_ROOT: '/synthetic/simulator',
    HOME: '/synthetic/home',
    XPC_SERVICE_NAME: 'synthetic.native.service',
    IPHONE_SIMULATOR_ROOT_EXTRA: 'remove',
    IPHONE_OTHER: 'remove',
    THINGTIME_DESKTOP: 'remove',
    THINGTIME_API_URL: 'remove',
    MONGODB_URI: 'remove',
    JWT_SECRET: 'remove',
    OPENAI_API_KEY: 'remove',
    UNRELATED_VALUE: 'remove',
  };
  vm.runInNewContext(filter, { process: { env } }, { timeout: 1000 });
  assert.deepEqual(env, {
    IPHONE_SIMULATOR_ROOT: '/synthetic/runtime',
    SIMULATOR_ROOT: '/synthetic/simulator',
    HOME: '/synthetic/home',
    XPC_SERVICE_NAME: 'synthetic.native.service',
  });
});

test('filter does not synthesize a missing OS root or application configuration', () => {
  const env = { MONGODB_URI: 'remove', THINGTIME_DESKTOP: 'remove' };
  vm.runInNewContext(filter, { process: { env } }, { timeout: 1000 });
  assert.deepEqual(env, {});
});
