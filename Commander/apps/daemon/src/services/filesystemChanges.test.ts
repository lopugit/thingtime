import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { FILE_CHANGE_WORKER_SOURCE, FileChangeObserver } from './filesystemChanges.js';

const options = {
  roots: [],
  filesystemRoots: ['/fixture'],
  databaseDirectory: '/fixture/state',
  filesystemEnabled: true,
  recursive: true,
};
const within = (candidate: string, root: string) => candidate === root || candidate.startsWith(`${root}/`);

function message(worker: Worker, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const received = (value: { type: string }) => {
      if (value.type !== type) return;
      worker.off('message', received);
      worker.off('error', reject);
      resolve(value);
    };
    worker.on('message', received);
    worker.once('error', reject);
  });
}

describe('background filesystem notification delivery', () => {
  it('keeps HTTP responsive during a 250,000-event native-style callback burst and preserves affected subtrees', async () => {
    const server = createServer((_request, response) => response.end('healthy'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected loopback server');
    const worker = new Worker(
      `${FILE_CHANGE_WORKER_SOURCE}
      parentPort.on('message', message => {
        if (message.type !== 'burst') return;
        parentPort.postMessage({type:'started'});
        for (let index = 0; index < 250000; index++) {
          recordChange('rename', '/fixture/cache/group-' + Math.floor(index / 256) + '/file-' + index + '.txt', '/');
          recordChange('change', '/System/Volumes/Data/fixture/state/index.sqlite3-wal', '/');
        }
        parentPort.postMessage({type:'done'});
      });`,
      { eval: true, workerData: options },
    );
    try {
      const started = message(worker, 'started');
      const done = message(worker, 'done');
      let finished = false;
      void done.then(() => {
        finished = true;
      });
      worker.postMessage({ type: 'burst' });
      await started;
      const latencies: number[] = [];
      let overlapping = 0;
      for (let count = 0; count < 30; count++) {
        const before = performance.now();
        const response = await fetch(`http://127.0.0.1:${address.port}/healthz`, {
          signal: AbortSignal.timeout(1000),
        });
        expect(await response.text()).toBe('healthy');
        latencies.push(performance.now() - before);
        if (!finished) overlapping++;
      }
      expect(overlapping).toBeGreaterThan(0);
      expect(Math.max(...latencies)).toBeLessThan(500);
      console.info('Filesystem event-storm health measurements', {
        events: 250_000,
        requests: latencies.length,
        overlapping,
        maximumLatencyMs: Math.round(Math.max(...latencies) * 100) / 100,
      });
      await done;
      const batchPromise = message(worker, 'batch');
      worker.postMessage({ type: 'take' });
      const batch = await batchPromise;
      const paths = batch.paths as string[];
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.length).toBeLessThanOrEqual(1024);
      for (const index of [0, 100_000, 249_999]) {
        const candidate = `/fixture/cache/group-${Math.floor(index / 256)}/file-${index}.txt`;
        expect(paths.some((root) => within(candidate, root))).toBe(true);
      }
      expect(paths.some((root) => within('/fixture/state/index.sqlite3-wal', root))).toBe(false);
    } finally {
      await worker.terminate();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 15_000);

  it('notifies by the deadline when every subsequent event is already covered and timers cannot run', async () => {
    const worker = new Worker(
      `${FILE_CHANGE_WORKER_SOURCE}
      let clock = 1000;
      Date.now = () => clock;
      recordChange('rename', '/fixture/cache/same.txt', '/');
      clock += 3001;
      for (let index = 0; index < 1000; index++) recordChange('rename', '/fixture/cache/same.txt', '/');
      parentPort.postMessage({type:'done'});`,
      { eval: true, workerData: options },
    );
    const sequence: string[] = [];
    worker.on('message', (value: { type: string }) => sequence.push(value.type));
    try {
      await message(worker, 'done');
      expect(sequence).toEqual(['changed', 'done']);
    } finally {
      await worker.terminate();
    }
  });

  it('excludes both public and Data-volume database aliases before they can schedule more indexing', async () => {
    const worker = new Worker(
      `${FILE_CHANGE_WORKER_SOURCE}
      recordChange('change', '/fixture/state/index.sqlite3', '/');
      recordChange('change', '/System/Volumes/Data/fixture/state/index.sqlite3-wal', '/');
      recordChange('change', '/System/Volumes/Data/fixture/state/index.sqlite3-shm', '/');
      parentPort.postMessage({type:'done'});`,
      { eval: true, workerData: options },
    );
    try {
      await message(worker, 'done');
      const batchPromise = message(worker, 'batch');
      worker.postMessage({ type: 'take' });
      expect((await batchPromise).paths).toEqual([]);
    } finally {
      await worker.terminate();
    }
  });

  it('contains a worker failure, rejects pending/future batches and never enters a restart loop', async () => {
    let starts = 0;
    const unavailable = vi.fn();
    const observer = new FileChangeObserver(
      options,
      () => undefined,
      unavailable,
      (source, workerOptions) => {
        starts++;
        return new Worker(`${source}\nthrow new Error('synthetic worker failure');`, workerOptions);
      },
    );
    try {
      await vi.waitFor(() => expect(unavailable).toHaveBeenCalledTimes(1));
      await expect(observer.take()).rejects.toThrow('unavailable');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(starts).toBe(1);
      expect(unavailable).toHaveBeenCalledTimes(1);
    } finally {
      await observer.close();
    }
  });
});
