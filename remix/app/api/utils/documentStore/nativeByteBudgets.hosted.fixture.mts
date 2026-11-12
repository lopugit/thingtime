import assert from 'node:assert/strict';
import { mock } from 'node:test';
import Module from 'node:module';
import { createHash } from 'node:crypto';
import * as originals from '../mongodb/collections.ts';
const calls: any[] = []; let fail = false, admitted = true;
const started = new Date('2026-11-12T00:00:00Z');
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { defaultExport: {}, namedExports: { ...originals,
 ensureIndexes: async () => { calls.push(['indexes']); },
 getSettingsCollection: async () => ({ findOne: async () => null }),
 getRateLimitsCollection: async () => {
  if (fail) throw Error('hosted outage');
  return {
   updateOne: async (...args: any[]) => { calls.push(['update', ...args]); },
   findOneAndUpdate: async (...args: any[]) => { calls.push(['admit', ...args]); return admitted ? { bytes: 13, bytesWindowStartedAt: started } : null; },
   findOne: async (...args: any[]) => { calls.push(['read', ...args]); return { bytes: 512 * 1024 * 1024, bytesWindowStartedAt: started }; }
  };
 }
} });
const load = (Module as any)._load;
(Module as any)._load = function (name: string, ...args: unknown[]) { if (name === 'node:sqlite' || name.includes('nativeRateLimit')) throw Error('Hosted imported native persistence'); return Reflect.apply(load, this, [name, ...args]); };
const { consumeByteBudget, refundByteBudget } = await import('../rateLimit/byteBudget.ts');
const result = await consumeByteBudget('sandbox.storage.global', 12.9);
assert.deepEqual(result, { allowed: true, usedBytes: 13, limitBytes: 512 * 1024 * 1024, resetAt: new Date(started.getTime() + 3600000).toISOString() });
const key = createHash('sha256').update('bytes:sandbox.storage.global').digest('hex');
const upserts = calls.filter(c => c[0] === 'update');
assert.deepEqual(upserts[0][1], { key }); assert.deepEqual(upserts[0][3], { upsert: true });
assert.equal(upserts[0][2].$setOnInsert.bytes, 0);
assert.equal(upserts[1][1].bytesWindowStartedAt.$lte.getTime(), upserts[0][2].$set.updatedAt.getTime() - 3600000);
const admission = calls.find(c => c[0] === 'admit');
assert.deepEqual(admission[1], { key, bytes: { $lte: 512 * 1024 * 1024 - 12 } });
assert.equal(admission[2].$inc.bytes, 12); assert.deepEqual(admission[3], { returnDocument: 'after' });
admitted = false; assert.equal((await consumeByteBudget('sandbox.storage.global', 1)).allowed, false);
await refundByteBudget('sandbox.storage.global', 4.9);
const refund = calls.filter(c => c[0] === 'update').at(-1);
assert.deepEqual(refund[1], { key });
assert.deepEqual(refund[2], [{ $set: { bytes: { $max: [0, { $subtract: [{ $ifNull: ['$bytes', 0] }, 4] }] } } }]);
fail = true; assert.equal((await consumeByteBudget('sandbox.storage.global', 1)).unavailable, true);
await refundByteBudget('sandbox.storage.global', 1);
console.log('hosted-byte-budget-operations-ok');
