import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

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

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
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

export class FileSystemIndexerClient {
  readonly #options: FileSystemIndexerClientOptions;
  #process: ChildProcessWithoutNullStreams | undefined;
  #pending = new Map<string, PendingRequest>();
  #sequence = 0;
  #stderrBytes = 0;

  constructor(options: FileSystemIndexerClientOptions) {
    this.#options = options;
    this.#start();
  }

  status(): Promise<IndexStatus> {
    return this.#request<IndexStatus>({ operation: 'status' });
  }

  index(configuration: IndexConfiguration, timeoutMs?: number): Promise<IndexReport> {
    return this.#request<IndexReport>(
      { operation: 'index', configuration },
      timeoutMs ?? this.#options.indexTimeoutMs ?? DEFAULT_INDEX_TIMEOUT_MS,
    );
  }

  query(request: QueryRequest): Promise<QueryResponse> {
    return this.#request<QueryResponse>({ operation: 'query', request });
  }

  lookup(path: string, kind: IndexKind): Promise<IndexRecord | null> {
    return this.#request<IndexRecord | null>({ operation: 'lookup', path, kind });
  }

  async close(): Promise<void> {
    const child = this.#process;
    this.#process = undefined;
    this.#failPending(new Error('Filesystem indexer closed'));
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

  #request<T>(operation: RequestOperation, timeoutMs?: number): Promise<T> {
    if (!this.#process) this.#start();
    const child = this.#process!;
    const id = `indexer-${process.pid}-${++this.#sequence}`;
    return new Promise<T>((resolve, reject) => {
      const duration = timeoutMs ?? this.#options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.#failProcess(child, new Error(`Filesystem indexer request timed out after ${duration}ms`));
      }, duration);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, ...operation })}\n`, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error);
      });
    });
  }

  #receive(line: string): void {
    let response: SuccessResponse<unknown> | ErrorResponse;
    try {
      response = JSON.parse(line) as SuccessResponse<unknown> | ErrorResponse;
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
    this.#pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
  }

  #failProcess(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.#process !== child) return;
    this.#process = undefined;
    if (child.exitCode === null) child.kill('SIGTERM');
    this.#failPending(error);
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
