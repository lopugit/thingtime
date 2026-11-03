import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FileSystemIndexerClient, type IndexConfiguration } from '@commander/filesystem-indexer';
import { IndexOverlay } from './indexOverlay.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IndexRecord } from '@commander/filesystem-indexer';

describe('live index overlay', () => {
  beforeAll(async () => {
    await promisify(execFile)('cargo', [
      'build',
      '--locked',
      '--manifest-path',
      '../../crates/commander-indexer/Cargo.toml',
    ]);
  }, 120_000);
  it('handles parent-directory-only create/rename/delete notifications including children and apps, then verifies retirement', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'commander-overlay-parent-')));
    const root = path.join(temporary, 'root');
    const original = path.join(root, 'original');
    const moved = path.join(root, 'moved');
    await mkdir(original, { recursive: true });
    await writeFile(path.join(original, 'unchanged-child.txt'), 'cached');
    await mkdir(path.join(original, 'Inside.app'));
    const client = new FileSystemIndexerClient({
      binaryPath: path.resolve('../../crates/commander-indexer/target/debug/commander-indexer'),
      databasePath: path.join(temporary, 'index.sqlite3'),
    });
    const configuration: IndexConfiguration = {
      sources: [
        {
          id: 'fixture',
          root,
          kinds: ['application', 'file', 'directory'],
          respectGitIgnore: true,
          includeHidden: false,
        },
      ],
    };
    const overlay = new IndexOverlay(
      (config, paths) => client.observe(config, paths),
      (paths) => client.readback(paths, ['fixture']),
      () => undefined,
    );
    try {
      await client.index(configuration);
      await overlay.apply(configuration, [original]);
      expect(await overlay.query('unchanged-child', 20)).toEqual([]); // unchanged committed metadata is not copied into the transient inventory
      expect(await overlay.retireAfterReadback()).toBe(true);
      await writeFile(path.join(original, 'new-child.txt'), 'new');
      await overlay.apply(configuration, [original]); // no child notification supplied
      expect((await overlay.query('new-child', 20)).map((record) => record.path)).toContain(
        path.join(original, 'new-child.txt'),
      );
      await rename(original, moved);
      await overlay.apply(configuration, [original, moved]); // no child-path notifications supplied
      expect(overlay.masks(path.join(original, 'unchanged-child.txt'))).toBe(true);
      const children = await overlay.query('child', 20);
      expect(children.map((record) => record.path)).toEqual(
        expect.arrayContaining([path.join(moved, 'unchanged-child.txt'), path.join(moved, 'new-child.txt')]),
      );
      expect(children.some((record) => record.path.startsWith(`${original}/`))).toBe(false);
      expect(overlay.applications().map((record) => record.path)).toEqual([path.join(moved, 'Inside.app')]);
      await rm(moved, { recursive: true });
      await overlay.apply(configuration, [moved]);
      expect(await overlay.query('child', 20)).toEqual([]);
      expect(overlay.applications()).toEqual([]);
      expect(await overlay.retireAfterReadback()).toBe(false); // old committed subtree must not reappear
      await client.index(configuration);
      expect(await overlay.retireAfterReadback()).toBe(true);
      expect(overlay.pending).toBe(false);
    } finally {
      overlay.clear();
      await client.close();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('observes a new exact path while an older descendant page is intentionally paused', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'commander-overlay-priority-')));
    const root = path.join(temporary, 'root');
    await mkdir(root);
    const oldPath = path.join(root, 'old.txt');
    const newPath = path.join(root, 'new.txt');
    await writeFile(oldPath, 'old');
    const client = new FileSystemIndexerClient({
      binaryPath: path.resolve('../../crates/commander-indexer/target/debug/commander-indexer'),
      databasePath: path.join(temporary, 'index.sqlite3'),
    });
    const configuration: IndexConfiguration = {
      sources: [{ id: 'fixture', root, kinds: ['file', 'directory'] }],
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let holdDescendant = false;
    const overlay = new IndexOverlay(
      async (config, paths) => {
        const result = await client.observe(config, paths);
        if (holdDescendant && paths.includes(oldPath)) {
          entered();
          await gate;
        }
        return result;
      },
      (paths) => client.readback(paths, ['fixture']),
      () => undefined,
    );
    try {
      await overlay.apply(configuration, [oldPath]);
      holdDescendant = true;
      const older = overlay.apply(configuration, [root]);
      await paused;
      await overlay.apply(configuration, [root]);
      expect((await overlay.query('old', 20)).map((record) => record.path)).toContain(oldPath);
      await writeFile(newPath, 'new');
      await Promise.race([
        overlay.apply(configuration, [newPath]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Exact path waited on old descendant page')), 1000),
        ),
      ]);
      expect((await overlay.query('new', 20)).map((record) => record.path)).toContain(newPath);
      release();
      await older;
      expect((await overlay.query('new', 20)).map((record) => record.path)).toContain(newPath);
    } finally {
      release();
      overlay.clear();
      await client.close();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('keeps prior live children when a directory cannot be enumerated', async () => {
    const record = (itemPath: string): IndexRecord => ({
      path: itemPath,
      name: path.basename(itemPath),
      parent: path.dirname(itemPath),
      kind: itemPath === '/fixture/parent' ? 'directory' : 'file',
      score: 0,
    });
    const configuration: IndexConfiguration = {
      sources: [{ id: 'fixture', root: '/fixture', kinds: ['file', 'directory'] }],
    };
    const overlay = new IndexOverlay(
      async (_config, paths) => ({
        observations: paths.map((itemPath) => ({
          path: itemPath,
          record: record(itemPath),
          descend: itemPath === '/fixture/parent',
        })),
      }),
      async (paths) => ({
        entries: paths.map((itemPath) => ({ path: itemPath, records: [], hasDescendants: false })),
      }),
      () => undefined,
      {
        openDirectory: async () => {
          throw new Error('enumeration unavailable');
        },
      },
    );
    await overlay.apply(configuration, ['/fixture/parent/kept.txt']);
    await overlay.apply(configuration, ['/fixture/parent']);
    expect((await overlay.query('kept', 20)).map((item) => item.path)).toEqual(['/fixture/parent/kept.txt']);
  });

  it('fences delayed old-context metadata after settings clear', async () => {
    const configuration: IndexConfiguration = {
      sources: [{ id: 'fixture', root: '/fixture', kinds: ['file'] }],
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const overlay = new IndexOverlay(
      async (_config, paths) => {
        if (paths.includes('/fixture/old.txt')) {
          entered();
          await gate;
        }
        return {
          observations: paths.map((itemPath) => ({
            path: itemPath,
            record: {
              path: itemPath,
              name: path.basename(itemPath),
              parent: '/fixture',
              kind: 'file' as const,
              score: 0,
            },
            descend: false,
          })),
        };
      },
      async (paths) => ({
        entries: paths.map((itemPath) => ({ path: itemPath, records: [], hasDescendants: false })),
      }),
      () => undefined,
    );
    const older = overlay.apply(configuration, ['/fixture/old.txt']);
    await started;
    overlay.clear();
    await overlay.apply(configuration, ['/fixture/new.txt']);
    release();
    await older;
    expect((await overlay.query('new', 20)).map((record) => record.path)).toEqual(['/fixture/new.txt']);
    expect(overlay.resolve('/fixture/old.txt')).toBeUndefined();
  });

  it('excludes internal database directories while walking a broad parent, including Data aliases', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'commander-overlay-self-')));
    const root = path.join(temporary, 'root');
    const state = path.join(root, 'state');
    await mkdir(state, { recursive: true });
    await writeFile(path.join(root, 'cached.txt'), 'cached');
    const wal = path.join(state, 'self-index.sqlite3-wal');
    await writeFile(wal, 'one');
    const client = new FileSystemIndexerClient({
      binaryPath: path.resolve('../../crates/commander-indexer/target/debug/commander-indexer'),
      databasePath: path.join(temporary, 'index.sqlite3'),
    });
    const configuration: IndexConfiguration = {
      sources: [{ id: 'fixture', root, kinds: ['file', 'directory'] }],
    };
    const observed: string[] = [];
    const overlay = new IndexOverlay(
      (config, paths) => {
        observed.push(...paths);
        return client.observe(config, paths);
      },
      (paths) => client.readback(paths, ['fixture']),
      () => undefined,
      { excludedDirectories: [state] },
    );
    try {
      await client.index(configuration);
      await writeFile(wal, 'changed own WAL');
      await overlay.apply(configuration, [root, `/System/Volumes/Data${wal}`]);
      expect(observed.some((itemPath) => itemPath === state || itemPath.startsWith(`${state}/`))).toBe(false);
      expect(overlay.pending).toBe(false);
    } finally {
      overlay.clear();
      await client.close();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('clears an old app-only parent tombstone when that container is recreated', async () => {
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'commander-overlay-apponly-')));
    const root = path.join(temporary, 'root');
    const parent = path.join(root, 'parent');
    await mkdir(path.join(parent, 'Inside.app'), { recursive: true });
    const client = new FileSystemIndexerClient({
      binaryPath: path.resolve('../../crates/commander-indexer/target/debug/commander-indexer'),
      databasePath: path.join(temporary, 'index.sqlite3'),
    });
    const configuration: IndexConfiguration = { sources: [{ id: 'fixture', root, kinds: ['application'] }] };
    const overlay = new IndexOverlay(
      (config, paths) => client.observe(config, paths),
      (paths) => client.readback(paths, ['fixture']),
      () => undefined,
    );
    try {
      await overlay.apply(configuration, [parent]);
      expect(overlay.applications()).toHaveLength(1);
      await rm(parent, { recursive: true });
      await overlay.apply(configuration, [parent]);
      expect(overlay.applications()).toEqual([]);
      await mkdir(path.join(parent, 'Inside.app'), { recursive: true });
      await overlay.apply(configuration, [parent]);
      expect(overlay.applications().map((record) => record.path)).toEqual([path.join(parent, 'Inside.app')]);
      await client.index(configuration);
      expect(await overlay.retireAfterReadback()).toBe(true);
      expect(overlay.pending).toBe(false);
    } finally {
      overlay.clear();
      await client.close();
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
