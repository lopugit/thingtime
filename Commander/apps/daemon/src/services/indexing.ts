import { access } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileSystemIndexerClient,
  type IndexConfiguration,
  type IndexKind,
  type IndexRecord,
  type IndexReport,
  type IndexStatus,
} from '@commander/filesystem-indexer';
import type {
  CommanderSettings,
  IndexScope,
  IndexingSettings,
  IndexingStatus,
  Platform,
  SearchItem,
} from '@commander/protocol';
import { applicationDirectories, discoverApplications } from './applications.js';
import { commanderDataDirectory } from './config.js';

export const APPLICATION_REFRESH_MINUTES = 5;

interface IndexingCallbacks {
  applications(items: SearchItem[]): void;
  commands(): number;
}

interface IndexingServiceOptions {
  binaryPath: string | undefined;
  databasePath?: string;
  platform: Platform;
  settings: CommanderSettings;
  callbacks: IndexingCallbacks;
}

const FILESYSTEM_RESULT_LIMIT = 160;
const APPLICATION_RESULT_LIMIT = 1_000;
const COMMANDER_INDEX_TIMEOUT_MS = 90_000;

export class IndexingService {
  readonly #platform: Platform;
  readonly #callbacks: IndexingCallbacks;
  readonly #binaryPath: string | undefined;
  readonly #databasePath: string;
  #settings: IndexingSettings;
  #reader: FileSystemIndexerClient | undefined;
  #writer: FileSystemIndexerClient | undefined;
  #available = false;
  #message: string | undefined;
  #running = new Set<IndexScope>();
  #runs = new Map<IndexScope, Promise<void>>();
  #writeQueue = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | undefined;
  #applicationWatchers: FSWatcher[] = [];
  #applicationDebounce: ReturnType<typeof setTimeout> | undefined;
  #lastCommandsIndexedAtMs: number | undefined;
  #lastFallbackApplicationsAtMs: number | undefined;
  #commandCount = 0;

