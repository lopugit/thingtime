import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

// A static import is safe here even though the window stub is installed below:
// localCache only defines functions at module scope and reads window.localStorage
// inside each call, so nothing captures storage at load time. It also has to be
// static — `node --import tsx --test` transforms these files to CJS, which
// rejects top-level await.
import { clearLocalCache, pruneCacheNamespace, readLocalCache, readStampedCache, writeLocalCache, writeStampedCache } from './localCache';

// A minimal localStorage stand-in with the one property the prune loop
// depends on: key(i) walks insertion order, and removing while iterating
// would skip entries (which is why the helpers collect first, then delete).
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

(globalThis as any).window = { localStorage: new MemoryStorage() };

const storage = () => (globalThis as any).window.localStorage as MemoryStorage;
const keysUnder = (prefix: string): string[] => {
  const out: string[] = [];
  for (let index = 0; index < storage().length; index++) {
    const key = storage().key(index);
    if (key && key.startsWith(prefix)) out.push(key);
  }
  return out;
};

// write a stamped entry with an explicit `at`, so eviction order is exact
const writeAt = (key: string, at: number, data: unknown) => writeLocalCache(key, { at, data });

beforeEach(() => {
  (globalThis as any).window = { localStorage: new MemoryStorage() };
});

test('writeStampedCache round-trips through readStampedCache', () => {
  writeStampedCache('tt-thing-u1-a', { kind: 'thing', id: 'a' });
  assert.deepEqual(readStampedCache('tt-thing-u1-a'), { kind: 'thing', id: 'a' });
  assert.equal(typeof readLocalCache<{ at: number }>('tt-thing-u1-a')?.at, 'number');
});

test('readStampedCache tolerates an unstamped legacy value', () => {
  // the shape tt-component-family-/tt-schema-things- wrote before the envelope
  writeLocalCache('tt-component-family-u1:card', [{ id: 'component-card' }]);
  assert.deepEqual(readStampedCache('tt-component-family-u1:card'), [{ id: 'component-card' }]);
  assert.equal(readStampedCache('tt-component-family-u1:missing'), null);
});

test('pruneCacheNamespace keeps the max most recent entries, oldest evicted first', () => {
  for (let index = 0; index < 6; index++) writeAt(`tt-thing-u1-${index}`, 1000 + index, { id: index });
  // writing #6 with a cap of 3 leaves #6 plus the two newest survivors
  pruneCacheNamespace('tt-thing-', 'tt-thing-u1-6', 3);
  writeAt('tt-thing-u1-6', 1006, { id: 6 });
  assert.deepEqual(keysUnder('tt-thing-').sort(), ['tt-thing-u1-4', 'tt-thing-u1-5', 'tt-thing-u1-6']);
});

test('pruneCacheNamespace never evicts the key being written, even when it is oldest', () => {
  writeAt('tt-thing-u1-old', 1, { id: 'old' });
  for (let index = 0; index < 5; index++) writeAt(`tt-thing-u1-${index}`, 1000 + index, { id: index });
  pruneCacheNamespace('tt-thing-', 'tt-thing-u1-old', 2);
  const survivors = keysUnder('tt-thing-').sort();
  assert.ok(survivors.includes('tt-thing-u1-old'), 'the entry being written survives');
  assert.deepEqual(survivors, ['tt-thing-u1-4', 'tt-thing-u1-old']);
});

test('pruneCacheNamespace evicts unstamped legacy entries before stamped ones', () => {
  writeLocalCache('tt-schema-things-u1:legacy', [{ id: 'x' }]);
  writeAt('tt-schema-things-u1:post', 2000, [{ id: 'p' }]);
  pruneCacheNamespace('tt-schema-things-', 'tt-schema-things-u1:new', 2);
  assert.deepEqual(keysUnder('tt-schema-things-'), ['tt-schema-things-u1:post']);
});

test('pruneCacheNamespace touches only its own prefix', () => {
  writeAt('tt-thing-u1-a', 1, { id: 'a' });
  writeAt('tt-thing-u1-b', 2, { id: 'b' });
  writeAt('tt-things-u1', 3, { folders: [] });
  writeAt('tt-theme-vars', 4, {});
  pruneCacheNamespace('tt-thing-', 'tt-thing-u1-c', 1);
  // 'tt-things-u1' does NOT start with 'tt-thing-' (the trailing dash is the
  // guard) — the /things page cache and every other tt-* line are untouched
  assert.deepEqual(keysUnder('tt-').sort(), ['tt-theme-vars', 'tt-things-u1']);
});

test('a bounded namespace stays bounded across a long browsing session', () => {
  const MAX = 12;
  for (let visit = 0; visit < 200; visit++) {
    const key = `tt-component-family-u1:family-${visit}`;
    pruneCacheNamespace('tt-component-family-', key, MAX);
    writeAt(key, 1000 + visit, [{ id: `component-${visit}` }]);
  }
  assert.equal(keysUnder('tt-component-family-').length, MAX);
});

test('clearLocalCache and readLocalCache stay unchanged', () => {
  writeLocalCache('tt-thing-u1-a', { id: 'a' });
  clearLocalCache('tt-thing-u1-a');
  assert.equal(readLocalCache('tt-thing-u1-a'), null);
});
