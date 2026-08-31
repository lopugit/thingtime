import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SearchCacheSettings, SearchCacheStatus, SearchHit, SearchItem } from '@commander/protocol';
import { normalizeSearchCacheSettings } from '@commander/protocol';
import { commanderCacheDirectory } from './config.js';

interface LegacyCacheEntry {
  version: 1;
  key: string;
  createdAtMs: number;
  hits: SearchHit[];
}

interface CacheEntry {
  version: 2;
  key: string;
  contextKey: string;
  query: string;
  createdAtMs: number;
  hits: SearchHit[];
  indexedItems: SearchItem[];
}

type StoredCacheEntry = LegacyCacheEntry | CacheEntry;

export interface SearchCacheLookup {
  exact: boolean;
  sourceQuery: string;
  hits: SearchHit[];
  indexedItems: SearchItem[];
}

export interface SearchCacheRequest {
  key: string;
  contextKey: string;
  query: string;
}

export interface SearchCacheWrite extends SearchCacheRequest {
  hits: SearchHit[];
  indexedItems: SearchItem[];
}

const CACHE_DIRECTORY_NAME = 'search-results-v1';
const MAX_MEMORY_ENTRIES = 128;
const MIN_NEARBY_QUERY_LENGTH = 2;

export class SearchResultCache {
  #settings: SearchCacheSettings;
  #writeQueue = Promise.resolve();
  #entries = new Map<string, StoredCacheEntry>();
  #warmPromise: Promise<void> | undefined;
  #generation = 0;

  constructor(settings: SearchCacheSettings) {
    this.#settings = normalizeSearchCacheSettings(settings);
  }

  updateSettings(settings: SearchCacheSettings): void {
    const previousDirectory = this.effectiveDirectory();
    this.#settings = normalizeSearchCacheSettings(settings);
    if (!this.#settings.enabled || previousDirectory !== this.effectiveDirectory()) this.#resetMemory();
  }

  async warm(): Promise<void> {
    if (!this.#settings.enabled) return;
    this.#warmPromise ??= this.#warmFromDisk(this.#generation).catch((error: unknown) => {
      this.#warmPromise = undefined;
      throw error;
    });
    await this.#warmPromise;
  }

