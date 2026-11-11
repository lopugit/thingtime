import assert from 'node:assert/strict';
import { mock } from 'node:test';
import Module from 'node:module';
import * as originals from '../mongodb/collections.ts';
const calls: any[] = []; let fail = false;
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { defaultExport: {}, namedExports: { ...originals,
 getSettingsCollection: async () => ({ findOne: async (filter: any) => { calls.push(['config', filter]); return null; }, updateOne: async (...args: any[]) => { calls.push(['settings', ...args]); } }),
 getRateLimitsCollection: async () => { if (fail) throw Error('synthetic hosted outage'); return {
  updateOne: async (...args: any[]) => { calls.push(['upsert', ...args]); },
  findOneAndUpdate: async (...args: any[]) => { calls.push(['consume', ...args]); return { requests: [new Date()] }; }
 }; }
} });
const load = (Module as any)._load; (Module as any)._load = function (name: string, ...args: unknown[]) { if (name === 'node:sqlite' || name.includes('nativeRateLimit')) throw Error('Hosted path imported native persistence'); return Reflect.apply(load, this, [name, ...args]); };
const { enforceRateLimit, enforceFixedRateLimit } = await import('../rateLimit/enforce.ts');
const { setRateLimitConfig } = await import('../rateLimit/config.ts');
const request = new Request('http://127.0.0.1:17873/api/v1/auth/login');
assert.equal((await enforceRateLimit(request, 'auth.login', null)).allowed, true);
assert.deepEqual(calls[0], ['config', { key: 'rateLimits' }]);
const upsert = calls[1], consume = calls[2]; assert.equal(upsert[0], 'upsert'); assert.equal(upsert[1].key, consume[1].key); assert.deepEqual(upsert[3], { upsert: true });
assert.deepEqual(consume[1].$expr.$lte[0].$add[0].$size.$filter.input, { $ifNull: ['$requests', []] });
assert.equal(consume[1].$expr.$lte[1], 30); assert.equal(consume[1].$expr.$lte[0].$add[1], 1);
assert.equal(consume[2][0].$set.requests.$concatArrays[1].length, 1); assert.deepEqual(consume[3], { returnDocument: 'after' });
await setRateLimitConfig({ 'auth.login': { limit: 19 } } as any, 'fixture'); const settings = calls.find(c => c[0] === 'settings'); assert.deepEqual(settings[1], { key: 'rateLimits' }); assert.equal(settings[2].$set.endpoints['auth.login'].limit, 19); assert.deepEqual(settings[3], { upsert: true });
fail = true; assert.equal((await enforceRateLimit(request, 'auth.login', null)).allowed, true); const closed = await enforceFixedRateLimit(request, 'fixed', null, { limit: 2, windowMs: 1000 }); assert.equal(closed.allowed, false); assert.equal(closed.unavailable, true);
console.log('hosted-rate-limit-operations-ok');
