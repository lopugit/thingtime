import { createHash } from 'node:crypto';
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

const { queryIndex, readCatalogue, readStatus, writeIndex, quickApps, readPolicy } = vi.hoisted(() => ({
  queryIndex: vi.fn(),
  readCatalogue: vi.fn(),
  readStatus: vi.fn(),
  writeIndex: vi.fn(),
  quickApps: vi.fn(),
  readPolicy: vi.fn(async () => undefined),
}));
vi.mock('@commander/filesystem-indexer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@commander/filesystem-indexer')>()),
  FileSystemIndexerClient: class {
    query = queryIndex;
    catalogue = readCatalogue;
    status = readStatus;
    readPolicy = readPolicy;
    index = writeIndex;
    close = vi.fn(async () => undefined);
  },
}));
vi.mock('./applications.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./applications.js')>()),
  discoverApplicationsQuick: quickApps,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

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
      expect(readCatalogue).toHaveBeenCalledWith(['application'], 'applications:', ['applications:/']);
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
      schemaVersion: 4,
      configurationFingerprints: {
        'filesystem:': createHash('sha256')
          .update(JSON.stringify({ settings: DEFAULT_SETTINGS.indexing, roots: ['/'] }))
          .digest('hex'),
      },
      totalRecords: 4503,
      kinds: ['application', 'file', 'directory'].map((kind) => ({
        kind,
        count: 1501,
        lastIndexedAtMs: Date.now(),
      })),
    });
    const service = new IndexingService({
      binaryPath: '/mock/indexer',
      platform: 'linux',
      settings: DEFAULT_SETTINGS,
      callbacks: { applications: vi.fn(), commands: () => 0 },
    });
    try {
      expect(await service.initialize()).toEqual([expect.objectContaining({ title: 'Thingtime Recovery' })]);
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

describe('background scheduling and active search totals', () => {
  const current = () => ({
    schemaVersion: 4,
    totalRecords: 10,
    databaseSizeBytes: 1024,
    configurationFingerprints: {
      'filesystem:': createHash('sha256')
        .update(JSON.stringify({ settings: DEFAULT_SETTINGS.indexing, roots: ['/'] }))
        .digest('hex'),
    },
    kinds: [
      { kind: 'application', count: 2, lastIndexedAtMs: Date.now() },
      { kind: 'file', count: 5, lastIndexedAtMs: Date.now() },
      { kind: 'directory', count: 3, lastIndexedAtMs: Date.now() },
    ],
  });

  it('counts actual catalogue apps and enabled commands, then immediately excludes disabled files', async () => {
    quickApps.mockResolvedValue([{ id: 'app:one', kind: 'application', path: '/test/one.app' }]);
    readCatalogue.mockResolvedValue({ records: [] });
    readStatus.mockImplementation(async () => current());
    writeIndex.mockResolvedValue({
      durationMs: 1,
      completedAtMs: Date.now(),
      resources: {},
      status: current(),
    });
    const service = new IndexingService({
      binaryPath: '/mock/indexer',
      platform: 'linux',
      settings: DEFAULT_SETTINGS,
      callbacks: { applications: vi.fn(), commands: () => 4 },
    });
    try {
      await service.initialize();
      expect((await service.status()).searchableRecords).toBe(13); // one actual app, four commands, eight files/folders
      service.updateSettings({
        ...DEFAULT_SETTINGS,
        indexing: { ...DEFAULT_SETTINGS.indexing, enabled: false },
      });
      expect((await service.status()).searchableRecords).toBe(5);
      expect(await service.queryItems('anything')).toEqual([]);
      expect(await service.resolveItem(indexedItemId('file', '/test/old.txt'))).toBeUndefined();
    } finally {
      await service.close();
    }
  });

  it('reconciles due indexes in the background while queries use the independent reader', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    quickApps.mockResolvedValue([]);
    readCatalogue.mockResolvedValue({ records: [] });
    const saved = current();
    saved.kinds = saved.kinds.map((kind) => ({
      ...kind,
      lastIndexedAtMs: Date.now() - 6 * 60 * 60_000 + 30_000,
    }));
    readStatus.mockResolvedValue(saved);
    let finish!: (report: unknown) => void;
    writeIndex.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    queryIndex.mockResolvedValue({ records: [] });
    const service = new IndexingService({
      binaryPath: '/mock/indexer',
      platform: 'linux',
      settings: DEFAULT_SETTINGS,
      callbacks: { applications: vi.fn(), commands: () => 4 },
    });
    try {
      await service.initialize();
      expect(writeIndex).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      vi.useRealTimers();
      await vi.waitFor(() => expect(writeIndex).toHaveBeenCalledTimes(1));
      await expect(service.queryItems('still-searchable')).resolves.toEqual([]);
      expect((await service.status()).running).not.toEqual([]);
      finish({ durationMs: 1, completedAtMs: Date.now(), resources: {}, status: current() });
    } finally {
      await service.close();
    }
  });
});

describe('legacy snapshot adoption', () => {
  it('keeps filtered old files searchable without presenting unverified totals during the background refresh', async () => {
    readStatus.mockResolvedValue({
      schemaVersion: 3,
      totalRecords: 4_300_000,
      databaseSizeBytes: 100,
      kinds: [],
    });
    readCatalogue.mockResolvedValue({ records: [] });
    quickApps.mockResolvedValue([]);
    writeIndex.mockImplementation(() => new Promise(() => undefined));
    queryIndex.mockResolvedValue({ records: [] });
    const service = new IndexingService({
      binaryPath: '/mock/indexer',
      platform: 'linux',
      settings: DEFAULT_SETTINGS,
      callbacks: { applications: vi.fn(), commands: () => 4 },
    });
    try {
      await service.initialize();
      expect(readPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: [expect.objectContaining({ id: 'filesystem:/', root: '/' })],
          customIgnores: DEFAULT_SETTINGS.indexing.customIgnores,
        }),
      );
      await service.queryItems('old-valid-file');
      expect(queryIndex).toHaveBeenCalledWith(expect.objectContaining({ query: 'old-valid-file' }));
      const status = await service.status();
      expect(status.countsCurrent).toBe(false);
      expect(status.searchableRecords).toBeUndefined();
    } finally {
      await service.close();
    }
  });

  it('never re-adopts a snapshot with a known mismatched settings fingerprint', async () => {
    readStatus.mockResolvedValue({
      schemaVersion: 4,
      totalRecords: 10,
      databaseSizeBytes: 100,
      configurationFingerprints: { 'filesystem:': 'known-old-settings' },
      kinds: [],
    });
    readCatalogue.mockResolvedValue({ records: [] });
    quickApps.mockResolvedValue([]);
    writeIndex.mockImplementation(() => new Promise(() => undefined));
    const service = new IndexingService({
      binaryPath: '/mock/indexer',
      platform: 'linux',
      settings: DEFAULT_SETTINGS,
      callbacks: { applications: vi.fn(), commands: () => 4 },
    });
    try {
      await service.initialize();
      expect(readPolicy).not.toHaveBeenCalled();
      expect(await service.queryItems('old-root-file')).toEqual([]);
      expect(queryIndex).not.toHaveBeenCalled();
    } finally {
      await service.close();
    }
  });
});
