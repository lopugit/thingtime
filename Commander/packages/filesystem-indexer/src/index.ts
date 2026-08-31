import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

export type IndexKind = 'application' | 'file' | 'directory';
export type IgnoreRuleKind = 'glob' | 'regex';

export interface IndexSource {
  id: string;
  root: string;
  kinds: IndexKind[];
  respectGitIgnore?: boolean;
  includeHidden?: boolean;
  followSymlinks?: boolean;
  maxDepth?: number;
}

export interface IgnoreRule {
  kind: IgnoreRuleKind;
  pattern: string;
}

export interface IndexResourceLimits {
  maxThreads?: number;
  maxParallelism?: number;
  maxOpenDirectories?: number;
  maxCpuPercent?: number;
  maxMemoryMiB?: number;
}

export interface IndexConfiguration {
  sources: IndexSource[];
  customIgnores?: IgnoreRule[];
  maxEntries?: number | null;
  resourceLimits?: IndexResourceLimits;
  pruneSourcePrefixes?: string[];
}

export interface IndexRecord {
  path: string;
  name: string;
  parent: string;
  kind: IndexKind;
  modifiedAtMs?: number;
  size?: number;
  score: number;
}

export interface QueryRequest {
  query: string;
  kinds?: IndexKind[];
  limit?: number;
}

export interface QueryResponse {
  records: IndexRecord[];
}

export interface KindStatus {
  kind: IndexKind;
  count: number;
  lastIndexedAtMs?: number;
  lastDurationMs?: number;
  lastError?: string;
}

export interface IndexStatus {
  schemaVersion: number;
  totalRecords: number;
  databaseSizeBytes: number;
  kinds: KindStatus[];
}

export interface SourceReport {
  sourceId: string;
  root: string;
  indexed: number;
  skipped: number;
  errors: number;
  byKind: Partial<Record<IndexKind, number>>;
  diagnostics: string[];
}

export interface IndexReport {
  startedAtMs: number;
  completedAtMs: number;
  durationMs: number;
  indexed: number;
  skipped: number;
  errors: number;
  sources: SourceReport[];
  status: IndexStatus;
  resources: IndexResourceUsage;
}

export interface IndexProgress {
  sourceId: string;
  root: string;
  processed: number;
  indexed: number;
  skipped: number;
  errors: number;
}

export interface EffectiveResourceLimits {
  logicalCpuCount: number;
  workerThreads: number;
  maxOpenDirectories: number;
  maxCpuPercent: number;
  maxMemoryMiB: number;
  channelCapacity: number;
  sqliteCacheKib: number;
}

export interface IndexResourceUsage {
  effective: EffectiveResourceLimits;
  cpuTimeMs: number;
  averageCpuPercent: number;
  peakMemoryBytes: number;
  throttledMs: number;
  memoryChecks: number;
}

type RequestOperation =
  | { operation: 'status' }
  | { operation: 'index'; configuration: IndexConfiguration }
  | { operation: 'query'; request: QueryRequest }
  | { operation: 'lookup'; path: string; kind: IndexKind };

interface SuccessResponse<T> {
  id: string;
  ok: true;
  result: T;
}

interface ErrorResponse {
  id: string;
  ok: false;
  error: { code: string; message: string };
}

interface ProgressResponse {
  id: string;
  event: 'progress';
  progress: IndexProgress;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: { cancel(): void };
  onProgress?: (progress: IndexProgress) => void;
}

interface QueuedQuery {
  key: string;
  request: QueryRequest;
  promise: Promise<QueryResponse>;
  resolve(value: QueryResponse): void;
  reject(error: Error): void;
}

export interface FileSystemIndexerClientOptions {
  binaryPath: string;
  databasePath: string;
  requestTimeoutMs?: number;
  indexTimeoutMs?: number;
  /** Primarily useful for test harnesses or a platform launcher wrapper. */
  prefixArguments?: string[];
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_INDEX_TIMEOUT_MS = 30 * 60_000;
const INDEXER_CPU_SAMPLE_MS = 2_000;
const INDEXER_HIGH_CPU_PERCENT = 85;
const INDEXER_HIGH_CPU_SAMPLES = 3;
const INDEXER_MAX_RESTART_ATTEMPTS = 5;
const MAX_TIMER_DELAY_MS = 0x7fffffff;
const execFileAsync = promisify(execFile);

export class FileSystemIndexerClient {
  readonly #options: FileSystemIndexerClientOptions;
  #process: ChildProcessWithoutNullStreams | undefined;
  #pending = new Map<string, PendingRequest>();
  #sequence = 0;
  #stderrBytes = 0;
  #closed = false;
  #restartTimer: ReturnType<typeof setTimeout> | undefined;
  #cpuTimer: ReturnType<typeof setInterval> | undefined;
  #highCpuSamples = 0;
  #indexRequests = new Set<string>();
  // The JSONL daemon is single-threaded. Keep one index operation in flight so
  // an accidental concurrent caller joins the same work instead of queueing a
  // duplicate whole-tree scan behind it.
  #indexOperation: Promise<IndexReport> | undefined;
  #queryOperation: { key: string; promise: Promise<QueryResponse> } | undefined;
  #queuedQuery: QueuedQuery | undefined;
  #restartAttempts = 0;

