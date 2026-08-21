import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SearchCacheSettings, SearchCacheStatus, SearchHit } from '@commander/protocol';
import { normalizeSearchCacheSettings } from '@commander/protocol';
import { commanderCacheDirectory } from './config.js';

interface CacheEntry {
  version: 1;
  key: string;
  createdAtMs: number;
  hits: SearchHit[];
}

const CACHE_DIRECTORY_NAME = 'search-results-v1';

export class SearchResultCache {
  #settings: SearchCacheSettings;
  #writeQueue = Promise.resolve();

  constructor(settings: SearchCacheSettings) {
    this.#settings = normalizeSearchCacheSettings(settings);
  }

  updateSettings(settings: SearchCacheSettings): void {
    this.#settings = normalizeSearchCacheSettings(settings);
  }

  async get(key: string): Promise<SearchHit[] | undefined> {
    if (!this.#settings.enabled) return undefined;
    try {
      const parsed = JSON.parse(await readFile(this.#entryPath(key), 'utf8')) as Partial<CacheEntry>;
      const createdAtMs = parsed.createdAtMs;
      if (
        parsed.version !== 1 ||
        parsed.key !== key ||
        typeof createdAtMs !== 'number' ||
        !Number.isFinite(createdAtMs) ||
        !Array.isArray(parsed.hits)
      )
        return undefined;
      if (Date.now() - createdAtMs > this.#settings.ttlMinutes * 60_000) {
        await unlink(this.#entryPath(key)).catch(() => undefined);
        return undefined;
      }
      return parsed.hits;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        await unlink(this.#entryPath(key)).catch(() => undefined);
      return undefined;
    }
  }

  async put(key: string, hits: SearchHit[]): Promise<void> {
    if (!this.#settings.enabled) return;
    const entry: CacheEntry = {
      version: 1,
      key,
      createdAtMs: Date.now(),
      hits: structuredClone(hits),
    };
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        const directory = this.effectiveDirectory();
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const destination = this.#entryPath(key);
        const temporary = `${destination}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
        await rename(temporary, destination);
        await this.#prune();
      });
    await this.#writeQueue;
  }

  async clear(): Promise<void> {
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

function expandDirectory(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}
