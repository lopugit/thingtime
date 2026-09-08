import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import type { IndexRecord, QueryRequest } from '@commander/filesystem-indexer';
import {
  decodeIndexedItemId,
  indexedItemId,
  indexRecordToSearchItem,
  indexTimeoutMs,
  IndexingService,
} from './indexing.js';

const { queryIndex, readCatalogue, readStatus, writeIndex, quickApps } = vi.hoisted(() => ({
  queryIndex: vi.fn(),
  readCatalogue: vi.fn(),
  readStatus: vi.fn(),
  writeIndex: vi.fn(),
  quickApps: vi.fn(),
}));
vi.mock('@commander/filesystem-indexer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@commander/filesystem-indexer')>()),
  FileSystemIndexerClient: class {
    query = queryIndex;
    catalogue = readCatalogue;
    status = readStatus;
    index = writeIndex;
    close = vi.fn(async () => undefined);
  },
}));
vi.mock('./applications.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./applications.js')>()),
  discoverApplicationsQuick: quickApps,
}));
afterEach(() => vi.clearAllMocks());

describe('application candidate coverage', () => {
  const record = (name: string, kind: IndexRecord['kind']): IndexRecord => ({
    name,
    kind,
    path: `/test/${name}`,
    parent: '/test',
    score: 0,
  });

  it('reads ranked file pages without rescanning or imposing another result cap', async () => {
    queryIndex.mockImplementation(async ({ limit }: QueryRequest) => ({
      records: Array.from({ length: limit! }, (_, index) => record(`Recovery-${index}`, 'file')),
    }));
    const service = new IndexingService({
      binaryPath: '/mock/indexer',
      platform: 'linux',
      settings: DEFAULT_SETTINGS,
      callbacks: { applications: vi.fn(), commands: () => 0 },
    });
    try {
      const items = await service.queryItems('recovery');
      expect(items).toHaveLength(160);
      expect(queryIndex).toHaveBeenCalledWith({
        query: 'recovery',
        kinds: ['file', 'directory'],
        limit: 160,
      });
      expect(await service.queryItems('magician', 1501)).toHaveLength(1501);
      await service.queryItems('recovery');
      expect(writeIndex).not.toHaveBeenCalled();
      expect(quickApps).not.toHaveBeenCalled();
      expect(readCatalogue).not.toHaveBeenCalled();
    } finally {
      await service.close();
    }
  });

  it('keeps the complete application catalogue after every completed scan', async () => {
    const installed = {
      ...indexRecordToSearchItem(record('Thingtime Recovery.app', 'application')),
      id: 'app:recovery',
    };
    quickApps.mockResolvedValue([installed]);
    readCatalogue.mockResolvedValue({
      records: Array.from({ length: 1501 }, (_, index) => record(`Helper-${index}.app`, 'application')),
    });
    writeIndex.mockResolvedValue({
      durationMs: 1,
      resources: {},
      status: { schemaVersion: 1, totalRecords: 5000, kinds: [] },
    });
    const applications = vi.fn();
    const service = new IndexingService({
      binaryPath: '/mock/indexer',
      platform: 'linux',
      settings: DEFAULT_SETTINGS,
      callbacks: { applications, commands: () => 0 },
    });
    try {
      await service.start('applications');
      expect(applications).toHaveBeenLastCalledWith(expect.arrayContaining([installed]));
      expect(applications.mock.lastCall![0]).toHaveLength(1502);
      expect(readCatalogue).toHaveBeenCalledWith(['application']);
      await vi.waitFor(async () => expect((await service.status()).running).toEqual([]));
      // Refresh discovery as well: do not preserve an uninstalled app forever.
      quickApps.mockResolvedValue([]);
      await service.start('applications');
      expect(applications.mock.lastCall![0]).toHaveLength(1501);
    } finally {
      await service.close();
    }
  });

  it('loads a fresh saved catalogue on launch without starting indexing', async () => {
    readCatalogue.mockResolvedValue({ records: [record('Thingtime Recovery', 'application')] });
    quickApps.mockResolvedValue([]);
    readStatus.mockResolvedValue({
      schemaVersion: 3,
      totalRecords: 4503,
      kinds: ['application', 'file', 'directory'].map((kind) => ({
        kind, count: 1501, lastIndexedAtMs: Date.now(),
      })),
    });
    const service = new IndexingService({
      binaryPath: '/mock/indexer', platform: 'linux', settings: DEFAULT_SETTINGS,
      callbacks: { applications: vi.fn(), commands: () => 0 },
    });
    try {
      expect(await service.initialize()).toEqual([
        expect.objectContaining({ title: 'Thingtime Recovery' }),
      ]);
      await vi.waitFor(() => expect(readStatus).toHaveBeenCalledTimes(2));
      expect(writeIndex).not.toHaveBeenCalled();
      expect((await service.status()).running).toEqual([]);
    } finally {
      await service.close();
    }
  });
});

describe('filesystem index search item bridge', () => {
  it('maps a persistent file record to native open, reveal, copy, icon, and drag metadata', () => {
    const item = indexRecordToSearchItem({
      path: '/Users/test/Documents/report.pdf',
      name: 'report.pdf',
      parent: '/Users/test/Documents',
      kind: 'file',
      size: 42,
      score: 60_000,
    });
    expect(item).toMatchObject({
      title: 'report.pdf',
      subtitle: '/Users/test/Documents/report.pdf',
      kind: 'file',
      icon: 'file',
      path: '/Users/test/Documents/report.pdf',
      actions: [
        { id: 'open', title: 'Open', shortcut: '↵' },
        { id: 'show-in-finder', title: 'Show in Finder', shortcut: '⇧⌘R' },
        { id: 'copy-file', title: 'Copy', shortcut: '⌘C' },
        { id: 'copy-path', title: 'Copy Path', shortcut: '⇧⌘C' },
        { id: 'copy-name', title: 'Copy Name' },
        { id: 'move-to-trash', title: 'Move to Trash', shortcut: '⌘⌫', destructive: true },
        {
          id: 'delete',
          title: 'Delete Immediately…',
          shortcut: '⌥⌘⌫',
          destructive: true,
        },
      ],
    });
    expect(decodeIndexedItemId(item.id)).toEqual({
      kind: 'file',
      path: '/Users/test/Documents/report.pdf',
    });
  });

  it('uses a stable opaque ID and rejects malformed or relative paths', () => {
    expect(indexedItemId('directory', '/Users/test/Documents')).toBe(
      indexedItemId('directory', '/Users/test/Documents'),
    );
    expect(decodeIndexedItemId('index:file:bm90LXJlYWxseS1hYnNvbHV0ZQ')).toBeUndefined();
    expect(decodeIndexedItemId('index:unknown:abcd')).toBeUndefined();
  });
});

describe('filesystem index resource scheduling', () => {
  it('extends the isolated writer timeout for deliberately CPU-constrained scans', () => {
    expect(indexTimeoutMs(100)).toBe(90_000);
    expect(indexTimeoutMs(60)).toBe(90_000);
    expect(indexTimeoutMs(20)).toBe(112_500);
    expect(indexTimeoutMs(5)).toBe(450_000);
  });

  it('allows an unlimited whole-home scan to run for the full bounded indexing window', () => {
    expect(indexTimeoutMs(100, true)).toBe(15 * 60_000);
    expect(indexTimeoutMs(5, true)).toBe(15 * 60_000);
  });
});
