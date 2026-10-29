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

  it.skipIf(process.platform === 'win32')(
    'retains measured counts through live file, child directory and app events while the full writer is stopped',
    async () => {
      const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'commander-held-writer-')));
      const root = path.join(temporary, 'files');
      await mkdir(root);
      for (let offset = 0; offset < 4000; offset += 128) {
        await Promise.all(
          Array.from({ length: Math.min(128, 4000 - offset) }, (_, index) =>
            writeFile(path.join(root, `baseline-${offset + index}.txt`), 'baseline'),
          ),
        );
      }
      await writeFile(path.join(root, 'baseline-anchor.txt'), 'keep visible');
      const databasePath = path.join(temporary, 'state', 'index.sqlite3');
      const binaryPath = path.resolve('../../crates/commander-indexer/target/debug/commander-indexer');
      const apps: { items: { path?: string }[] } = { items: [] };
      let armed = false;
      let stopped = false;
      let writerPid = 0;
      let held!: () => void;
      const heldPromise = new Promise<void>((resolve) => {
        held = resolve;
      });
      const service = new IndexingService({
        binaryPath,
        databasePath,
        applicationRoots: [root],
        platform: process.platform === 'darwin' ? 'macos' : 'linux',
        settings: { ...DEFAULT_SETTINGS, indexing: { ...DEFAULT_SETTINGS.indexing, roots: [root] } },
        callbacks: {
          applications: (items) => {
            apps.items = items;
          },
          commands: () => 7,
        },
        onProgress(progress) {
          if (!armed || stopped || !progress.sourceId.startsWith('filesystem:')) return;
          process.kill(writerPid, 'SIGSTOP');
          stopped = true;
          held();
        },
      });
      const measurements: Record<string, number> = {};
      try {
        await service.initialize();
        await service.start('all');
        await vi.waitFor(async () => expect((await service.status()).running).toEqual([]), {
          timeout: 10_000,
        });
        const snapshot = await service.status();
        expect(snapshot.countsCurrent).toBe(true);
        expect(snapshot.searchableRecords).toBeDefined();
        const { stdout: childIds } = await promisify(execFile)('/usr/bin/pgrep', ['-P', String(process.pid)]);
        const ownedPids = childIds.trim().split(/\s+/u).filter(Boolean);
        const { stdout: commands } = await promisify(execFile)('/bin/ps', [
          '-p',
          ownedPids.join(','),
          '-o',
          'pid=,command=',
        ]);
        const writer = commands
          .split('\n')
          .find(
            (line) => line.includes(binaryPath) && line.includes(databasePath) && !line.includes('--reader'),
          );
        if (!writer) throw new Error('Task-owned writer not found');
        writerPid = Number(writer.trim().split(/\s+/u)[0]);
        armed = true;
        const fullRun = service.start('all');
        await Promise.race([
          heldPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Writer did not enter filesystem transaction')), 10_000),
          ),
        ]);
        expect((await service.status()).running).toContain('all');
        const visible = async (query: string, title: string) =>
          (await service.queryItems(query)).some((item) => item.title === title);
        const observe = async (label: string, check: () => Promise<boolean>) => {
          const start = performance.now();
          await vi.waitFor(async () => expect(await check()).toBe(true), { timeout: 5000, interval: 40 });
          measurements[label] = Math.round(performance.now() - start);
          expect(stopped).toBe(true); // visibility cannot come from the held writer
          // Every notification remains uncommitted while the same full writer
          // is held. Repeated live changes must never erase this valid snapshot.
          const status = await service.status();
          expect(status.countsCurrent).toBe(true);
          expect(status.lastIndexedAtMs).toBeDefined();
          for (const kind of ['file', 'directory']) {
            expect(status.kinds.find((entry) => entry.kind === kind)).toEqual(
              snapshot.kinds.find((entry) => entry.kind === kind),
            );
          }
          expect(status.searchableRecords).toBe(
            snapshot.kinds.filter((entry) => entry.kind !== 'application').reduce((total, entry) => total + entry.count, 0)
              + apps.items.length + 7,
          );
        };
        await writeFile(path.join(root, 'live-created.txt'), 'new');
        await observe('fileCreateMs', () => visible('live-created', 'live-created.txt'));
        expect(await visible('baseline-anchor', 'baseline-anchor.txt')).toBe(true);
        await rename(path.join(root, 'live-created.txt'), path.join(root, 'live-renamed.txt'));
        await observe(
          'fileRenameMs',
          async () =>
            (await visible('live-renamed', 'live-renamed.txt')) &&
            !(await visible('live-created', 'live-created.txt')),
        );
        await mkdir(path.join(root, 'live-directory'));
        await writeFile(path.join(root, 'live-directory', 'live-child.txt'), 'child');
        await observe('childCreateMs', () => visible('live-child', 'live-child.txt'));
        await rename(path.join(root, 'live-directory'), path.join(root, 'live-directory-renamed'));
        await observe('directoryRenameMs', async () =>
          (await service.queryItems('live-child')).some(
            (item) => item.path === path.join(root, 'live-directory-renamed', 'live-child.txt'),
          ),
        );
        expect(
          (await service.queryItems('live-child')).some(
            (item) => item.path === path.join(root, 'live-directory', 'live-child.txt'),
          ),
        ).toBe(false);
        await mkdir(path.join(root, 'LiveOverlay.app'));
        await observe('appCreateMs', async () =>
          apps.items.some((item) => item.path === path.join(root, 'LiveOverlay.app')),
        );
        await rename(path.join(root, 'LiveOverlay.app'), path.join(root, 'LiveOverlayRenamed.app'));
        await observe(
          'appRenameMs',
          async () =>
            apps.items.some((item) => item.path === path.join(root, 'LiveOverlayRenamed.app')) &&
            !apps.items.some((item) => item.path === path.join(root, 'LiveOverlay.app')),
        );
        await rm(path.join(root, 'live-renamed.txt'));
        await rm(path.join(root, 'live-directory-renamed'), { recursive: true });
        await rm(path.join(root, 'LiveOverlayRenamed.app'), { recursive: true });
        await observe(
          'deleteMs',
          async () =>
            !(await visible('live-renamed', 'live-renamed.txt')) &&
            !(await visible('live-child', 'live-child.txt')) &&
            !apps.items.some((item) => item.path === path.join(root, 'LiveOverlayRenamed.app')),
        );
        expect((await service.status()).searchableRecords).toBe(snapshot.searchableRecords);
        // A real policy change still invalidates the snapshot immediately,
        // including while live changes and an older full write remain pending.
        service.updateSettings({
          ...DEFAULT_SETTINGS,
          indexing: {
            ...DEFAULT_SETTINGS.indexing,
            roots: [root],
            includeHidden: !DEFAULT_SETTINGS.indexing.includeHidden,
          },
        });
        expect((await service.status()).countsCurrent).toBe(false);
        expect((await service.status()).searchableRecords).toBeUndefined();
        console.info('Held full-writer live metadata measurements', measurements);
        armed = false;
        process.kill(writerPid, 'SIGCONT');
        stopped = false;
        await fullRun;
        await vi.waitFor(
          async () => {
            const status = await service.status();
            expect(status.running).toEqual([]);
            expect(status.countsCurrent).toBe(true);
          },
          { timeout: 15_000 },
        );
        expect(await visible('baseline-anchor', 'baseline-anchor.txt')).toBe(true);
      } finally {
        if (stopped && writerPid) {
          try {
            process.kill(writerPid, 'SIGCONT');
          } catch {
            /* Own child already exited. */
          }
        }
        await service.close();
        await rm(temporary, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
