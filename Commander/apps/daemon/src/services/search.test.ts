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
import { emojiSymbolsExtension, extensionItems } from './catalog.js';

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
    expect(fallbackSearch('settings', [item('unrelated', 'Terminal')], 10)).toEqual([]);
  });

  it('tolerates substitutions and adjacent transpositions across titles and keywords', () => {
    expect(fallbackSearch('settngs', [item('settings', 'Settings')], 10)[0]?.id).toBe('settings');
    expect(fallbackSearch('raycsat', [item('raycast', 'Raycast Start')], 10)[0]?.id).toBe('raycast');
    expect(
      fallbackSearch('extensoin', [item('extensions', 'Manage', ['extension settings'])], 10)[0]?.id,
    ).toBe('extensions');
  });

  it('uses a learned preference to reorder otherwise identical text matches', () => {
    const first = item('first', 'Open Notes');
    const preferred = { ...item('preferred', 'Open Notes'), preferenceScore: 9_000 };
    expect(fallbackSearch('open notes', [first, preferred], 10).map((hit) => hit.id)).toEqual([
      'preferred',
      'first',
    ]);
  });

  it('adds an item’s intentional command priority to learned and category ranking', () => {
    const application = { ...item('application', 'Emoji Helper'), kind: 'application' as const };
    const command = extensionItems([emojiSymbolsExtension])[0]!;
    expect(fallbackSearch('emoji', [application, command], 10).map((hit) => hit.id)).toEqual([
      command.id,
      'application',
    ]);
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

describe('SearchService transient filesystem candidates', () => {
  it.each([
    ['magician', 'SamsungMagician', 'Magician.png'],
    ['recovery', 'Thingtime Recovery', 'Recovery'],
  ])(
    'keeps the matching app first for %s even with more than 30 matching files',
    async (query, title, filename) => {
      const service = new SearchService();
      service.setItems([{ ...item('application', title), kind: 'application' }]);
      const files = Array.from({ length: 40 }, (_, index) => ({
        ...item(`file:${index}`, filename),
        kind: 'file' as const,
      }));
      const hits = await service.search(query, 30, files);
      expect(hits).toHaveLength(30);
      expect(hits[0]?.id).toBe('application');
      expect(hits[0]!.score - hits[1]!.score).toBeLessThan(22_000);
    },
  );

  it('keeps exact app names, explicit filenames, and user preferences ahead of a partial app name', async () => {
    const service = new SearchService();
    service.setItems([{ ...item('application', 'Thingtime Recovery'), kind: 'application' }]);
    const folder = { ...item('folder', 'Recovery'), kind: 'directory' as const };
    const file = { ...item('file', 'recovery.c'), kind: 'file' as const };
    const exactApp = { ...item('exact', 'Recovery'), kind: 'application' as const };
    expect((await service.search('recovery', 30, [exactApp]))[0]?.id).toBe('exact');
    expect((await service.search('recovery.c', 30, [file]))[0]?.id).toBe('file');
    expect((await service.search('recovery', 30, [folder], { folder: 2_000 }))[0]?.id).toBe('folder');
    expect(
      (await service.search('recovery', 30, [folder], {}, ['files', 'commands', 'applications']))[0]?.id,
    ).toBe('folder');
  });

  it.each([
    ['cover', 'Thingtime Recovery'],
    ['magic', 'SamsungMagician'],
    ['recvoery', 'Thingtime Recovery'],
    ['go', 'Go Tools'],
  ])('does not give %s a whole-word app boost in %s', async (query, title) => {
    const service = new SearchService();
    service.setItems([{ ...item('application', title), kind: 'application' }]);
    const hits = await service.search(query);
    expect(hits[0]?.score ?? 0).toBeLessThan(99_500);
  });

  it('does not promote apps that only match a path or keyword', async () => {
    const service = new SearchService();
    service.setItems([
      {
        ...item('application', 'Unrelated', ['recovery']),
        kind: 'application',
        subtitle: '/Applications/Recovery/Unrelated.app',
      },
    ]);
    const hits = await service.search('recovery');
    expect(hits[0]?.score).toBeLessThan(99_500);
  });

  it('keeps an in-flight catalog snapshot coherent while new searches see a live update', async () => {
    const service = new SearchService();
    service.setItems([item('old', 'Old Catalogue Entry')]);
    const snapshot = service.snapshot();

    service.setItems([item('new', 'New Catalogue Entry')]);

    await expect(service.searchSnapshot('old', snapshot)).resolves.toMatchObject([{ id: 'old' }]);
    await expect(service.search('new')).resolves.toMatchObject([{ id: 'new' }]);
    await expect(service.search('old')).resolves.toEqual([]);
  });

  it('ranks additional indexed results without mutating the command catalog', async () => {
    const service = new SearchService();
    service.setItems(searchableItems);
    const file = item('indexed:file', 'Quarterly Report');
    file.kind = 'file';
    file.path = '/Users/test/Documents/Quarterly Report.pdf';

    await expect(service.search('quarterly', 30, [file])).resolves.toMatchObject([
      { id: 'indexed:file', kind: 'file' },
    ]);
    expect(service.items()).toEqual(searchableItems);
  });

  it('applies the same learned score to catalog and transient filesystem items', async () => {
    const service = new SearchService();
    service.setItems([item('catalog', 'Raycast Start')]);
    const file = item('indexed:file', 'Raycast Start');
    file.kind = 'file';
    file.path = '/Users/test/raycast-start';

    await expect(service.search('raycast', 30, [file], { 'indexed:file': 20_000 })).resolves.toMatchObject([
      { id: 'indexed:file' },
      { id: 'catalog' },
    ]);
  });

  it('uses category order as a modest default boost that learned ranking can overcome', async () => {
    const service = new SearchService();
    const command = item('command', 'Open Thingtime');
    const application = { ...item('application', 'Open Thingtime'), kind: 'application' as const };
    const file = { ...item('file', 'Open Thingtime'), kind: 'file' as const };
    service.setItems([command]);

    await expect(
      service.search('open thingtime', 30, [application, file], {}, ['applications', 'commands', 'files']),
    ).resolves.toMatchObject([{ id: 'application' }, { id: 'command' }, { id: 'file' }]);

    await expect(
      service.search('open thingtime', 30, [application, file], { file: 10_000 }, [
        'applications',
        'commands',
        'files',
      ]),
    ).resolves.toMatchObject([{ id: 'file' }, { id: 'application' }, { id: 'command' }]);
  });
});
