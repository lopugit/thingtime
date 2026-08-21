import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEARCH_CACHE_SETTINGS } from '@commander/protocol';
import { SearchResultCache } from './searchCache.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SearchResultCache', () => {
  it('stores bounded query snapshots in a dedicated custom cache directory and clears them', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'commander-search-cache-'));
    temporaryDirectories.push(directory);
    const cache = new SearchResultCache({
      ...DEFAULT_SEARCH_CACHE_SETTINGS,
      directory,
    });
    const hits = [
      {
        id: 'builtin:settings',
        title: 'Settings',
        kind: 'builtin' as const,
        keywords: ['settings'],
        favourite: true,
        actions: [{ id: 'open-settings', title: 'Open Settings' }],
        score: 100,
        matchedRanges: [],
      },
    ];

    await cache.put('settings-key', hits);
    expect(await cache.get('settings-key')).toEqual(hits);
    expect(await cache.status()).toMatchObject({
      effectiveDirectory: path.join(directory, 'search-results-v1'),
      entryCount: 1,
      sizeBytes: expect.any(Number),
    });

    await cache.clear();
    expect(await cache.get('settings-key')).toBeUndefined();
    expect((await cache.status()).entryCount).toBe(0);
  });

  it('expires a cached search after the configured lifetime', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'commander-search-cache-'));
    temporaryDirectories.push(directory);
    const cache = new SearchResultCache({
      ...DEFAULT_SEARCH_CACHE_SETTINGS,
      directory,
      ttlMinutes: 5,
    });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await cache.put('expiring-key', []);
    vi.mocked(Date.now).mockReturnValue(now + 5 * 60_000 + 1);

    expect(await cache.get('expiring-key')).toBeUndefined();
    expect((await cache.status()).entryCount).toBe(0);
  });
});
