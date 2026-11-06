import { createInterface } from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  SearchErrorResponse,
  SearchHit,
  SearchItem,
  SearchRequest,
  SearchResponse,
  SearchCategory,
} from '@commander/protocol';
import { fuzzyTextScore } from '@commander/protocol';

interface Pending {
  resolve(hits: SearchHit[]): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const SEARCH_TIMEOUT_MS = 5_000;
// Just below an exact title: the existing category preference can lift a
// complete app-name word above an exact file, while learned/file-first
// preferences still win. Keep in sync with commander-core.
const APPLICATION_NAME_WORD_SCORE = 99_300;

function matchesApplicationNameWords(query: string, title: string): boolean {
  const needle = Array.from(query.trim())
    .slice(0, 128)
    .join('')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
  if (Array.from(needle).length < 3) return false;
  const words = Array.from(title)
    .slice(0, 512)
    .join('')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (let start = 0; start < words.length; start += 1) {
    let phrase = '';
    for (let end = start; end < words.length && phrase.length < needle.length; end += 1) {
      phrase += words[end];
      if (phrase === needle) return true;
    }
  }
  return false;
}

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

  /**
   * Returns the immutable-in-practice catalog a search should use for its
   * entire lifetime. A catalog refresh swaps `#items` atomically, so taking a
   * shallow copy here keeps an in-flight streamed search coherent while the
   * next search sees the newer catalog immediately.
   */
  snapshot(): SearchItem[] {
    return [...this.#items];
  }

  async search(
    query: string,
    limit = 30,
    additionalItems: SearchItem[] = [],
    preferenceScores: Readonly<Record<string, number>> = {},
    categoryOrder: readonly SearchCategory[] = ['applications', 'commands', 'files'],
  ): Promise<SearchHit[]> {
    return this.searchSnapshot(
      query,
      this.snapshot(),
      limit,
      additionalItems,
      preferenceScores,
      categoryOrder,
    );
  }

  async searchSnapshot(
    query: string,
    catalog: readonly SearchItem[],
    limit = 30,
    additionalItems: SearchItem[] = [],
    preferenceScores: Readonly<Record<string, number>> = {},
    categoryOrder: readonly SearchCategory[] = ['applications', 'commands', 'files'],
  ): Promise<SearchHit[]> {
    const items = mergeItems(catalog, additionalItems).map((item) => {
      const preferenceScore = Math.min(
        100_000,
        Math.max(0, item.preferenceScore ?? 0) +
          Math.max(0, preferenceScores[item.id] ?? 0) +
          categoryPreferenceScore(item, categoryOrder),
      );
      return preferenceScore ? { ...item, preferenceScore } : item;
    });
    const child = this.#rust;
    if (!child) return fallbackSearch(query, items, limit);
    try {
      return await new Promise<SearchHit[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#failRust(new Error(`Rust search core timed out after ${SEARCH_TIMEOUT_MS}ms`), child);
        }, SEARCH_TIMEOUT_MS);
        this.#pending.push({ resolve, reject, timer });
        const request: SearchRequest = { query, items, limit };
        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (error) this.#failRust(error, child);
        });
      });
    } catch {
      return fallbackSearch(query, items, limit);
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

function categoryPreferenceScore(item: SearchItem, order: readonly SearchCategory[]): number {
  const category: SearchCategory =
    item.kind === 'application'
      ? 'applications'
      : item.kind === 'file' || item.kind === 'directory'
        ? 'files'
        : 'commands';
  const index = order.indexOf(category);
  if (index < 0) return 0;
  return Math.max(0, order.length - index - 1) * 600;
}

function mergeItems(catalog: readonly SearchItem[], additional: SearchItem[]): SearchItem[] {
  if (!additional.length) return [...catalog];
  const seen = new Set<string>();
  return [...catalog, ...additional].filter((item) =>
    seen.has(item.id) ? false : (seen.add(item.id), true),
  );
}

function score(query: string, item: SearchItem): number {
  const preference = Math.min(100_000, Math.max(0, item.preferenceScore ?? 0));
  if (!query) return (item.favourite ? 20_000 : 1_000) + preference;
  const needle = query.toLowerCase().trim();
  const title = item.title.toLowerCase();
  const subtitle = item.subtitle?.toLowerCase() ?? '';
  const keyword = item.keywords.join(' ').toLowerCase();
  let titleScore = fuzzyTextScore(needle, title);
  if (titleScore >= 0 && item.kind === 'application' && matchesApplicationNameWords(query, item.title)) {
    titleScore = Math.max(titleScore, APPLICATION_NAME_WORD_SCORE);
  }
  const subtitleScore = fuzzyTextScore(needle, subtitle);
  const keywordScore = fuzzyTextScore(needle, keyword);
  const textScore = Math.max(
    titleScore,
    weightedScore(subtitleScore, 0.5),
    weightedScore(keywordScore, 0.25),
  );
  return textScore < 0 ? -1 : textScore + preference;
}

function weightedScore(value: number, weight: number): number {
  return value < 0 ? -1 : Math.round(value * weight);
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
