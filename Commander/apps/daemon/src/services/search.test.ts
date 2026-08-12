import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchItem } from '@commander/protocol';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

import { fallbackSearch, SearchService } from './search.js';

const item = (id: string, title: string, keywords: string[] = []): SearchItem => ({
  id,
  title,
  kind: 'command',
  keywords,
  favourite: false,
  actions: [{ id: 'run', title: 'Run' }],
});

const createRustProcess = (): ChildProcessWithoutNullStreams => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    kill: vi.fn(() => true),
  });
  return child as unknown as ChildProcessWithoutNullStreams;
};

const searchableItems = [item('settings', 'Settings'), item('terminal', 'Terminal')];

afterEach(() => {
  vi.useRealTimers();
  spawnMock.mockReset();
});

describe('fallbackSearch', () => {
  it('prefers exact, then prefix, then keyword matches deterministically', () => {
    const hits = fallbackSearch(
      'settings',
      [item('b', 'System Settings'), item('a', 'Settings'), item('c', 'Configure', ['settings'])],
      10,
    );
    expect(hits.map((hit) => hit.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('SearchService Rust failure fallback', () => {
  it('uses deterministic local search when the configured Rust binary cannot start', async () => {
    const child = createRustProcess();
    spawnMock.mockReturnValueOnce(child);
    const service = new SearchService('/missing/commander-search');
    service.setItems(searchableItems);

    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));

    await expect(service.search('settings')).resolves.toMatchObject([{ id: 'settings' }]);
    expect(spawnMock).toHaveBeenCalledWith('/missing/commander-search', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    service.close();
  });

  it('resolves an in-flight search through the fallback when the Rust process crashes', async () => {
    const child = createRustProcess();
    spawnMock.mockReturnValueOnce(child);
    const service = new SearchService('/test/commander-search');
    service.setItems(searchableItems);

    const search = service.search('settings');
    child.emit('exit', 7, null);

    await expect(search).resolves.toMatchObject([{ id: 'settings' }]);
    service.close();
  });

  it('times out an unresponsive Rust process, terminates it, and resolves through the fallback', async () => {
    vi.useFakeTimers();
    const child = createRustProcess();
    spawnMock.mockReturnValueOnce(child);
    const service = new SearchService('/test/commander-search');
    service.setItems(searchableItems);

    const search = service.search('settings');
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(search).resolves.toMatchObject([{ id: 'settings' }]);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    service.close();
  });
});
