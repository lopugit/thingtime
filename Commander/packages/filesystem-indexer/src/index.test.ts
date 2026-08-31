import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FileSystemIndexerClient } from './index.js';

describe('FileSystemIndexerClient', () => {
  it('correlates status and query responses from a long-lived process', async () => {
    const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-fixtures/fake-indexer.mjs');
    const client = new FileSystemIndexerClient({
      binaryPath: process.execPath,
      databasePath: '/tmp/test-index.sqlite3',
      prefixArguments: [fixture],
    });
    try {
      await expect(client.status()).resolves.toMatchObject({
        schemaVersion: 1,
        totalRecords: 3,
        databaseSizeBytes: 4_096,
      });
      await expect(client.query({ query: 'note', kinds: ['file'], limit: 10 })).resolves.toMatchObject({
        records: [{ name: 'note.txt', kind: 'file' }],
      });
    } finally {
      await client.close();
    }
  });

  it('terminates a timed-out process and restarts cleanly for the next request', async () => {
    const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-fixtures/fake-indexer.mjs');
    const client = new FileSystemIndexerClient({
      binaryPath: process.execPath,
      databasePath: '/tmp/test-index-timeout.sqlite3',
      prefixArguments: [fixture],
      indexTimeoutMs: 1_000,
    });
    try {
      await expect(
        client.index(
          {
            sources: [{ id: 'hang', root: '/tmp', kinds: ['file'] }],
          },
          20,
        ),
      ).rejects.toThrow('timed out after 20ms');
      await expect(client.status()).resolves.toMatchObject({ totalRecords: 3 });
    } finally {
      await client.close();
    }
  });

  it('coalesces overlapping index requests into one worker operation', async () => {
    const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-fixtures/fake-indexer.mjs');
    const client = new FileSystemIndexerClient({
      binaryPath: process.execPath,
      databasePath: '/tmp/test-index-single-flight.sqlite3',
      prefixArguments: [fixture],
      indexTimeoutMs: 1_000,
    });
    try {
      const configuration = { sources: [{ id: 'hang', root: '/tmp', kinds: ['file' as const] }] };
      const first = client.index(configuration, 20);
      const second = client.index(configuration, 20);
      expect(second).toBe(first);
      await expect(first).rejects.toThrow('timed out after 20ms');
    } finally {
      await client.close();
    }
  });

  it('runs the active query and only the latest queued query', async () => {
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'test-fixtures/slow-query-indexer.mjs',
    );
    const client = new FileSystemIndexerClient({
      binaryPath: process.execPath,
      databasePath: '/tmp/test-index-latest-query.sqlite3',
      prefixArguments: [fixture],
    });
    try {
      const request = (query: string) => ({ query, kinds: ['file' as const], limit: 10 });
      const active = client.query(request('active'));
      const superseded = client.query(request('superseded'));
      const latest = client.query(request('latest'));

      await expect(superseded).resolves.toEqual({ records: [] });
      await expect(active).resolves.toMatchObject({ records: [{ name: 'active.txt' }] });
      await expect(latest).resolves.toMatchObject({ records: [{ name: 'latest.txt' }] });
    } finally {
      await client.close();
    }
  });

  it('passes standalone machine resource limits through the JSON-lines protocol', async () => {
    const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-fixtures/fake-indexer.mjs');
    const client = new FileSystemIndexerClient({
      binaryPath: process.execPath,
      databasePath: '/tmp/test-index-resources.sqlite3',
      prefixArguments: [fixture],
    });
    try {
      const progress: number[] = [];
      const response = (await client.index(
        {
          sources: [{ id: 'documents', root: '/tmp', kinds: ['file', 'directory'] }],
          maxEntries: null,
          resourceLimits: {
            maxThreads: 6,
            maxParallelism: 3,
            maxOpenDirectories: 9,
            maxCpuPercent: 45,
            maxMemoryMiB: 384,
          },
        },
        undefined,
        (event) => progress.push(event.processed),
      )) as unknown as { configuration: Record<string, unknown> };
      expect(response.configuration).toMatchObject({
        maxEntries: null,
        resourceLimits: {
          maxThreads: 6,
          maxParallelism: 3,
          maxOpenDirectories: 9,
          maxCpuPercent: 45,
          maxMemoryMiB: 384,
        },
      });
      expect(progress).toEqual([12]);
    } finally {
      await client.close();
    }
  });
});
