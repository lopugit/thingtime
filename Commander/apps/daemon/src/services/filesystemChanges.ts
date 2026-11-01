import { Worker, type WorkerOptions } from 'node:worker_threads';

export interface FileChangeBatch {
  paths: string[];
  fullReconciliation: boolean;
  volumesChanged: boolean;
}

export interface FileChangeOptions {
  roots: string[];
  filesystemRoots: string[];
  databaseDirectory: string;
  filesystemEnabled: boolean;
  recursive: boolean;
}

// Recursive FSEvents delivery can contain a very large native callback batch.
// Keep both delivery and coalescing off the daemon's HTTP/search event loop.
// This is static trusted worker code, not persisted or user-supplied code.
export const FILE_CHANGE_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { watch } = require('node:fs');
const path = require('node:path');
const pending = new Set();
const watchers = [];
const watchedRoots = [];
let quietTimer;
let deadlineTimer;
let notified = false;
let fullReconciliation = false;
let volumesChanged = false;
let firstChangeAt = 0;
const within = (candidate, root) => candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const canonical = value => {
  const resolved = path.resolve(value);
  return resolved.startsWith('/System/Volumes/Data/') ? resolved.slice('/System/Volumes/Data'.length) : resolved;
};
function notify() {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = undefined;
  if (deadlineTimer) clearTimeout(deadlineTimer);
  deadlineTimer = undefined;
  if (!notified && pending.size) { notified = true; parentPort.postMessage({ type: 'changed' }); }
}
function foldBurst() {
  // Bound metadata, not user data: widen a dense changed subtree instead of
  // dropping any event or repeatedly sorting the entire set per notification.
  const counts = new Map();
  for (const entry of pending) {
    let parent = path.dirname(entry);
    while (true) {
      counts.set(parent, (counts.get(parent) || 0) + 1);
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  const threshold = Math.ceil(pending.size / 4);
  let selected = path.parse(pending.values().next().value).root;
  for (const [parent, count] of counts) {
    if (count >= threshold && parent.length > selected.length) selected = parent;
  }
  for (const entry of pending) if (within(entry, selected)) pending.delete(entry);
  pending.add(selected);
}
function recordChange(event, filename, root) {
  let changed = canonical(filename ? path.resolve(root, filename.toString()) : root);
  // APFS Data-volume aliases must be excluded before WAL writes can feed back.
  if (within(changed, workerData.databaseDirectory)) return;
  const bundle = changed.split(path.sep).findIndex(part => part.toLowerCase().endsWith('.app'));
  if (bundle >= 0) changed = changed.split(path.sep).slice(0, bundle + 1).join(path.sep);
  const relevant = workerData.filesystemEnabled && workerData.filesystemRoots.some(entry => within(changed, entry) || within(entry, changed));
  if (!relevant && event !== 'rename' && !/(?:^|\/)(?:Applications|Volumes)(?:\/|$)|\.app(?:\/|$)/i.test(changed)) return;
  if (!filename || changed === '/Volumes' || path.dirname(changed) === '/Volumes' || /(?:^|\/)git\/ignore$/.test(changed)) {
    fullReconciliation = true;
    volumesChanged ||= changed === '/Volumes' || path.dirname(changed) === '/Volumes';
  }
  if (changed.endsWith(path.sep + '.git' + path.sep + 'info' + path.sep + 'exclude')) changed = path.resolve(changed, '../../..');
  else if (['.gitignore', '.ignore'].includes(path.basename(changed))) changed = path.dirname(changed);
  // Check covered events too: a continuous native callback burst can keep
  // worker timers from running even after its pending subtree has folded.
  if (!notified && firstChangeAt && Date.now() - firstChangeAt >= 3000) notify();
  // An existing ancestor already covers this event; this is O(path depth).
  let ancestor = changed;
  while (true) {
    if (pending.has(ancestor)) return;
    const next = path.dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  pending.add(changed);
  if (pending.size > 1024) foldBurst();
  if (notified) return; // The daemon takes this batch after its active writer.
  if (!firstChangeAt) firstChangeAt = Date.now();
  // Native FSEvents delivery itself can starve this worker's timers. Crossing
  // the deadline still notifies the HTTP thread while that delivery continues.
  if (Date.now() - firstChangeAt >= 3000) { notify(); return; }
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(notify, 750);
  if (!deadlineTimer) deadlineTimer = setTimeout(notify, 3000);
}
for (const root of workerData.roots) {
  if (workerData.recursive && watchedRoots.some(parent => within(root, parent))) continue;
  try {
    const watcher = watch(root, { persistent: false, recursive: workerData.recursive }, (event, filename) => recordChange(event, filename, root));
    watcher.on('error', () => parentPort.postMessage({ type: 'watch-error' }));
    watchers.push(watcher);
    watchedRoots.push(root);
  } catch { /* Try descendant fallback roots and retain periodic reconciliation. */ }
}
parentPort.on('message', message => {
  if (message.type !== 'take') return;
  if (quietTimer) clearTimeout(quietTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  quietTimer = deadlineTimer = undefined;
  const sorted = [...pending].sort((left, right) => left.length - right.length);
  const paths = [];
  for (const entry of sorted) if (!paths.some(parent => within(entry, parent))) paths.push(entry);
  pending.clear();
  firstChangeAt = 0;
  notified = false;
  parentPort.postMessage({ type: 'batch', paths, fullReconciliation, volumesChanged });
  fullReconciliation = volumesChanged = false;
});
`;

export class FileChangeObserver {
  readonly #worker: Worker;
  #pending: { resolve(batch: FileChangeBatch): void; reject(error: Error): void } | undefined;
  #closed = false;
  #failed = false;

  constructor(
    options: FileChangeOptions,
    changed: () => void,
    unavailable: () => void,
    createWorker: (source: string, options: WorkerOptions) => Worker = (source, options) =>
      new Worker(source, options),
  ) {
    this.#worker = createWorker(FILE_CHANGE_WORKER_SOURCE, { eval: true, workerData: options });
    this.#worker.on('message', (message: FileChangeBatch & { type: string }) => {
      if (this.#closed) return;
      if (message.type === 'changed') changed();
      else if (message.type === 'watch-error') unavailable();
      else if (message.type === 'batch') {
        const pending = this.#pending;
        this.#pending = undefined;
        pending?.resolve(message);
      }
    });
    const failed = () => {
      if (this.#closed || this.#failed) return;
      this.#failed = true;
      this.#pending?.reject(new Error('Filesystem notification worker unavailable'));
      this.#pending = undefined;
      unavailable();
    };
    this.#worker.on('error', failed);
    this.#worker.on('exit', failed);
    this.#worker.unref();
  }

  take(): Promise<FileChangeBatch> {
    if (this.#closed || this.#failed)
      return Promise.reject(new Error('Filesystem notification observer unavailable'));
    return new Promise((resolve, reject) => {
      this.#pending = { resolve, reject };
      this.#worker.postMessage({ type: 'take' });
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#pending?.reject(new Error('Filesystem notification observer closed'));
    this.#pending = undefined;
    await this.#worker.terminate();
  }
}
