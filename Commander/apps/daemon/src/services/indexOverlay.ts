import { opendir } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { fuzzyTextScore } from '@commander/protocol';
import type { IndexConfiguration, IndexRecord } from '@commander/filesystem-indexer';

export interface PathObservation {
  path: string;
  record?: IndexRecord;
  descend?: boolean;
}
export interface PersistentPathState {
  path: string;
  records: IndexRecord[];
  hasDescendants: boolean;
}
type Observe = (
  configuration: IndexConfiguration,
  paths: string[],
) => Promise<{ observations: PathObservation[] }>;
type Readback = (paths: string[]) => Promise<{ entries: PersistentPathState[] }>;
interface Entry {
  record?: IndexRecord;
  epoch: number;
}
const BATCH_SIZE = 128; // Work page only; no searchable-item ceiling.
const canonicalPath = (candidate: string) =>
  candidate.startsWith('/System/Volumes/Data/') ? candidate.slice('/System/Volumes/Data'.length) : candidate;
const within = (candidate: string, root: string) =>
  candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);

/** Live eligible metadata while the canonical writer finishes its snapshot. */
export class IndexOverlay {
  readonly #observe: (
    configuration: IndexConfiguration,
    paths: string[],
  ) => Promise<{ observations: PathObservation[] }>;
  readonly #readback: (paths: string[]) => Promise<{ entries: PersistentPathState[] }>;
  readonly #changed: () => void;
  readonly #openDirectory: typeof opendir;
  readonly #excludedDirectories: string[];
  #activeDirectories = new Map<string, number>();
  #subtreeEpoch = new Map<string, number>();
  #configuration: IndexConfiguration | undefined;
  #rescanDirectories = new Set<string>();
  #entries = new Map<string, Entry>();
  #applications = new Map<string, IndexRecord>();
  #generation = 0;
  #epoch = 0;
  #jobs = 0;

  constructor(
    observe: Observe,
    readback: Readback,
    changed: () => void,
    options: { openDirectory?: typeof opendir; excludedDirectories?: string[] } = {},
  ) {
    this.#openDirectory = options.openDirectory ?? opendir;
    this.#excludedDirectories = (options.excludedDirectories ?? []).map(canonicalPath);
    this.#observe = observe;
    this.#readback = readback;
    this.#changed = changed;
  }

  get pending(): boolean {
    return this.#jobs > 0 || this.#entries.size > 0;
  }

  clear(): void {
    this.#generation++;
    this.#entries.clear();
    this.#applications.clear();
    this.#subtreeEpoch.clear();
    this.#activeDirectories.clear();
    this.#rescanDirectories.clear();
    this.#changed();
  }

  apply(configuration: IndexConfiguration, paths: string[]): Promise<void> {
    const generation = this.#generation;
    this.#configuration = configuration;
    this.#jobs++;
    // Each new exact-path batch starts immediately. A long descendant walk
    // yields in bounded pages and never owns the queue ahead of later events.
    return this.#scan(configuration, paths, generation).finally(() => {
      this.#jobs--;
    });
  }

  masks(candidate: string): boolean {
    let ancestor = candidate;
    while (true) {
      const entry = this.#entries.get(ancestor);
      if ((ancestor === candidate && entry) || (entry && !entry.record)) return true;
      const next = path.dirname(ancestor);
      if (next === ancestor) return false;
      ancestor = next;
    }
  }

  #deleted(candidate: string): boolean {
    const liveEpoch = this.#entries.get(candidate)?.epoch ?? 0;
    let ancestor = candidate;
    while (true) {
      const entry = this.#entries.get(ancestor);
      if (entry && !entry.record && entry.epoch >= liveEpoch) return true;
      const next = path.dirname(ancestor);
      if (next === ancestor) return false;
      ancestor = next;
    }
  }

  resolve(candidate: string): IndexRecord | null | undefined {
    const entry = this.#entries.get(candidate);
    if (entry) return entry.record ?? null;
    if (this.masks(candidate)) return null;
    return undefined;
  }

  applications(): IndexRecord[] {
    return [...this.#applications.values()].filter((record) => !this.#deleted(record.path));
  }

  #markEpoch(candidate: string, epoch: number): void {
    let ancestor = candidate;
    while (true) {
      this.#subtreeEpoch.set(ancestor, Math.max(epoch, this.#subtreeEpoch.get(ancestor) ?? 0));
      const next = path.dirname(ancestor);
      if (next === ancestor) return;
      ancestor = next;
    }
  }

  #superseded(candidate: string, epoch: number): boolean {
    let ancestor = candidate;
    while (true) {
      const entry = this.#entries.get(ancestor);
      if (entry && entry.epoch > epoch && (ancestor === candidate || !entry.record)) return true;
      const next = path.dirname(ancestor);
      if (next === ancestor) return false;
      ancestor = next;
    }
  }

  async query(query: string, limit: number): Promise<IndexRecord[]> {
    const generation = this.#generation;
    const found: IndexRecord[] = [];
    let visited = 0;
    for (const entry of this.#entries.values()) {
      const record = entry.record;
      if (record && record.kind !== 'application' && !this.#deleted(record.path)) {
        const score = Math.max(
          fuzzyTextScore(query, record.name),
          record.path.toLowerCase().includes(query.toLowerCase()) ? 1 : 0,
        );
        if (score > 0) found.push({ ...record, score });
      }
      if (++visited % BATCH_SIZE === 0) {
        found.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
        found.splice(limit);
        await yieldToLoop();
        if (generation !== this.#generation) return [];
      }
    }
    return found
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, limit);
  }

  async #scan(configuration: IndexConfiguration, paths: string[], generation: number): Promise<void> {
    if (generation !== this.#generation) return;
    const epoch = ++this.#epoch;
    const directories: string[] = [];
    const completeTrees: string[] = [];
    const unavailableTrees: string[] = [];

    const observe = async (batch: string[], roots = false) => {
      if (generation !== this.#generation) return;
      const eligibleBatch = batch
        .map(canonicalPath)
        .filter(
          (candidate) =>
            candidate !== '/System/Volumes/Data' &&
            !this.#excludedDirectories.some((root) => within(candidate, root)),
        );
      if (!eligibleBatch.length) return;
      const response = await this.#observe(configuration, eligibleBatch);
      if (generation !== this.#generation) return;
      // A broad parent event must not retain the unchanged multi-million-row
      // inventory in RAM. Already-committed metadata needs no transient copy.
      const existing = await this.#readback(response.observations.map((observation) => observation.path));
      if (generation !== this.#generation) return;
      const committed = new Map(existing.entries.map((entry) => [entry.path, entry]));
      for (const observation of response.observations) {
        if (
          this.#superseded(observation.path, epoch) ||
          (!observation.record &&
            !observation.descend &&
            (this.#subtreeEpoch.get(observation.path) ?? 0) > epoch)
        )
          continue;
        if (!observation.record && observation.descend) {
          // An eligible existing app-only container is not a tombstone. A
          // recreated parent must stop hiding its freshly observed children.
          this.#entries.delete(observation.path);
          this.#markEpoch(observation.path, epoch);
        }
        const alreadyCommitted =
          observation.record &&
          observation.record.kind !== 'application' &&
          !this.#entries.has(observation.path) &&
          committed.get(observation.path)?.records.some((record) => sameRecord(record, observation.record!));
        if (!alreadyCommitted && (observation.record || !observation.descend)) {
          this.#markEpoch(observation.path, epoch);
          this.#entries.set(observation.path, {
            ...(observation.record ? { record: observation.record } : {}),
            epoch,
          });
          if (observation.record?.kind === 'application')
            this.#applications.set(observation.path, observation.record);
          else this.#applications.delete(observation.path);
          if (!observation.record && !observation.descend) {
            // One removed parent supersedes every older live child beneath it.
            // Keep its prefix tombstone until persistent readback is empty.
            let checked = 0;
            for (const child of this.#entries.keys()) {
              if (generation !== this.#generation) return;
              if (
                child !== observation.path &&
                (this.#entries.get(child)?.epoch ?? 0) <= epoch &&
                within(child, observation.path)
              ) {
                this.#entries.delete(child);
                this.#applications.delete(child);
              }
              if (++checked % BATCH_SIZE === 0) {
                await yieldToLoop();
                if (generation !== this.#generation) return;
              }
            }
          }
        }
        if (observation.descend) {
          directories.push(observation.path);
          if (roots) completeTrees.push(observation.path);
        }
      }
      this.#changed();
      await yieldToLoop();
    };
    for (let offset = 0; offset < paths.length; offset += BATCH_SIZE)
      await observe(paths.slice(offset, offset + BATCH_SIZE), true);
    // One directory handle at a time; Rust's metadata eligibility decides which
    // containers may be entered, including opaque/dataless/symlink boundaries.
    for (let offset = 0; offset < directories.length && generation === this.#generation; offset++) {
      const directory = directories[offset]!;
      directories[offset] = '';
      if (this.#activeDirectories.has(directory)) {
        this.#rescanDirectories.add(directory);
        unavailableTrees.push(directory); // no enumeration in this job, so no absence inference
        continue;
      }
      this.#activeDirectories.set(directory, epoch);
      const handle = await this.#openDirectory(directory).catch(() => undefined);
      if (!handle) {
        unavailableTrees.push(directory);
        if (this.#activeDirectories.get(directory) === epoch) {
          this.#activeDirectories.delete(directory);
          this.#rescanDirectories.delete(directory);
        }
        continue;
      }
      let batch: string[] = [];
      try {
        for await (const entry of handle) {
          if (generation !== this.#generation) break;
          const rawPath = path.join(directory, entry.name);
          if (rawPath === '/System/Volumes/Data') continue;
          const childPath = canonicalPath(rawPath);
          if (this.#excludedDirectories.some((root) => within(childPath, root))) continue;
          batch.push(childPath);
          if (batch.length >= BATCH_SIZE) {
            await observe(batch);
            batch = [];
          }
        }
      } catch {
        // Failure to enumerate is unavailable, never proof of child deletion.
        unavailableTrees.push(directory);
      }
      if (batch.length) await observe(batch);
      if (this.#activeDirectories.get(directory) === epoch) this.#activeDirectories.delete(directory);
      if (
        generation === this.#generation &&
        this.#rescanDirectories.delete(directory) &&
        generation === this.#generation &&
        !unavailableTrees.includes(directory)
      )
        directories.push(directory);
    }
    if (generation !== this.#generation) return;
    let visited = 0;
    for (const [itemPath, entry] of this.#entries) {
      if (generation !== this.#generation) return;
      if (
        entry.epoch < epoch &&
        completeTrees.some((root) => within(itemPath, root)) &&
        !unavailableTrees.some((root) => within(itemPath, root))
      ) {
        this.#entries.set(itemPath, { epoch });
        this.#applications.delete(itemPath);
      }
      if (++visited % BATCH_SIZE === 0) {
        await yieldToLoop();
        if (generation !== this.#generation) return;
      }
    }
    this.#changed();
  }

  /** Called only when the canonical writer and observation queue are idle. */
  async retireAfterReadback(): Promise<boolean> {
    if (this.#jobs || !this.pending) return false;
    const generation = this.#generation;
    const epoch = this.#epoch;
    const entries = [...this.#entries];
    for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
      const batch = entries.slice(offset, offset + BATCH_SIZE);
      const paths = batch.map(([itemPath]) => itemPath);
      const current = this.#configuration
        ? await this.#observe(this.#configuration, paths)
        : { observations: [] };
      const response = await this.#readback(paths);
      if (generation !== this.#generation || epoch !== this.#epoch || this.#jobs) return false;
      const persisted = new Map(response.entries.map((entry) => [entry.path, entry]));
      const observed = new Map(current.observations.map((observation) => [observation.path, observation]));
      for (const [itemPath, expected] of batch) {
        const actual = persisted.get(itemPath);
        if (!actual) return false;
        const currentRecord = observed.get(itemPath)?.record;
        if (!currentRecord) {
          const container = observed.get(itemPath)?.descend === true;
          if (actual.records.length || (!container && actual.hasDescendants)) return false;
        } else if (!actual.records.some((record) => sameRecord(record, currentRecord))) return false;
      }
      await yieldToLoop();
    }
    if (generation !== this.#generation || epoch !== this.#epoch || this.#jobs) return false;
    this.#entries.clear();
    this.#applications.clear();
    this.#subtreeEpoch.clear();
    this.#changed();
    return true;
  }
}

function sameRecord(left: IndexRecord, right: IndexRecord): boolean {
  return (
    left.path === right.path &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.modifiedAtMs === right.modifiedAtMs &&
    left.size === right.size
  );
}
