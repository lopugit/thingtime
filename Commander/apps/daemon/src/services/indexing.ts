import { access, readdir, realpath, lstat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
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
import {
  applicationDirectories,
  discoverApplications,
  discoverApplicationsQuick,
  discoverApplicationsIn,
} from './applications.js';
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
  /** Isolated test/development catalog roots; production defaults to all volumes. */
  applicationRoots?: string[];
  platform: Platform;
  settings: CommanderSettings;
  callbacks: IndexingCallbacks;
}

interface ScheduledIndexRun {
  scope: IndexScope;
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
  changedPaths?: string[];
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
  readonly #applicationRoots: string[];
  readonly #customApplicationRoots: boolean;
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
  #changeDeadline: ReturnType<typeof setTimeout> | undefined;
  #changedPaths = new Set<string>();
  #closed = false;
  #watchGeneration = 0;
  #applications: SearchItem[] = [];
  #applicationSignature: string | undefined;
  #filesystemCurrent = true;
  #legacySnapshot = false;
  #legacyRoots = '';
  #effectiveFilesystemRoots: string[] = [];
  #settingsDirty = false;
  #fullReconciliationNeeded = false;
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
    this.#applicationRoots = options.applicationRoots ?? ['/'];
    this.#customApplicationRoots = options.applicationRoots !== undefined;
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
    this.#reader = new FileSystemIndexerClient({ ...clientOptions, reader: true });
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
        this.#effectiveFilesystemRoots = await indexRoots(this.#platform, this.#settings.roots);
        this.#lastStatus = await this.#reader.status();
        this.#lastStatusReadAtMs = Date.now();
        const savedFingerprint = this.#lastStatus.configurationFingerprints?.['filesystem:'];
        this.#filesystemCurrent = savedFingerprint === this.#settingsFingerprint();
        if (savedFingerprint === undefined && this.#settings.enabled) {
          // Legacy absence is distinct from a known mismatched configuration.
          // Filter the cached snapshot by current source membership and policy
          // without scanning the index or claiming an unmeasured current total.
          await this.#reader.readPolicy(this.#legacyReadConfiguration());
          this.#legacySnapshot = true;
          this.#legacyRoots = JSON.stringify(this.#effectiveFilesystemRoots);
          this.#filesystemCurrent = true;
        }
        this.#available = true;
        applications = await this.#queryApplications();
      } catch (error) {
        this.#disableRust(error);
      }
    }
    // The fallback gives the launcher freshly installed top-level applications
    // while a missing/stale index is refreshed independently in the background.
    applications = mergeApplications(applications, await this.#quickApplications());
    this.#publishApplications(applications);
    this.#timer = setInterval(() => void this.#automaticRefresh(), 60_000);
    this.#timer.unref();
    void this.#watchSources();
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
    if (previous !== JSON.stringify(this.#settings)) {
      this.#filesystemCurrent = false;
      this.#legacySnapshot = false;
      void this.#watchSources();
      // A settings change during an active run must rebuild with the new rules.
      if (this.#activeRun) this.#settingsDirty = true;
      else void this.start('all').catch(() => undefined);
    }
  }

  async queryItems(query: string, limit = FILESYSTEM_RESULT_PAGE_SIZE): Promise<SearchItem[]> {
    if (!this.#reader || !this.#settings.enabled || !this.#filesystemCurrent || !query.trim()) return [];
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
    if (decoded.kind === 'application') return this.#applications.find((item) => item.path === decoded.path);
    if (!this.#settings.enabled || !this.#filesystemCurrent) return undefined;
    try {
      const record = await this.#reader.lookup(decoded.path, decoded.kind);
      return record ? indexRecordToSearchItem(record) : undefined;
    } catch (error) {
      this.#message = errorMessage(error);
      return undefined;
    }
  }

  start(scope: IndexScope): Promise<void> {
    if (this.#closed) return Promise.reject(new Error('Filesystem indexing service closed'));
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
      pending.scope = 'all';
      return pending.promise;
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
    void this.#perform(run.scope, run.changedPaths)
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
        if (this.#closed) return;
        if (this.#settingsDirty) {
          this.#settingsDirty = false;
          const replacement = this.#createRun('all');
          void replacement.promise.then(
            () => next?.resolve(),
            (error) => next?.reject(error),
          );
          void replacement.promise.catch(() => undefined);
          this.#activateRun(replacement);
        } else if (next) this.#activateRun(next);
        else this.#flushChanges();
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
    const filesystemEnabled = this.#settings.enabled && this.#filesystemCurrent;
    const countsCurrent = !this.#legacySnapshot;
    const kinds = (status?.kinds ?? emptyKindStatuses()).map((kind) => ({
      ...kind,
      count:
        kind.kind === 'application'
          ? this.#applications.length
          : filesystemEnabled && countsCurrent
            ? kind.count
            : 0,
    }));
    const timestamps = [
      this.#lastCommandsIndexedAtMs,
      this.#lastFallbackApplicationsAtMs ??
        kinds.find((kind) => kind.kind === 'application')?.lastIndexedAtMs,
      ...(filesystemEnabled
        ? kinds.filter((kind) => kind.kind !== 'application').map((kind) => kind.lastIndexedAtMs)
        : []),
    ];
    const lastIndexedAtMs = timestamps.every((time) => time !== undefined)
      ? Math.min(...(timestamps as number[]))
      : undefined;
    return {
      available: this.#available,
      running: [...this.#running],
      totalRecords: status?.totalRecords ?? 0,
      countsCurrent,
      ...(this.#legacySnapshot || (status && status.schemaVersion < 4)
        ? {}
        : {
            searchableRecords: kinds.reduce((total, kind) => total + kind.count, this.#commandCount),
          }),
      ...(lastIndexedAtMs === undefined ? {} : { lastIndexedAtMs }),
      databaseSizeBytes: status?.databaseSizeBytes ?? 0,
      kinds,
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
    this.#closed = true;
    this.#watchGeneration += 1;
    if (this.#changeDeadline) clearTimeout(this.#changeDeadline);
    this.#changedPaths.clear();
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

  async #perform(scope: IndexScope, changedPaths?: string[]): Promise<void> {
    this.#beginProgress(scope);
    if (this.#legacySnapshot && this.#reader) await this.#reader.readPolicy(this.#legacyReadConfiguration());
    if (scope === 'commands') {
      this.reindexCommands();
      if (this.#progress) this.#progress.processed = 1;
      return;
    }
    if (scope === 'all') {
      if (!changedPaths) this.reindexCommands();
      const applicationChanges = changedPaths
        ? (
            await Promise.all(
              changedPaths.map(async (changed) => {
                if (
                  isApplicationCatalogChange(changed) ||
                  this.#applications.some((item) => item.path && isWithin(item.path, changed))
                )
                  return changed;
                return await lstat(changed).then(
                  (entry) => (entry.isDirectory() ? changed : undefined),
                  () => undefined,
                );
              }),
            )
          ).filter((changed): changed is string => changed !== undefined)
        : undefined;
      if (!applicationChanges || applicationChanges.length) await this.#indexApplications(applicationChanges);
      if (this.#settings.enabled) await this.#indexFilesystem(['file', 'directory'], changedPaths);
      return;
    }
    if (scope === 'applications') {
      await this.#indexApplications();
      return;
    }
    if (!this.#settings.enabled) throw new Error('Filesystem indexing is disabled in Search Settings');
    await this.#indexFilesystem([scope === 'files' ? 'file' : 'directory']);
  }

  async #indexApplications(changedPaths?: string[]): Promise<void> {
    if (!this.#writer || !this.#reader) {
      await this.#refreshFallbackApplications();
      return;
    }
    const roots = await indexRoots(this.#platform, this.#applicationRoots);
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
      ...(changedPaths ? { changedPaths } : {}),
    });
    this.#available = true;
    this.#message = undefined;
    this.#publishApplications(await this.#queryApplications());
  }

  async #indexFilesystem(kinds: IndexKind[], changedPaths?: string[]): Promise<void> {
    if (!this.#writer) throw new Error('The bundled Rust filesystem indexer is unavailable');
    const roots = await indexRoots(this.#platform, this.#settings.roots);
    this.#effectiveFilesystemRoots = roots;
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
      settingsFingerprint: this.#settingsFingerprint(),
      pruneSourcePrefixes: ['filesystem:'],
      ...(changedPaths ? { changedPaths } : {}),
    };
    const settingsAtStart = JSON.stringify(this.#settings);
    await this.#writeIndex(configuration);
    if (!changedPaths && settingsAtStart === JSON.stringify(this.#settings)) {
      // The replacement is now bound to these settings, so normal indexed
      // queries and cached unique counters can take over atomically.
      await this.#reader?.readPolicy(null);
      this.#legacySnapshot = false;
      this.#filesystemCurrent = true;
    }
    this.#available = true;
    this.#message = undefined;
    this.#publishApplications(await this.#queryApplications());
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
    const roots = await indexRoots(this.#platform, this.#applicationRoots);
    const response = await this.#reader.catalogue(
      ['application'],
      'applications:',
      roots.map((root) => `applications:${root}`),
    );
    // Read the complete persistent app catalogue, including freshly installed
    // apps that the bounded direct scan can see before the index catches up.
    return mergeApplications(response.records.map(indexRecordToSearchItem), await this.#quickApplications());
  }

  async #automaticRefresh(): Promise<void> {
    if (this.#closed || this.#activeRun) return;
    this.#effectiveFilesystemRoots = await indexRoots(this.#platform, this.#settings.roots);
    if (this.#legacySnapshot && this.#legacyRoots !== JSON.stringify(this.#effectiveFilesystemRoots)) {
      this.#legacySnapshot = false;
      this.#filesystemCurrent = false;
    } else if (
      !this.#legacySnapshot &&
      this.#lastStatus?.configurationFingerprints?.['filesystem:'] !== this.#settingsFingerprint()
    ) {
      this.#filesystemCurrent = false;
    }
    this.reindexCommands();
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
    if (this.#settings.enabled && (!this.#filesystemCurrent || this.#legacySnapshot)) {
      void this.start('all').catch(() => undefined);
      return;
    }
    const applicationsDue = isDue(status, 'application', APPLICATION_REFRESH_MINUTES, now);
    if (!this.#settings.enabled) {
      if (applicationsDue) void this.start('applications').catch(() => undefined);
      return;
    }
    const filesDue = isDue(status, 'file', this.#settings.refreshIntervalMinutes, now);
    const directoriesDue = isDue(status, 'directory', this.#settings.refreshIntervalMinutes, now);
    if ((filesDue && directoriesDue) || (applicationsDue && (filesDue || directoriesDue)))
      void this.start('all').catch(() => undefined);
    else if (applicationsDue) void this.start('applications').catch(() => undefined);
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
    const applications = this.#customApplicationRoots
      ? await discoverApplicationsIn(this.#applicationRoots)
      : await discoverApplications();
    this.#lastFallbackApplicationsAtMs = Date.now();
    this.#publishApplications(applications);
  }

  #legacyReadConfiguration(): IndexConfiguration {
    return {
      sources: this.#effectiveFilesystemRoots.map((root) => ({
        id: `filesystem:${root}`,
        root,
        kinds: ['file', 'directory'],
        respectGitIgnore: this.#settings.respectGitIgnore,
        includeHidden: this.#settings.includeHidden,
        followSymlinks: false,
      })),
      customIgnores: this.#settings.customIgnores,
    };
  }

  #settingsFingerprint(): string {
    return createHash('sha256')
      .update(JSON.stringify({ settings: this.#settings, roots: [...this.#effectiveFilesystemRoots].sort() }))
      .digest('hex');
  }

  #quickApplications(): Promise<SearchItem[]> {
    return this.#customApplicationRoots
      ? discoverApplicationsIn(this.#applicationRoots)
      : discoverApplicationsQuick();
  }

  #publishApplications(applications: SearchItem[]): void {
    if (this.#closed) return;
    const signature = JSON.stringify(applications);
    this.#applications = applications;
    if (signature === this.#applicationSignature) return;
    this.#applicationSignature = signature;
    this.#callbacks.applications(applications);
  }

  async #watchSources(): Promise<void> {
    const generation = ++this.#watchGeneration;
    for (const watcher of this.#applicationWatchers.splice(0)) watcher.close();
    const filesystemRoots =
      this.#reader && this.#settings.enabled ? await indexRoots(this.#platform, this.#settings.roots) : [];
    const roots = await existingDirectories([
      ...(this.#reader ? await indexRoots(this.#platform, this.#applicationRoots) : []),
      ...filesystemRoots,
      ...(!this.#customApplicationRoots ? applicationDirectories(this.#platform) : []),
    ]);
    if (this.#closed || generation !== this.#watchGeneration) return;
    const watchedRoots: string[] = [];
    for (const root of roots) {
      if (this.#platform !== 'linux' && watchedRoots.some((watched) => isWithin(root, watched))) continue;
      try {
        const watcher = watch(
          root,
          { persistent: false, recursive: this.#platform !== 'linux' },
          (_event, filename) => {
            const raw = filename ? path.resolve(root, filename.toString()) : root;
            const changed = applicationBundleRoot(raw);
            // WAL/status writes must never schedule another indexing run.
            if (isWithin(changed, path.dirname(this.#databasePath))) return;
            const filesystemRelevant =
              this.#settings.enabled &&
              filesystemRoots.some((entry) => isWithin(changed, entry) || isWithin(entry, changed));
            // A rename can remove an entire subtree containing applications, so
            // non-file events remain relevant to the global app inventory.
            if (!filesystemRelevant && _event !== 'rename' && !isApplicationCatalogChange(changed)) return;
            if (
              changed === '/Volumes' ||
              path.dirname(changed) === '/Volumes' ||
              /(?:^|\/)git\/ignore$/u.test(changed)
            ) {
              this.#fullReconciliationNeeded = true;
              void this.#watchSources();
            }
            const coalesced = collapsePaths([...this.#changedPaths, changed]);
            // Bound pending event memory by widening to affected parents, never
            // dropping a change. This is a batching budget, not an index limit.
            this.#changedPaths = new Set(
              coalesced.length > 256
                ? collapsePaths(coalesced.map((entry) => path.dirname(entry)))
                : coalesced,
            );
            if (this.#applicationDebounce) clearTimeout(this.#applicationDebounce);
            this.#applicationDebounce = setTimeout(() => this.#flushChanges(), 750);
            this.#applicationDebounce.unref();
            if (!this.#changeDeadline) {
              this.#changeDeadline = setTimeout(() => this.#flushChanges(), 3_000);
              this.#changeDeadline.unref();
            }
          },
        );
        watcher.on('error', () => undefined);
        this.#applicationWatchers.push(watcher);
        watchedRoots.push(root);
      } catch {
        // Periodic reconciliation remains the safety net for unavailable watches.
      }
    }
  }

  #flushChanges(): void {
    if (this.#applicationDebounce) clearTimeout(this.#applicationDebounce);
    if (this.#changeDeadline) clearTimeout(this.#changeDeadline);
    this.#applicationDebounce = undefined;
    this.#changeDeadline = undefined;
    if (this.#closed || this.#activeRun || !this.#changedPaths.size) return;
    const changedPaths = collapsePaths([...this.#changedPaths]);
    this.#changedPaths.clear();
    const run = this.#createRun('all');
    if (!this.#fullReconciliationNeeded && this.#settings.maxEntries === null) {
      run.changedPaths = collapsePaths(
        changedPaths.map((changed) =>
          changed.endsWith(`${path.sep}.git${path.sep}info${path.sep}exclude`)
            ? path.resolve(changed, '../../..')
            : ['.gitignore', '.ignore'].includes(path.basename(changed))
              ? path.dirname(changed)
              : changed,
        ),
      );
    }
    this.#fullReconciliationNeeded = false;
    void run.promise.catch(() => undefined);
    this.#activateRun(run);
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
  const unique = [
    ...new Set(
      values.map((value) => {
        const resolved = path.resolve(value);
        return process.platform === 'darwin' && isWithin(resolved, '/System/Volumes/Data')
          ? path.join('/', path.relative('/System/Volumes/Data', resolved))
          : resolved;
      }),
    ),
  ];
  const existing = await Promise.all(
    unique.map(async (value) => {
      try {
        await access(value);
        return await realpath(value);
      } catch {
        return undefined;
      }
    }),
  );
  return existing.filter((value): value is string => Boolean(value));
}

function mergeApplications(indexed: SearchItem[], fallback: SearchItem[]): SearchItem[] {
  const paths = new Set<string>();
  return [...indexed, ...fallback]
    .map((item) => {
      const prefix = '/System/Volumes/Data';
      if (process.platform !== 'darwin' || !item.path?.startsWith(`${prefix}/`)) return item;
      const itemPath = item.path.slice(prefix.length);
      return {
        ...item,
        path: itemPath,
        subtitle: itemPath,
        id: item.id.startsWith('index:') ? indexedItemId('application', itemPath) : `app:${itemPath}`,
      };
    })
    .filter((item) => {
      const key = item.path ?? item.id;
      if (paths.has(key)) return false;
      paths.add(key);
      return true;
    });
}

export function applicationBundleRoot(changed: string): string {
  const parts = path.resolve(changed).split(path.sep);
  const bundle = parts.findIndex((part) => part.toLowerCase().endsWith('.app'));
  return bundle < 0 ? path.resolve(changed) : parts.slice(0, bundle + 1).join(path.sep);
}

function isApplicationCatalogChange(changed: string): boolean {
  return (
    changed.endsWith('.app') ||
    changed.includes('.app/') ||
    /(?:^|\/)(?:Applications|Volumes)(?:\/|$)/u.test(changed)
  );
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export function collapsePaths(paths: readonly string[]): string[] {
  const result: string[] = [];
  for (const candidate of [...new Set(paths.map((value) => path.resolve(value)))].sort(
    (a, b) => a.length - b.length,
  )) {
    if (!result.some((root) => isWithin(candidate, root))) result.push(candidate);
  }
  return result;
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
