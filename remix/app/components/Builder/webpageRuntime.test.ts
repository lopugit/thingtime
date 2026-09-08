import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_SHARED_SOURCE_LOADS, evictSharedLoads, queryScopeOf, readSourceCache, sourceCacheKey, writeSourceCache } from './webpageRuntime';

// The bounds the page runtime puts on things it does not control: the
// shared-load map (how many in-flight/settled source requests it may retain),
// the URL query scope (what a link may put in front of a template), and the
// source cache key (whose data a cache line may paint).

test('the shared-load map never grows past a page worth of live blocks', () => {
	const promises = new Map<string, string>();
	// one `interval` source ticking for a whole session: a new key every tick,
	// and the runtime version never moves because no control ever runs
	for (let tick = 0; tick < MAX_SHARED_SOURCE_LOADS * 20; tick += 1) {
		promises.set(`clock:${tick}`, `result-${tick}`);
		evictSharedLoads(promises);
	}
	assert.equal(promises.size, MAX_SHARED_SOURCE_LOADS);
});

test('eviction is oldest-first, so the newest keys are the ones that survive', () => {
	const promises = new Map<string, number>();
	for (let index = 0; index < MAX_SHARED_SOURCE_LOADS + 3; index += 1) promises.set(`k${index}`, index);
	evictSharedLoads(promises);
	assert.equal(promises.size, MAX_SHARED_SOURCE_LOADS);
	assert.equal(promises.has('k0'), false);
	assert.equal(promises.has('k2'), false);
	assert.equal(promises.has('k3'), true);
	assert.equal(promises.has(`k${MAX_SHARED_SOURCE_LOADS + 2}`), true);
});

test('a full page of siblings loading at one version keeps every entry', () => {
	// the burst for one version is a single render pass — no block may lose the
	// entry another is still waiting on, or the dedupe silently stops deduping
	const promises = new Map<string, number>();
	for (let block = 0; block < MAX_SHARED_SOURCE_LOADS; block += 1) {
		promises.set(`block-${block}`, block);
		evictSharedLoads(promises);
	}
	assert.equal(promises.size, MAX_SHARED_SOURCE_LOADS);
	assert.equal(promises.has('block-0'), true);
});

test('evicting an already-small map is a no-op', () => {
	const promises = new Map<string, number>([['a', 1]]);
	evictSharedLoads(promises);
	assert.deepEqual([...promises.keys()], ['a']);
});

test('the query scope keeps plain names and drops the rest', () => {
	const scope = queryScopeOf('?id=abc&page-size=10&_draft=1&9bad=x&has%20space=y');
	assert.equal(scope.id, 'abc');
	assert.equal(scope['page-size'], '10');
	assert.equal(scope._draft, '1');
	assert.equal('9bad' in scope, false);
	assert.equal('has space' in scope, false);
});

test('the query scope caps value length and key count', () => {
	const long = 'x'.repeat(500);
	assert.equal(queryScopeOf(`?note=${long}`).note?.length, 200);
	const many = Array.from({ length: 80 }, (_value, index) => `k${index}=${index}`).join('&');
	assert.ok(Object.keys(queryScopeOf(`?${many}`)).length <= 32);
});

// ── source cache: whose last result a page may paint ────────────────────────
// /p/<page> is a shared public URL and a source result is the signed-in
// viewer's own private data, so the cache line has to be per-viewer. These
// pin the key shape itself: the seed is read in a lazy initializer, before
// the hook knows who is looking, so a page-only key would paint the previous
// account's data to the next person on the browser.

const withFakeStorage = (run: (store: Map<string, string>) => void): void => {
	const store = new Map<string, string>();
	const globals = globalThis as { window?: unknown };
	const had = 'window' in globals;
	const previous = globals.window;
	globals.window = {
		localStorage: {
			getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
			setItem: (key: string, value: string) => void store.set(key, value)
		}
	};
	try {
		run(store);
	} finally {
		if (had) globals.window = previous;
		else delete globals.window;
	}
};

test('a source cache key names the viewer, the page and the block', () => {
	assert.equal(sourceCacheKey('user-a', 'webpage-pokeworld', 'block-1'), 'tt-page-source:user-a:webpage-pokeworld:block-1');
});

test('no viewer means no cache line at all', () => {
	// signed out, or rendering outside a runtime provider (the builder canvas,
	// a gallery thumbnail): there is nobody to key the data to, so it neither
	// reads nor writes rather than falling back to a page-only key
	assert.equal(sourceCacheKey(null, 'webpage-pokeworld', 'block-1'), null);
	assert.equal(sourceCacheKey('user-a', null, 'block-1'), null);
	assert.equal(sourceCacheKey('user-a', 'webpage-pokeworld', ''), null);
	withFakeStorage((store) => {
		writeSourceCache(null, 'webpage-pokeworld', 'block-1', { secret: 'mine' });
		assert.equal(store.size, 0);
		assert.equal(readSourceCache(null, 'webpage-pokeworld', 'block-1'), undefined);
	});
});

test('one viewer never paints from another viewer’s cached source result', () => {
	withFakeStorage(() => {
		writeSourceCache('user-a', 'webpage-expenses', 'block-1', { rows: ['rent £900'] });
		// the same page and block, a different account on the same browser
		assert.equal(readSourceCache('user-b', 'webpage-expenses', 'block-1'), undefined);
		// ...and the signed-out visitor, which is what /p/ serves by default
		assert.equal(readSourceCache(null, 'webpage-expenses', 'block-1'), undefined);
		assert.deepEqual(readSourceCache('user-a', 'webpage-expenses', 'block-1'), { rows: ['rent £900'] });
	});
});

test('a `__proto__` query key never becomes a scope entry', () => {
	// the key clears QUERY_KEY_PATTERN, so what stops it is that `out.__proto__ =`
	// is a [[Set]] through Object.prototype's accessor: a string value is ignored
	// and no own property lands. Templates read own properties only, so the
	// token resolves to nothing rather than to a prototype.
	const scope = queryScopeOf('?__proto__=polluted&safe=yes');
	assert.equal(scope.safe, 'yes');
	assert.equal(Object.prototype.hasOwnProperty.call(scope, '__proto__'), false);
	assert.equal(Object.getPrototypeOf(scope), Object.prototype);
});
