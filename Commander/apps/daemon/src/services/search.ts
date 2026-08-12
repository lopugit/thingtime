import { createInterface } from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  SearchErrorResponse,
  SearchHit,
  SearchItem,
  SearchRequest,
  SearchResponse,
} from '@commander/protocol';

interface Pending {
  resolve(hits: SearchHit[]): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const SEARCH_TIMEOUT_MS = 5_000;

export class SearchService {
  #items: SearchItem[] = [];
  #rust: ChildProcessWithoutNullStreams | undefined;
  #pending: Pending[] = [];

  constructor(rustBinary?: string) {
    if (rustBinary) this.#startRust(rustBinary);
  }

  setItems(items: SearchItem[]): void {
    this.#items = items;
  }
  items(): SearchItem[] {
    return this.#items;
  }

  async search(query: string, limit = 30): Promise<SearchHit[]> {
    const child = this.#rust;
    if (!child) return fallbackSearch(query, this.#items, limit);
    try {
      return await new Promise<SearchHit[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#failRust(new Error(`Rust search core timed out after ${SEARCH_TIMEOUT_MS}ms`), child);
        }, SEARCH_TIMEOUT_MS);
        this.#pending.push({ resolve, reject, timer });
        const request: SearchRequest = { query, items: this.#items, limit };
        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (error) this.#failRust(error, child);
        });
      });
    } catch {
      return fallbackSearch(query, this.#items, limit);
    }
  }

  close(): void {
    const child = this.#rust;
    this.#rust = undefined;
    for (const pending of this.#pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Search service closed'));
    }
    if (child?.exitCode === null) child.kill('SIGTERM');
  }

  #startRust(binary: string): void {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#rust = child;
    createInterface({ input: child.stdout }).on('line', (line) => {
      const next = this.#pending.shift();
      if (!next) return;
      clearTimeout(next.timer);
      try {
        const parsed = JSON.parse(line) as SearchHit[] | SearchResponse | SearchErrorResponse;
        if (!Array.isArray(parsed) && 'error' in parsed) {
          next.reject(
            new Error(parsed.error.message || parsed.error.code || 'Rust search core rejected the request'),
          );
          return;
        }
        const hits = Array.isArray(parsed) ? parsed : 'hits' in parsed ? parsed.hits : undefined;
        if (!hits) throw new Error('Rust search core returned no hits');
        next.resolve(hits);
      } catch (error) {
        next.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    let stderrBytes = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= 8_192) return;
      const text = chunk
        .subarray(0, 8_192 - stderrBytes)
        .toString('utf8')
        .trim();
      stderrBytes += chunk.length;
      if (text) process.stderr.write(`[commander-search] ${text}\n`);
    });
    child.once('error', (error) => this.#failRust(error, child));
    child.once('exit', (code, signal) =>
      this.#failRust(new Error(`Rust search core exited (${signal ?? code ?? 'unknown'})`), child),
    );
  }

  #failRust(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#rust !== child) return;
    this.#rust = undefined;
    if (child.exitCode === null) child.kill('SIGTERM');
    for (const pending of this.#pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function score(query: string, item: SearchItem): number {
  if (!query) return item.favourite ? 20_000 : 1_000;
  const needle = query.toLowerCase().trim();
  const title = item.title.toLowerCase();
  const subtitle = item.subtitle?.toLowerCase() ?? '';
  const keyword = item.keywords.join(' ').toLowerCase();
  if (title === needle) return 100_000;
  if (title.startsWith(needle)) return 80_000 - title.length;
  if (title.includes(needle)) return 60_000 - title.indexOf(needle);
  if (subtitle.includes(needle)) return 35_000 - subtitle.indexOf(needle);
  if (keyword.includes(needle)) return 25_000 - keyword.indexOf(needle);
  let cursor = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = title.indexOf(character, cursor);
    if (found < 0) return -1;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 10_000 - gaps;
}

export function fallbackSearch(query: string, items: SearchItem[], limit: number): SearchHit[] {
  return items
    .map((item) => ({ ...item, score: score(query, item), matchedRanges: [] }))
    .filter((item) => item.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}
