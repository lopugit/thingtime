import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteBlocksCache } from './siteBlocksCache';
const current = () => {};
test('site blocks retain prior paint on failures and fence invalidated or retired loads', async () => {
 const cache = createSiteBlocksCache<string>();
 await cache.load('/one', async () => 'saved', current); assert.equal(cache.fresh('/one'), true);
 await cache.load('/one', async () => null, current); assert.deepEqual(cache.read('/one'), { data: 'saved', error: true });
 await cache.load('/one', async () => { throw new Error('offline'); }, current); assert.equal(cache.read('/one').data, 'saved');
 let finish!: (value: string) => void;
 const held = cache.load('/one', () => new Promise(resolve => { finish = resolve; }), current);
 await Promise.resolve(); cache.invalidate(); assert.equal(cache.fresh('/one'), false);
 await cache.load('/one', async () => 'newer', current); finish('stale'); await held;
 assert.equal(cache.read('/one').data, 'newer');
 await cache.load('/one', async () => 'other account', () => { throw new Error('retired'); });
 assert.equal(cache.read('/one').data, 'newer');
 cache.dispose(); await cache.load('/one', async () => 'late', current); assert.equal(cache.read('/one').data, null);
});
test('site block cache deduplicates concurrent reads and bounds route retention without losing global blocks', async () => {
 const cache = createSiteBlocksCache<string>(3); let count = 0, notifications = 0;
 const unsubscribe = cache.subscribe(() => notifications++);
 const loader = async () => { count++; return 'global'; };
 await Promise.all([cache.load('global', loader, current), cache.load('global', loader, current)]); assert.equal(count, 1);
 for (const path of ['/one', '/two', '/three']) await cache.load(path, async () => path, current);
 assert.equal(cache.read('global').data, 'global'); assert.equal(cache.read('/one').data, null); assert.equal(cache.read('/three').data, '/three');
 assert.equal(notifications, 4); unsubscribe();
});