  constructor(options: FileSystemIndexerClientOptions) {
    this.#options = options;
    this.#start();
    this.#cpuTimer = setInterval(() => void this.#checkWorkerCpu(), INDEXER_CPU_SAMPLE_MS);
    this.#cpuTimer.unref();
  }

  status(): Promise<IndexStatus> {
    return this.#request<IndexStatus>({ operation: 'status' });
  }

  index(
    configuration: IndexConfiguration,
    timeoutMs?: number,
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<IndexReport> {
    if (this.#indexOperation) return this.#indexOperation;
    const operation = this.#request<IndexReport>(
      { operation: 'index', configuration },
      timeoutMs ?? this.#options.indexTimeoutMs ?? DEFAULT_INDEX_TIMEOUT_MS,
      onProgress,
    );
    this.#indexOperation = operation;
    void operation.then(
      () => {
        if (this.#indexOperation === operation) this.#indexOperation = undefined;
      },
      () => {
        if (this.#indexOperation === operation) this.#indexOperation = undefined;
      },
    );
    return operation;
  }

  query(request: QueryRequest): Promise<QueryResponse> {
    const key = JSON.stringify(request);
    if (!this.#queryOperation) return this.#beginQuery(key, request);
    if (this.#queryOperation.key === key) return this.#queryOperation.promise;
    if (this.#queuedQuery?.key === key) return this.#queuedQuery.promise;
    this.#queuedQuery?.resolve({ records: [] });
    let resolve!: (value: QueryResponse) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<QueryResponse>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    this.#queuedQuery = { key, request, promise, resolve, reject };
    return promise;
  }

  lookup(path: string, kind: IndexKind): Promise<IndexRecord | null> {
    return this.#request<IndexRecord | null>({ operation: 'lookup', path, kind });
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    if (this.#cpuTimer) clearInterval(this.#cpuTimer);
    this.#restartTimer = undefined;
    this.#cpuTimer = undefined;
    const child = this.#process;
    this.#process = undefined;
    this.#failPending(new Error('Filesystem indexer closed'));
    this.#queuedQuery?.reject(new Error('Filesystem indexer closed'));
    this.#queuedQuery = undefined;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 2_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  #start(): void {
    const arguments_ = [
      ...(this.#options.prefixArguments ?? []),
      'serve',
      '--database',
      this.#options.databasePath,
    ];
    const child = spawn(this.#options.binaryPath, arguments_, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Keep the Rust indexer in an isolated process group. A stalled worker can
      // be terminated without taking down Commander or its Node daemon.
      detached: process.platform !== 'win32',
    });
    this.#stderrBytes = 0;
    this.#process = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.#receive(line));
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.#stderrBytes >= 16_384) return;
      const remaining = 16_384 - this.#stderrBytes;
      const message = chunk.subarray(0, remaining).toString('utf8').trim();
      this.#stderrBytes += chunk.length;
      if (message) process.stderr.write(`[commander-indexer] ${message}\n`);
    });
    child.once('error', (error) => this.#failProcess(child, error));
    child.once('exit', (code, signal) =>
      this.#failProcess(child, new Error(`Filesystem indexer exited (${signal ?? code ?? 'unknown'})`)),
    );
  }

  #beginQuery(key: string, request: QueryRequest): Promise<QueryResponse> {
    const promise = this.#request<QueryResponse>({ operation: 'query', request });
    const operation = { key, promise };
    this.#queryOperation = operation;
    void promise.then(
      () => this.#finishQuery(operation),
      () => this.#finishQuery(operation),
    );
    return promise;
  }

  #finishQuery(operation: { key: string; promise: Promise<QueryResponse> }): void {
    if (this.#queryOperation !== operation) return;
    this.#queryOperation = undefined;
    const queued = this.#queuedQuery;
    this.#queuedQuery = undefined;
    if (!queued) return;
    if (this.#closed) {
      queued.reject(new Error('Filesystem indexer closed'));
      return;
    }
    void this.#beginQuery(queued.key, queued.request).then(queued.resolve, queued.reject);
  }

  #request<T>(
    operation: RequestOperation,
    timeoutMs?: number,
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<T> {
    this.#closed = false;
    if (!this.#process) this.#start();
    const child = this.#process!;
    const id = `indexer-${process.pid}-${++this.#sequence}`;
    return new Promise<T>((resolve, reject) => {
      const duration = timeoutMs ?? this.#options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timeout = scheduleTimeout(() => {
        this.#failProcess(child, new Error(`Filesystem indexer request timed out after ${duration}ms`));
      }, duration);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
        ...(onProgress ? { onProgress } : {}),
      });
      if (operation.operation === 'index') this.#indexRequests.add(id);
      child.stdin.write(`${JSON.stringify({ id, ...operation })}\n`, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        this.#indexRequests.delete(id);
        pending.timeout.cancel();
        pending.reject(error);
      });
    });
  }

  #receive(line: string): void {
    let response: SuccessResponse<unknown> | ErrorResponse | ProgressResponse;
    try {
      response = JSON.parse(line) as SuccessResponse<unknown> | ErrorResponse | ProgressResponse;
    } catch (error) {
      this.#failPending(
        new Error(
          `Filesystem indexer returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }
    if (!response || typeof response.id !== 'string') {
      this.#failPending(new Error('Filesystem indexer returned an uncorrelated response'));
      return;
    }
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    if ('event' in response) {
      if (response.event === 'progress') pending.onProgress?.(response.progress);
      return;
    }
    this.#pending.delete(response.id);
    this.#indexRequests.delete(response.id);
    this.#restartAttempts = 0;
    pending.timeout.cancel();
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
  }

  #failProcess(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.#process !== child) return;
    this.#process = undefined;
    if (child.exitCode === null) child.kill('SIGTERM');
    this.#failPending(error);
    this.#scheduleRestart();
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.timeout.cancel();
      pending.reject(error);
    }
    this.#pending.clear();
    this.#indexRequests.clear();
    this.#indexOperation = undefined;
  }

  #scheduleRestart(): void {
    if (this.#closed || this.#restartTimer || this.#restartAttempts >= INDEXER_MAX_RESTART_ATTEMPTS)
      return;
    const delay = Math.min(10_000, 1_000 * 2 ** this.#restartAttempts);
    this.#restartAttempts += 1;
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = undefined;
      if (!this.#closed && !this.#process) this.#start();
    }, delay);
    this.#restartTimer.unref();
  }

  async #checkWorkerCpu(): Promise<void> {
    const child = this.#process;
    if (this.#closed || !child || child.pid === undefined || this.#indexRequests.size > 0) {
      this.#highCpuSamples = 0;
      return;
    }
    try {
      const { stdout } = await execFileAsync('/bin/ps', ['-o', '%cpu=', '-p', String(child.pid)], {
        timeout: 1_000,
        maxBuffer: 1_024,
      });
      const cpu = Number(stdout.trim());
      this.#highCpuSamples = Number.isFinite(cpu) && cpu >= INDEXER_HIGH_CPU_PERCENT
        ? this.#highCpuSamples + 1
        : 0;
      if (this.#highCpuSamples < INDEXER_HIGH_CPU_SAMPLES) return;
      this.#highCpuSamples = 0;
      this.#failProcess(child, new Error('Filesystem indexer restarted after sustained high CPU outside indexing'));
    } catch {
      // A process that exits between sampling and ps is handled by its exit listener.
    }
  }
}

/**
 * Node clamps a single setTimeout call above 2^31-1 milliseconds. Chain the
 * timer internally so the user-facing index timeout has no product ceiling.
 */
function scheduleTimeout(callback: () => void, durationMs: number): { cancel(): void } {
  let remaining = Math.max(1, Math.floor(durationMs));
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    const delay = Math.min(remaining, MAX_TIMER_DELAY_MS);
    timer = setTimeout(() => {
      if (cancelled) return;
      remaining -= delay;
      if (remaining > 0) schedule();
      else callback();
    }, delay);
  };
  schedule();
  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
