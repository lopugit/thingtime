import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncWindowRetention } from './syncWindowRetention';

test('an idle schedule keeps the native window retained after its active transfer ends', async () => {
 const writes: boolean[] = [], acquire = createSyncWindowRetention(async active => { writes.push(active); });
 const transfer = await acquire(), schedule = await acquire(); await transfer();
 assert.deepEqual(writes, [true, true, true]); await schedule(); assert.equal(writes.at(-1), false);
 await schedule(); assert.equal(writes.length, 4);
});

test('overlapping acquire/release operations serialize and never release another holder', async () => {
 const writes: boolean[] = [], acquire = createSyncWindowRetention(async active => { writes.push(active); });
 const first = await acquire(), next = acquire(), ending = first(); const second = await next; await ending;
 assert.equal(writes.at(-1), true); await second(); assert.equal(writes.at(-1), false);
});

test('failed retention removes its holder and a later authorized request can recover', async () => {
 const writes: boolean[] = []; let fail = true;
 const acquire = createSyncWindowRetention(async active => { if (fail) { fail = false; throw Error('native lease unavailable'); } writes.push(active); });
 await assert.rejects(acquire(), /unavailable/); assert.deepEqual(writes, [false]);
 const release = await acquire(); await release(); assert.deepEqual(writes, [false, true, false]);
});
