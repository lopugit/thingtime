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
      await expect(client.status()).resolves.toMatchObject({ schemaVersion: 1, totalRecords: 3 });
      await expect(client.query({ query: 'note', kinds: ['file'], limit: 10 })).resolves.toMatchObject({
        records: [{ name: 'note.txt', kind: 'file' }],
      });
    } finally {
      await client.close();
    }
  });

  it('times out a blocked index request so its process can be closed', async () => {
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
      const response = (await client.index({
        sources: [{ id: 'documents', root: '/tmp', kinds: ['file', 'directory'] }],
        resourceLimits: {
          maxThreads: 6,
          maxParallelism: 3,
          maxOpenDirectories: 9,
          maxCpuPercent: 45,
          maxMemoryMiB: 384,
        },
      })) as unknown as { configuration: Record<string, unknown> };
      expect(response.configuration).toMatchObject({
        resourceLimits: {
          maxThreads: 6,
          maxParallelism: 3,
          maxOpenDirectories: 9,
          maxCpuPercent: 45,
          maxMemoryMiB: 384,
        },
      });
    } finally {
      await client.close();
    }
  });
});
