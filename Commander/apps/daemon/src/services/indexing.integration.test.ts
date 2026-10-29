import { mkdtemp, mkdir, writeFile, rename, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { IndexingService } from './indexing.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// This acceptance test uses the real Rust process, SQLite WAL and OS watcher.
// Build commander-indexer before running the daemon tests.
describe('background filesystem inventory', () => {
  beforeAll(async () => {
    await promisify(execFile)('cargo', [
      'build',
      '--locked',
      '--manifest-path',
      '../../crates/commander-indexer/Cargo.toml',
    ]);
  }, 120_000);
  it('updates created, renamed and deleted files/folders/apps without searching initiating a scan', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'commander-watch-')));
    const root = path.join(temporary, 'files');
    await mkdir(root);
    const apps: { items: { path?: string }[] } = { items: [] };
    const service = new IndexingService({
      binaryPath: path.resolve('../../crates/commander-indexer/target/debug/commander-indexer'),
      databasePath: path.join(temporary, 'state', 'index.sqlite3'),
      applicationRoots: [root],
      platform: process.platform === 'darwin' ? 'macos' : 'linux',
      settings: {
        ...DEFAULT_SETTINGS,
        indexing: { ...DEFAULT_SETTINGS.indexing, roots: [root], refreshIntervalMinutes: 1 },
      },
      callbacks: {
        applications: (items) => {
          apps.items = items;
        },
        commands: () => 7,
      },
    });
    try {
      await service.initialize();
      await service.start('all');
      await vi.waitFor(async () => expect((await service.status()).running).toEqual([]));
      await writeFile(path.join(root, 'background-old.txt'), 'one');
      await mkdir(path.join(root, 'Background.app'));
      await mkdir(path.join(root, 'background-folder'));
      await vi.waitFor(
        async () => {
          expect((await service.queryItems('background-old')).map((item) => item.title)).toContain(
            'background-old.txt',
          );
          expect(apps.items.some((item) => item.path === path.join(root, 'Background.app'))).toBe(true);
          expect((await service.queryItems('background-folder')).map((item) => item.title)).toContain(
            'background-folder',
          );
        },
        { timeout: 10_000 },
      );
      await rename(path.join(root, 'background-old.txt'), path.join(root, 'background-new.txt'));
      await vi.waitFor(
        async () => {
          expect(
            (await service.queryItems('background-old')).some((item) => item.title === 'background-old.txt'),
          ).toBe(false);
          expect(
            (await service.queryItems('background-new')).some((item) => item.title === 'background-new.txt'),
          ).toBe(true);
        },
        { timeout: 10_000 },
      );
      await rm(path.join(root, 'background-new.txt'));
      await rm(path.join(root, 'Background.app'), { recursive: true });
      await rm(path.join(root, 'background-folder'), { recursive: true });
      await vi.waitFor(
        async () => {
          expect(await service.queryItems('background')).toEqual([]);
          expect(apps.items).toEqual([]);
          const status = await service.status();
          expect(status.searchableRecords).toBe(8); // root directory + seven commands
        },
        { timeout: 10_000 },
      );
    } finally {
      await service.close();
      await rm(temporary, { recursive: true, force: true });
    }
  }, 35_000);
});
