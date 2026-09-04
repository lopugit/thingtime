import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit, SearchItem } from '@commander/protocol';
import { DEFAULT_SEARCH_CACHE_SETTINGS } from '@commander/protocol';
import { SearchResultCache } from './searchCache.js';

const temporaryDirectories: string[] = [];
const settingsHit: SearchHit = {
  id: 'builtin:settings',
  title: 'Settings',
  kind: 'builtin',
  keywords: ['settings'],
  favourite: true,
  actions: [{ id: 'open-settings', title: 'Open Settings' }],
  score: 100,
  matchedRanges: [],
};
const commanderFile: SearchItem = {
  id: 'file:/tmp/Commander-notes.md',
  title: 'Commander-notes.md',
  subtitle: '/tmp/Commander-notes.md',
  path: '/tmp/Commander-notes.md',
  kind: 'file',
  keywords: ['Commander-notes.md', '/tmp/Commander-notes.md'],
  favourite: false,
  actions: [{ id: 'open', title: 'Open' }],
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SearchResultCache', () => {
  it('stores an exact query in memory and on disk and clears both tiers', async () => {
    const directory = await temporaryDirectory();
    const cache = new SearchResultCache({ ...DEFAULT_SEARCH_CACHE_SETTINGS, directory });

    await cache.put({
      key: 'settings-key',
      contextKey: 'context',
      query: 'settings',
      hits: [settingsHit],
      indexedItems: [],
    });
    expect(await cache.lookup({ key: 'settings-key', contextKey: 'context', query: 'settings' })).toEqual({
      exact: true,
      sourceQuery: 'settings',
      hits: [settingsHit],
      indexedItems: [],
    });
    expect(await cache.status()).toMatchObject({
      effectiveDirectory: path.join(directory, 'search-results-v1'),
      entryCount: 1,
      sizeBytes: expect.any(Number),
    });

    await cache.clear();
    expect(
      await cache.lookup({ key: 'settings-key', contextKey: 'context', query: 'settings' }),
    ).toBeUndefined();
    expect((await cache.status()).entryCount).toBe(0);
  });

  it('warms persisted candidates and serves the nearest prefix while live search catches up', async () => {
    const directory = await temporaryDirectory();
    const writer = new SearchResultCache({ ...DEFAULT_SEARCH_CACHE_SETTINGS, directory });
    await writer.put({
      key: 'comm-key',
      contextKey: 'same-catalog',
      query: 'comm',
      hits: [settingsHit],
      indexedItems: [commanderFile],
    });

    const reader = new SearchResultCache({ ...DEFAULT_SEARCH_CACHE_SETTINGS, directory });
    await reader.warm();
    expect(await reader.lookup({ key: 'comma-key', contextKey: 'same-catalog', query: 'comma' })).toEqual({
      exact: false,
      sourceQuery: 'comm',
      hits: [settingsHit],
      indexedItems: [commanderFile],
    });
    expect(
      await reader.lookup({ key: 'comma-key', contextKey: 'changed-catalog', query: 'comma' }),
    ).toBeUndefined();
  });

  it('prefers the longest cached prefix when several candidate sets can preview a refinement', async () => {
    const directory = await temporaryDirectory();
    const cache = new SearchResultCache({ ...DEFAULT_SEARCH_CACHE_SETTINGS, directory });
    await cache.put({
      key: 'co-key',
      contextKey: 'context',
      query: 'co',
      hits: [],
      indexedItems: [{ ...commanderFile, id: 'file:co', title: 'co.txt' }],
    });
    await cache.put({
      key: 'comm-key',
      contextKey: 'context',
      query: 'comm',
      hits: [],
      indexedItems: [commanderFile],
    });

    const result = await cache.lookup({ key: 'comma-key', contextKey: 'context', query: 'comma' });
    expect(result?.sourceQuery).toBe('comm');
    expect(result?.indexedItems).toEqual([commanderFile]);
  });

  it('expires a cached search after the configured lifetime', async () => {
    const directory = await temporaryDirectory();
    const cache = new SearchResultCache({
      ...DEFAULT_SEARCH_CACHE_SETTINGS,
      directory,
      ttlMinutes: 5,
    });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await cache.put({
      key: 'expiring-key',
      contextKey: 'context',
      query: 'settings',
      hits: [],
      indexedItems: [],
    });
    vi.mocked(Date.now).mockReturnValue(now + 5 * 60_000 + 1);

    expect(
      await cache.lookup({ key: 'expiring-key', contextKey: 'context', query: 'settings' }),
    ).toBeUndefined();
    await vi.waitFor(async () => expect((await cache.status()).entryCount).toBe(0));
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'commander-search-cache-'));
  temporaryDirectories.push(directory);
  return directory;
}
