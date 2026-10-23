import { access, readdir } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileSystemIndexerClient,
  type IndexConfiguration,
  type IndexKind,
  type IndexProgress as FileIndexProgress,
  type IndexRecord,
  type IndexReport,
  type IndexResourceUsage,
  type IndexStatus,
} from '@commander/filesystem-indexer';
import { INDEXING_TIMEOUT_ATTEMPT_LIMIT, INDEXING_TIMING_SAMPLE_LIMIT } from '@commander/protocol';
import type {
  CommanderSettings,
  IndexScope,
  IndexingSettings,
  IndexingStatus,
  IndexRunTiming,
  Platform,
  SearchItem,
} from '@commander/protocol';
import { applicationDirectories, discoverApplications, discoverApplicationsQuick } from './applications.js';
import { commanderDataDirectory } from './config.js';
import { pathActions } from './pathActions.js';

// Application bundle changes under active volumes are watched with FSEvents.
// This slower reconciliation is only the safety net for a missed native event
// or a newly mounted volume.
export const APPLICATION_REFRESH_MINUTES = 6 * 60;

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

interface ScheduledIndexRun {
  scope: IndexScope;
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

// Output page size only: the indexer ranks matching records before returning it.
const FILESYSTEM_RESULT_PAGE_SIZE = 160;
const COMMANDER_INDEX_TIMEOUT_MS = 90_000;
const COMMANDER_MAX_INDEX_TIMEOUT_MS = 15 * 60_000;
const INDEX_STATUS_CACHE_MS = 30_000;

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
  #activeRun: ScheduledIndexRun | undefined;
  #pendingRun: ScheduledIndexRun | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #applicationWatchers: FSWatcher[] = [];
  #applicationDebounce: ReturnType<typeof setTimeout> | undefined;
  #lastCommandsIndexedAtMs: number | undefined;
  #lastFallbackApplicationsAtMs: number | undefined;
  #commandCount = 0;
  #lastRunResources: IndexResourceUsage | undefined;
  #recentTimings: IndexRunTiming[] = [];
  #timeoutAttempts: NonNullable<IndexingStatus['timeoutAttempts']> = [];
  #timeoutSequence = 0;
  #lastStatus: IndexStatus | undefined;
  #lastStatusReadAtMs = 0;
  #progress: IndexingStatus['progress'];
  #progressSources = new Map<string, number>();

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
      } catch (error) {
        this.#disableRust(error);
      }
    }
    // The fallback gives the launcher freshly installed top-level applications
    // while a missing/stale index is refreshed independently in the background.
    applications = mergeApplications(applications, await discoverApplicationsQuick());
    this.#callbacks.applications(applications);
    this.#timer = setInterval(() => void this.#automaticRefresh(), 60_000);
    this.#timer.unref();
    void this.#watchApplications();
    // Search always reads the latest committed catalog snapshot. Indexing runs
    // independently and swaps that catalog when its atomic database update
    // completes, so new searches remain live without a startup race.
    // Reuse a fresh persisted index on launch, rather than scanning every time
    // Commander starts. Watchers and the reconciliation schedule keep it fresh.
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

  async queryItems(query: string, limit = FILESYSTEM_RESULT_PAGE_SIZE): Promise<SearchItem[]> {
    if (!this.#reader || !this.#settings.enabled || !query.trim()) return [];
    try {
      // All apps are already in the in-memory catalogue. Only read files and
      // folders here: a crowded filename page cannot exclude a matching app,
      // and search never needs to initiate an indexing run or discovery scan.
      const response = await this.#reader.query({
        query,
        kinds: ['file', 'directory'],
        limit: Math.max(1, limit),
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
    const active = this.#activeRun;
    if (!active) return this.#beginRun(scope);
    // A complete run contains every narrower scope, so those requests can
    // safely join it rather than scheduling an unnecessary scan.
    if (active.scope === scope || active.scope === 'all') return active.promise;

    const pending = this.#pendingRun;
    if (pending) {
      if (pending.scope === scope || pending.scope === 'all') return pending.promise;
      // Keep the oldest active database writer intact, but make queued work
      // latest-wins. This preserves automatic indexing without allowing a
      // long queue of stale full-tree scans to build up behind it.
      pending.resolve();
    }
    const next = this.#createRun(scope);
    this.#pendingRun = next;
    return next.promise;
  }

  #beginRun(scope: IndexScope): Promise<void> {
    const run = this.#createRun(scope);
    this.#activateRun(run);
    return run.promise;
  }

  #createRun(scope: IndexScope): ScheduledIndexRun {
    let resolve: (() => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return {
      scope,
      promise,
      resolve: () => resolve?.(),
      reject: (error) => reject?.(error),
    };
  }

  #activateRun(run: ScheduledIndexRun): void {
    this.#activeRun = run;
    this.#running.add(run.scope);
    if ((!this.#reader || !this.#writer) && (run.scope === 'all' || run.scope === 'applications'))
      void this.#refreshFallbackApplications().catch(() => undefined);
    void this.#perform(run.scope)
      .then(() => run.resolve())
      .catch((error) => {
        this.#message = errorMessage(error);
        run.reject(error instanceof Error ? error : new Error(errorMessage(error)));
      })
      .finally(() => {
        if (this.#progress?.scope === run.scope) this.#progress = undefined;
        this.#running.delete(run.scope);
        if (this.#activeRun !== run) return;
        this.#activeRun = undefined;
        const next = this.#pendingRun;
        this.#pendingRun = undefined;
        if (next) this.#activateRun(next);
      });
  }

  reindexCommands(): number {
    this.#commandCount = this.#callbacks.commands();
    this.#lastCommandsIndexedAtMs = Date.now();
    return this.#commandCount;
  }

  async status(): Promise<IndexingStatus> {
    const status =
      !this.#lastStatus || Date.now() - this.#lastStatusReadAtMs >= INDEX_STATUS_CACHE_MS
        ? ((await this.#safeRustStatus()) ?? this.#lastStatus)
        : this.#lastStatus;
    return {
      available: this.#available,
      running: [...this.#running],
      totalRecords: status?.totalRecords ?? 0,
      databaseSizeBytes: status?.databaseSizeBytes ?? 0,
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
      customTimeoutMs: this.#settings.customTimeoutMs,
      resourceLimits: structuredClone(this.#settings.resourceLimits),
      ...(this.#lastRunResources ? { lastRunResources: structuredClone(this.#lastRunResources) } : {}),
      timing: timingSummary(this.#recentTimings),
      timeoutAttempts: structuredClone(this.#timeoutAttempts),
      ...(this.#progress ? { progress: structuredClone(this.#progress) } : {}),
      ...(this.#message ? { message: this.#message } : {}),
    };
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#applicationDebounce) clearTimeout(this.#applicationDebounce);
    this.#timer = undefined;
    this.#applicationDebounce = undefined;
    for (const watcher of this.#applicationWatchers.splice(0)) watcher.close();
    const pending = this.#pendingRun;
    this.#pendingRun = undefined;
    pending?.reject(new Error('Filesystem indexing service closed'));
    await Promise.allSettled([this.#reader?.close(), this.#writer?.close()]);
    this.#reader = undefined;
    this.#writer = undefined;
    this.#available = false;
  }

  async #perform(scope: IndexScope): Promise<void> {
    this.#beginProgress(scope);
    if (scope === 'commands') {
      this.reindexCommands();
      if (this.#progress) this.#progress.processed = 1;
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
    if (!this.#settings.enabled) throw new Error('Filesystem indexing is disabled in Search Settings');
    await this.#indexFilesystem([scope === 'files' ? 'file' : 'directory']);
  }

  async #indexApplications(): Promise<void> {
    if (!this.#writer || !this.#reader) {
      await this.#refreshFallbackApplications();
      return;
    }
    const roots = await indexRoots(this.#platform, ['/']);
    if (!roots.length) {
      this.#callbacks.applications([]);
      return;
    }
    await this.#writeIndex({
      sources: roots.map((root) => ({
        id: `applications:${root}`,
        root,
        kinds: ['application'],
        respectGitIgnore: this.#settings.respectGitIgnore,
        includeHidden: this.#settings.includeHidden,
        followSymlinks: false,
      })),
      customIgnores: this.#settings.customIgnores,
      maxEntries: this.#settings.maxEntries,
      resourceLimits: this.#settings.resourceLimits,
      pruneSourcePrefixes: ['applications:'],
    });
    this.#available = true;
    this.#message = undefined;
    this.#callbacks.applications(await this.#queryApplications());
  }

  async #indexFilesystem(kinds: IndexKind[]): Promise<void> {
    if (!this.#writer) throw new Error('The bundled Rust filesystem indexer is unavailable');
    const roots = await indexRoots(this.#platform, this.#settings.roots);
    if (!roots.length) throw new Error('None of the configured filesystem index roots are available');
    const indexedKinds = [...new Set([...kinds, 'application' as const])];
    const configuration: IndexConfiguration = {
      sources: roots.map((root) => ({
        id: `filesystem:${root}`,
        root,
        kinds: indexedKinds,
        respectGitIgnore: this.#settings.respectGitIgnore,
        includeHidden: this.#settings.includeHidden,
        followSymlinks: false,
      })),
      customIgnores: this.#settings.customIgnores,
      maxEntries: this.#settings.maxEntries,
      resourceLimits: this.#settings.resourceLimits,
      pruneSourcePrefixes: ['filesystem:'],
    };
    await this.#writeIndex(configuration);
    this.#available = true;
    this.#message = undefined;
    this.#callbacks.applications(await this.#queryApplications());
  }

  async #writeIndex(configuration: IndexConfiguration): Promise<IndexReport> {
    const writer = this.#writer;
    if (!writer) throw new Error('The bundled Rust filesystem indexer is unavailable');
    const timeoutMs =
      this.#settings.customTimeoutMs ??
      indexTimeoutMs(configuration.resourceLimits?.maxCpuPercent, configuration.maxEntries == null);
    try {
      const report = await writer.index(configuration, timeoutMs, (progress) =>
        this.#recordProgress(progress),
      );
      this.#lastRunResources = report.resources;
      this.#recentTimings = [
        {
          scope: this.#progress?.scope ?? 'all',
          completedAtMs: report.completedAtMs,
          durationMs: report.durationMs,
        },
        ...this.#recentTimings,
      ].slice(0, INDEXING_TIMING_SAMPLE_LIMIT);
      this.#lastStatus = structuredClone(report.status);
      this.#lastStatusReadAtMs = Date.now();
      return report;
    } catch (error) {
      if (!errorMessage(error).includes('timed out')) throw error;
      const scope = this.#progress?.scope ?? 'all';
      const message = `Index ${indexScopeLabel(scope)} timed out after ${formatTimeout(timeoutMs)}. Increase the custom index timeout if this scan needs longer.`;
      this.#timeoutAttempts = [
        {
          id: `index-timeout-${Date.now()}-${++this.#timeoutSequence}`,
          scope,
          occurredAtMs: Date.now(),
          timeoutMs,
          message,
        },
        ...this.#timeoutAttempts,
      ].slice(0, INDEXING_TIMEOUT_ATTEMPT_LIMIT);
      this.#message = message;
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
          `${message} If it appears stuck rather than slow, grant Commander Full Disk Access or narrow the configured roots before retrying.`,
        );
      }
      throw error;
    }
  }

  #beginProgress(scope: IndexScope): void {
    this.#progressSources.clear();
    const existing = this.#lastStatus?.kinds ?? [];
    const count = (kind: IndexKind) => existing.find((item) => item.kind === kind)?.count ?? 0;
    const totals: Record<IndexScope, number> = {
      all: Math.max(1, (this.#lastStatus?.totalRecords ?? 0) + this.#commandCount),
      applications: Math.max(1, count('application')),
      commands: 1,
      files: Math.max(1, count('file')),
      directories: Math.max(1, count('directory')),
    };
    const labels: Record<IndexScope, string> = {
      all: 'Indexing Everything',
      applications: 'Indexing Apps',
      commands: 'Indexing Commands',
      files: 'Indexing Files',
      directories: 'Indexing Folders',
    };
    this.#progress = {
      scope,
      label: labels[scope],
      processed: 0,
      total: totals[scope],
      startedAtMs: Date.now(),
    };
  }

  #recordProgress(progress: FileIndexProgress): void {
    if (!this.#progress) return;
    this.#progressSources.set(progress.sourceId, progress.processed);
    const processed = [...this.#progressSources.values()].reduce((sum, value) => sum + value, 0);
    this.#progress.processed = processed;
    this.#progress.total = Math.max(this.#progress.total ?? 0, processed);
  }

  async #queryApplications(): Promise<SearchItem[]> {
    if (!this.#reader) return [];
    const response = await this.#reader.catalogue(['application']);
    // Read the complete persistent app catalogue, including freshly installed
    // apps that the bounded direct scan can see before the index catches up.
    return mergeApplications(
      response.records.map(indexRecordToSearchItem),
      await discoverApplicationsQuick(),
    );
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
      this.#message = undefined;
      this.#lastStatus = structuredClone(status);
      this.#lastStatusReadAtMs = Date.now();
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
    // Recursive volume watches deliver broad live coverage on macOS. Keep the
    // familiar application directories as overlapping fallback watches in
    // case a filesystem declines a recursive root watch.
    const roots = await existingDirectories([
      ...(await indexRoots(this.#platform, ['/'])),
      ...applicationDirectories(this.#platform),
    ]);
    for (const root of roots) {
      try {
        const watcher = watch(
          root,
          { persistent: false, recursive: this.#platform === 'macos' },
          (_event, filename) => {
            // Watching a macOS volume recursively is inexpensive; rescanning
            // it for every ordinary file save is not. Only application-bundle
            // and volume-mount events trigger the application catalog refresh.
            const changedPath = filename?.toString().replaceAll('\\', '/') ?? '';
            if (changedPath && !isApplicationCatalogChange(changedPath)) return;
            if (this.#applicationDebounce) clearTimeout(this.#applicationDebounce);
            this.#applicationDebounce = setTimeout(() => {
              this.#applicationDebounce = undefined;
              void this.start('applications').catch(() => undefined);
            }, 750);
            this.#applicationDebounce.unref();
          },
        );
        watcher.on('error', () => undefined);
        this.#applicationWatchers.push(watcher);
      } catch {
        // Periodic reconciliation remains active when a platform directory cannot be watched.
      }
    }
  }
}

function timingSummary(timings: readonly IndexRunTiming[]): IndexingStatus['timing'] {
  if (!timings.length) return { samples: 0 };
  const durations = timings.map((timing) => timing.durationMs);
  return {
    samples: durations.length,
    averageDurationMs: Math.round(durations.reduce((total, value) => total + value, 0) / durations.length),
    lastDurationMs: durations[0]!,
    longestDurationMs: Math.max(...durations),
  };
}

function indexScopeLabel(scope: IndexScope): string {
  return {
    all: 'Everything',
    applications: 'Apps',
    commands: 'Commands',
    files: 'Files',
    directories: 'Folders',
  }[scope];
}

function formatTimeout(value: number): string {
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')} seconds`;
  return `${(value / 60_000).toFixed(1).replace(/\.0$/, '')} minutes`;
}

export function indexTimeoutMs(maxCpuPercent = 100, unlimited = false): number {
  const boundedCpu = Math.min(100, Math.max(5, maxCpuPercent));
  const resourceAdjusted =
    boundedCpu >= 25
      ? COMMANDER_INDEX_TIMEOUT_MS
      : Math.min(COMMANDER_MAX_INDEX_TIMEOUT_MS, Math.ceil((COMMANDER_INDEX_TIMEOUT_MS * 25) / boundedCpu));
  return unlimited ? COMMANDER_MAX_INDEX_TIMEOUT_MS : resourceAdjusted;
}

export function indexRecordToSearchItem(record: IndexRecord): SearchItem {
  return {
    id: indexedItemId(record.kind, record.path),
    title: record.name,
    subtitle: record.path,
    kind: record.kind,
    keywords: [record.kind, path.extname(record.name).replace(/^\./, ''), record.parent].filter(Boolean),
    icon: record.kind,
    path: record.path,
    favourite: false,
    actions: pathActions(record.kind),
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

/**
 * `/` means every eligible mounted volume on macOS, not merely the files that
 * happened to be one directory below /Applications. Each source stays on its
 * own filesystem in the Rust walker, avoiding duplicate traversal through
 * mount points while still covering external disks explicitly.
 */
async function indexRoots(platform: Platform, roots: readonly string[]): Promise<string[]> {
  const expanded = roots.map(expandRoot);
  if (platform !== 'macos' || !expanded.some((root) => path.resolve(root) === path.parse(root).root))
    return existingDirectories(expanded);
  return existingDirectories([...expanded, ...(await mountedVolumeRoots())]);
}

async function mountedVolumeRoots(): Promise<string[]> {
  try {
    const entries = await readdir('/Volumes', { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join('/Volumes', entry.name));
  } catch {
    return [];
  }
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

function mergeApplications(indexed: SearchItem[], fallback: SearchItem[]): SearchItem[] {
  const paths = new Set<string>();
  return [...indexed, ...fallback].filter((item) => {
    const key = item.path ?? item.id;
    if (paths.has(key)) return false;
    paths.add(key);
    return true;
  });
}

function deduplicateSearchItems(items: SearchItem[]): SearchItem[] {
  const paths = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.path ?? item.id}`;
    if (paths.has(key)) return false;
    paths.add(key);
    return true;
  });
}

function isApplicationCatalogChange(changedPath: string): boolean {
  const normalized = changedPath.toLowerCase();
  return (
    normalized === 'applications' ||
    normalized.startsWith('applications/') ||
    normalized === 'volumes' ||
    normalized.startsWith('volumes/') ||
    normalized.endsWith('.app') ||
    normalized.includes('.app/')
  );
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