  constructor(options: IndexingServiceOptions) {
    this.#platform = options.platform;
    this.#callbacks = options.callbacks;
    this.#settings = structuredClone(options.settings.indexing);
    this.#binaryPath = options.binaryPath;
    this.#databasePath =
      options.databasePath ?? path.join(commanderDataDirectory(), 'filesystem-index.sqlite3');
    if (!options.binaryPath) {
      this.#message =
        'The bundled Rust filesystem indexer is unavailable; application refresh uses a fallback scan.';
      return;
    }
    const clientOptions = { binaryPath: options.binaryPath, databasePath: this.#databasePath };
    this.#reader = new FileSystemIndexerClient(clientOptions);
    this.#writer = new FileSystemIndexerClient({
      ...clientOptions,
      indexTimeoutMs: COMMANDER_INDEX_TIMEOUT_MS,
    });
  }

  async initialize(): Promise<SearchItem[]> {
    this.reindexCommands();
    let applications: SearchItem[] = [];
    if (this.#reader) {
      try {
        await this.#reader.status();
        this.#available = true;
        applications = await this.#queryApplications();
        if (!applications.length) {
          await this.start('applications');
          applications = await this.#queryApplications();
        }
      } catch (error) {
        this.#disableRust(error);
      }
    }
    if (!applications.length) applications = await discoverApplications();
    this.#callbacks.applications(applications);
    this.#timer = setInterval(() => void this.#automaticRefresh(), 60_000);
    this.#timer.unref();
    await this.#watchApplications();
    void this.#automaticRefresh();
    return applications;
  }

  updateSettings(settings: CommanderSettings): void {
    const previous = JSON.stringify(this.#settings);
    this.#settings = structuredClone(settings.indexing);
    if (previous !== JSON.stringify(this.#settings) && this.#settings.enabled) {
      void this.start('all').catch(() => undefined);
    }
  }

  async queryItems(query: string, limit = FILESYSTEM_RESULT_LIMIT): Promise<SearchItem[]> {
    if (!this.#reader || !this.#settings.enabled || query.trim().length < 2) return [];
    try {
      const response = await this.#reader.query({
        query,
        kinds: ['file', 'directory'],
        limit: Math.min(FILESYSTEM_RESULT_LIMIT, Math.max(1, limit)),
      });
      return response.records.map(indexRecordToSearchItem);
    } catch (error) {
      this.#message = errorMessage(error);
      return [];
    }
  }

  async resolveItem(itemId: string): Promise<SearchItem | undefined> {
    const decoded = decodeIndexedItemId(itemId);
    if (!decoded || !this.#reader) return undefined;
    try {
      const record = await this.#reader.lookup(decoded.path, decoded.kind);
      return record ? indexRecordToSearchItem(record) : undefined;
    } catch (error) {
      this.#message = errorMessage(error);
      return undefined;
    }
  }

  start(scope: IndexScope): Promise<void> {
    const current = this.#runs.get(scope);
    if (current) return current;
    if (scope === 'all' || scope === 'applications')
      void this.#refreshFallbackApplications().catch(() => undefined);
    this.#running.add(scope);
    const run = this.#writeQueue
      .catch(() => undefined)
      .then(() => this.#perform(scope))
      .catch((error) => {
        this.#message = errorMessage(error);
        throw error;
      })
      .finally(() => {
        this.#running.delete(scope);
        this.#runs.delete(scope);
      });
    this.#writeQueue = run.catch(() => undefined);
    this.#runs.set(scope, run);
    return run;
  }

  reindexCommands(): number {
    this.#commandCount = this.#callbacks.commands();
    this.#lastCommandsIndexedAtMs = Date.now();
    return this.#commandCount;
  }

  async status(): Promise<IndexingStatus> {
    const status = await this.#safeRustStatus();
    return {
      available: this.#available,
      running: [...this.#running],
      totalRecords: status?.totalRecords ?? 0,
      kinds:
        status?.kinds.map((kind) => ({
          kind: kind.kind,
          count: kind.count,
          ...(kind.lastIndexedAtMs === undefined ? {} : { lastIndexedAtMs: kind.lastIndexedAtMs }),
          ...(kind.lastDurationMs === undefined ? {} : { lastDurationMs: kind.lastDurationMs }),
          ...(kind.lastError ? { lastError: kind.lastError } : {}),
        })) ?? emptyKindStatuses(),
      commands: {
        count: this.#commandCount,
        ...(this.#lastCommandsIndexedAtMs === undefined
          ? {}
          : { lastIndexedAtMs: this.#lastCommandsIndexedAtMs }),
      },
      automaticRefresh: {
        applicationsMinutes: APPLICATION_REFRESH_MINUTES,
        filesystemMinutes: this.#settings.refreshIntervalMinutes,
      },
      ...(this.#message ? { message: this.#message } : {}),
    };
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#applicationDebounce) clearTimeout(this.#applicationDebounce);
    this.#timer = undefined;
    this.#applicationDebounce = undefined;
    for (const watcher of this.#applicationWatchers.splice(0)) watcher.close();
    await Promise.allSettled([this.#reader?.close(), this.#writer?.close()]);
    this.#reader = undefined;
    this.#writer = undefined;
    this.#available = false;
  }

  async #perform(scope: IndexScope): Promise<void> {
    if (scope === 'commands') {
      this.reindexCommands();
      return;
    }
    if (scope === 'all') {
      this.reindexCommands();
      await this.#indexApplications();
      if (this.#settings.enabled) await this.#indexFilesystem(['file', 'directory']);
      return;
    }
    if (scope === 'applications') {
      await this.#indexApplications();
      return;
    }
    if (!this.#settings.enabled) throw new Error('Filesystem indexing is disabled in Advanced Settings');
    await this.#indexFilesystem([scope === 'files' ? 'file' : 'directory']);
  }

  async #indexApplications(): Promise<void> {
    if (!this.#writer || !this.#reader) {
      await this.#refreshFallbackApplications();
      return;
    }
    const roots = await existingDirectories(applicationDirectories(this.#platform));
    if (!roots.length) {
      this.#callbacks.applications([]);
      return;
    }
    await this.#writeIndex({
      sources: roots.map((root, index) => ({
        id: `applications:${index}:${root}`,
        root,
        kinds: ['application'],
        respectGitIgnore: false,
        includeHidden: false,
        followSymlinks: false,
        maxDepth: 1,
      })),
      customIgnores: [],
      maxEntries: Math.min(this.#settings.maxEntries, 100_000),
    });
    this.#available = true;
    this.#message = undefined;
    this.#callbacks.applications(await this.#queryApplications());
  }

  async #indexFilesystem(kinds: IndexKind[]): Promise<void> {
    if (!this.#writer) throw new Error('The bundled Rust filesystem indexer is unavailable');
    const roots = await existingDirectories(this.#settings.roots.map(expandRoot));
    if (!roots.length) throw new Error('None of the configured filesystem index roots are available');
    const configuration: IndexConfiguration = {
      sources: roots.map((root, index) => ({
        id: `filesystem:${index}:${root}`,
        root,
        kinds,
        respectGitIgnore: this.#settings.respectGitIgnore,
        includeHidden: this.#settings.includeHidden,
        followSymlinks: false,
      })),
      customIgnores: this.#settings.customIgnores,
      maxEntries: this.#settings.maxEntries,
    };
    await this.#writeIndex(configuration);
    this.#available = true;
    this.#message = undefined;
  }

  async #writeIndex(configuration: IndexConfiguration): Promise<IndexReport> {
    const writer = this.#writer;
    if (!writer) throw new Error('The bundled Rust filesystem indexer is unavailable');
    try {
      return await writer.index(configuration);
    } catch (error) {
      if (!errorMessage(error).includes('timed out')) throw error;
      if (this.#writer === writer) {
        this.#writer = undefined;
        await writer.close();
        if (this.#binaryPath) {
          this.#writer = new FileSystemIndexerClient({
            binaryPath: this.#binaryPath,
            databasePath: this.#databasePath,
            indexTimeoutMs: COMMANDER_INDEX_TIMEOUT_MS,
          });
        }
      }
      if (this.#platform === 'macos') {
        throw new Error(
          'Filesystem indexing was stopped after macOS blocked a folder. Grant Commander Full Disk Access or narrow the configured roots, then run Index Files or Index Folders again.',
        );
      }
      throw error;
    }
  }

  async #queryApplications(): Promise<SearchItem[]> {
    if (!this.#reader) return [];
    const response = await this.#reader.query({
      query: '',
      kinds: ['application'],
      limit: APPLICATION_RESULT_LIMIT,
    });
    return response.records.map(indexRecordToSearchItem);
  }

  async #automaticRefresh(): Promise<void> {
    const status = await this.#safeRustStatus();
    if (!status) {
      if (
        !this.#running.has('applications') &&
        (!this.#lastFallbackApplicationsAtMs ||
          Date.now() - this.#lastFallbackApplicationsAtMs >= APPLICATION_REFRESH_MINUTES * 60_000)
      )
        void this.start('applications').catch(() => undefined);
      return;
    }
    const now = Date.now();
    if (isDue(status, 'application', APPLICATION_REFRESH_MINUTES, now))
      void this.start('applications').catch(() => undefined);
    if (!this.#settings.enabled) return;
    const filesDue = isDue(status, 'file', this.#settings.refreshIntervalMinutes, now);
    const directoriesDue = isDue(status, 'directory', this.#settings.refreshIntervalMinutes, now);
    if (filesDue && directoriesDue) void this.start('all').catch(() => undefined);
    else if (filesDue) void this.start('files').catch(() => undefined);
    else if (directoriesDue) void this.start('directories').catch(() => undefined);
  }

  async #safeRustStatus(): Promise<IndexStatus | undefined> {
    if (!this.#reader) return undefined;
    try {
      const status = await this.#reader.status();
      this.#available = true;
      return status;
    } catch (error) {
      this.#disableRust(error);
      return undefined;
    }
  }

  #disableRust(error: unknown): void {
    this.#available = false;
    this.#message = errorMessage(error);
  }

  async #refreshFallbackApplications(): Promise<void> {
    const applications = await discoverApplications();
    this.#lastFallbackApplicationsAtMs = Date.now();
    this.#callbacks.applications(applications);
  }

  async #watchApplications(): Promise<void> {
    const roots = await existingDirectories(applicationDirectories(this.#platform));
    for (const root of roots) {
      try {
        const watcher = watch(root, { persistent: false }, () => {
          if (this.#applicationDebounce) clearTimeout(this.#applicationDebounce);
          this.#applicationDebounce = setTimeout(() => {
            this.#applicationDebounce = undefined;
            void this.start('applications').catch(() => undefined);
          }, 750);
          this.#applicationDebounce.unref();
        });
        watcher.on('error', () => undefined);
        this.#applicationWatchers.push(watcher);
      } catch {
        // Periodic reconciliation remains active when a platform directory cannot be watched.
      }
    }
  }
}

export function indexRecordToSearchItem(record: IndexRecord): SearchItem {
  const actionTitle = record.kind === 'application' ? 'Open Application' : 'Open';
  return {
    id: indexedItemId(record.kind, record.path),
    title: record.name,
    subtitle: record.path,
    kind: record.kind,
    keywords: [record.kind, path.extname(record.name).replace(/^\./, ''), record.parent].filter(Boolean),
    icon: record.kind,
    path: record.path,
    favourite: false,
    actions: [
      { id: 'open', title: actionTitle, shortcut: '↵' },
      { id: 'show-in-finder', title: 'Show in Finder', shortcut: '⇧⌘R' },
      { id: 'copy-path', title: 'Copy Path', shortcut: '⌘C' },
    ],
  };
}

export function indexedItemId(kind: IndexKind, itemPath: string): string {
  return `index:${kind}:${Buffer.from(itemPath, 'utf8').toString('base64url')}`;
}

export function decodeIndexedItemId(itemId: string): { kind: IndexKind; path: string } | undefined {
  const match = /^index:(application|file|directory):([A-Za-z0-9_-]+)$/.exec(itemId);
  if (!match) return undefined;
  const kind = match[1] as IndexKind;
  try {
    const itemPath = Buffer.from(match[2]!, 'base64url').toString('utf8');
    if (!path.isAbsolute(itemPath) || itemPath.includes('\0')) return undefined;
    return { kind, path: itemPath };
  } catch {
    return undefined;
  }
}

function expandRoot(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

async function existingDirectories(values: string[]): Promise<string[]> {
  const unique = [...new Set(values.map((value) => path.resolve(value)))];
  const existing = await Promise.all(
    unique.map(async (value) => {
      try {
        await access(value);
        return value;
      } catch {
        return undefined;
      }
    }),
  );
  return existing.filter((value): value is string => Boolean(value));
}

function isDue(status: IndexStatus, kind: IndexKind, minutes: number, now: number): boolean {
  const last = status.kinds.find((candidate) => candidate.kind === kind)?.lastIndexedAtMs;
  return last === undefined || now - last >= minutes * 60_000;
}

function emptyKindStatuses(): IndexingStatus['kinds'] {
  return [
    { kind: 'application', count: 0 },
    { kind: 'file', count: 0 },
    { kind: 'directory', count: 0 },
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Filesystem indexing failed';
}