  async lookup(request: SearchCacheRequest): Promise<SearchCacheLookup | undefined> {
    if (!this.#settings.enabled) return undefined;
    await this.warm();
    const exact = this.#freshEntry(request.key) ?? (await this.#loadExact(request.key));
    if (exact) return lookupFromEntry(exact, true);

    const query = normalizedQuery(request.query);
    if (query.length < MIN_NEARBY_QUERY_LENGTH) return undefined;
    const nearby = [...this.#entries.values()]
      .filter(
        (entry): entry is CacheEntry =>
          entry.version === 2 &&
          entry.contextKey === request.contextKey &&
          entry.indexedItems.length > 0 &&
          entry.query.length >= MIN_NEARBY_QUERY_LENGTH &&
          entry.query !== query &&
          (query.startsWith(entry.query) || entry.query.startsWith(query)) &&
          !this.#expired(entry),
      )
      .sort((left, right) => compareNearbyEntries(left, right, query))[0];
    if (!nearby) return undefined;
    this.#remember(nearby);
    return lookupFromEntry(nearby, false);
  }

  async put(write: SearchCacheWrite): Promise<void> {
    if (!this.#settings.enabled) return;
    const entry: CacheEntry = {
      version: 2,
      key: write.key,
      contextKey: write.contextKey,
      query: normalizedQuery(write.query),
      createdAtMs: Date.now(),
      hits: structuredClone(write.hits),
      indexedItems: structuredClone(write.indexedItems),
    };
    this.#remember(entry);
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        const directory = this.effectiveDirectory();
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const destination = this.#entryPath(write.key);
        const temporary = `${destination}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
        await rename(temporary, destination);
        await this.#prune();
      });
    await this.#writeQueue;
  }

  async clear(): Promise<void> {
    this.#resetMemory();
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        const files = await this.#cacheFiles();
        await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
      });
    await this.#writeQueue;
  }

  async status(): Promise<SearchCacheStatus> {
    const files = await this.#cacheFiles();
    return {
      ...structuredClone(this.#settings),
      effectiveDirectory: this.effectiveDirectory(),
      sizeBytes: files.reduce((total, file) => total + file.size, 0),
      entryCount: files.length,
    };
  }

  effectiveDirectory(): string {
    const configured = this.#settings.directory;
    const base = configured ? expandDirectory(configured) : commanderCacheDirectory();
    return path.join(base, CACHE_DIRECTORY_NAME);
  }

  #entryPath(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex');
    return path.join(this.effectiveDirectory(), `${digest}.json`);
  }

  #freshEntry(key: string): StoredCacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (this.#expired(entry)) {
      this.#entries.delete(key);
      void unlink(this.#entryPath(key)).catch(() => undefined);
      return undefined;
    }
    this.#remember(entry);
    return entry;
  }

  #expired(entry: StoredCacheEntry): boolean {
    return Date.now() - entry.createdAtMs > this.#settings.ttlMinutes * 60_000;
  }

  async #loadExact(key: string): Promise<StoredCacheEntry | undefined> {
    try {
      const entry = parseEntry(await readFile(this.#entryPath(key), 'utf8'));
      if (!entry || entry.key !== key || this.#expired(entry)) {
        await unlink(this.#entryPath(key)).catch(() => undefined);
        return undefined;
      }
      this.#remember(entry);
      return entry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        await unlink(this.#entryPath(key)).catch(() => undefined);
      return undefined;
    }
  }

  #remember(entry: StoredCacheEntry): void {
    this.#entries.delete(entry.key);
    this.#entries.set(entry.key, entry);
    while (this.#entries.size > MAX_MEMORY_ENTRIES) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.#entries.delete(oldestKey);
    }
  }

  #resetMemory(): void {
    this.#generation += 1;
    this.#entries.clear();
    this.#warmPromise = undefined;
  }

  async #warmFromDisk(generation: number): Promise<void> {
    const files = (await this.#cacheFiles())
      .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
      .slice(0, MAX_MEMORY_ENTRIES);
    for (const file of files.reverse()) {
      if (generation !== this.#generation) return;
      try {
        const entry = parseEntry(await readFile(file.path, 'utf8'));
        if (!entry || this.#expired(entry)) {
          await unlink(file.path).catch(() => undefined);
          continue;
        }
        this.#remember(entry);
      } catch {
        await unlink(file.path).catch(() => undefined);
      }
    }
  }

  async #cacheFiles(): Promise<Array<{ path: string; size: number; modifiedAtMs: number }>> {
    const directory = this.effectiveDirectory();
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const details = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
          .map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            const metadata = await stat(filePath);
            return { path: filePath, size: metadata.size, modifiedAtMs: metadata.mtimeMs };
          }),
      );
      return details;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async #prune(): Promise<void> {
    const files = (await this.#cacheFiles()).sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (total <= this.#settings.maxSizeBytes) break;
      await unlink(file.path).catch(() => undefined);
      total -= file.size;
    }
  }
}

function parseEntry(serialized: string): StoredCacheEntry | undefined {
  const parsed = JSON.parse(serialized) as {
    version?: unknown;
    key?: unknown;
    contextKey?: unknown;
    query?: unknown;
    createdAtMs?: unknown;
    hits?: unknown;
    indexedItems?: unknown;
  };
  if (
    (parsed.version !== 1 && parsed.version !== 2) ||
    typeof parsed.key !== 'string' ||
    typeof parsed.createdAtMs !== 'number' ||
    !Number.isFinite(parsed.createdAtMs) ||
    !Array.isArray(parsed.hits)
  )
    return undefined;
  if (parsed.version === 1) return parsed as LegacyCacheEntry;
  if (
    typeof parsed.contextKey !== 'string' ||
    typeof parsed.query !== 'string' ||
    !Array.isArray(parsed.indexedItems)
  )
    return undefined;
  return parsed as CacheEntry;
}

function lookupFromEntry(entry: StoredCacheEntry, exact: boolean): SearchCacheLookup {
  return {
    exact,
    sourceQuery: entry.version === 2 ? entry.query : '',
    hits: structuredClone(entry.hits),
    indexedItems: entry.version === 2 ? structuredClone(entry.indexedItems) : [],
  };
}

function compareNearbyEntries(left: CacheEntry, right: CacheEntry, query: string): number {
  const leftRefines = query.startsWith(left.query);
  const rightRefines = query.startsWith(right.query);
  if (leftRefines !== rightRefines) return leftRefines ? -1 : 1;
  if (leftRefines) return right.query.length - left.query.length || right.createdAtMs - left.createdAtMs;
  return left.query.length - right.query.length || right.createdAtMs - left.createdAtMs;
}

function normalizedQuery(value: string): string {
  return value.trim().toLowerCase();
}

function expandDirectory(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}
