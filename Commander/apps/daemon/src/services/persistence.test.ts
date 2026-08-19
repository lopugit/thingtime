import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMMANDER_THINGTIME_CLIENT_ID,
  DEFAULT_SETTINGS,
  RECENT_SEARCH_COMMAND_LIMIT,
  RECENT_SEARCH_STORAGE_LIMIT,
} from '@commander/protocol';
import { PersistentStore } from './persistence.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PersistentStore Thingtime defaults', () => {
  it('migrates a legacy blank client ID and refuses to persist a blank override', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    const dataDirectory = path.join(temporary, 'data');
    await mkdir(dataDirectory);
    vi.stubEnv('COMMANDER_DATA_DIR', dataDirectory);
    await writeFile(
      path.join(dataDirectory, 'state.json'),
      `${JSON.stringify({
        version: 1,
        settings: { ...DEFAULT_SETTINGS, thingtimeClientId: '' },
        accounts: [],
        extensions: [],
      })}\n`,
    );

    try {
      const store = new PersistentStore();
      await store.load();
      expect(store.snapshot().settings.thingtimeClientId).toBe(COMMANDER_THINGTIME_CLIENT_ID);
      expect(
        JSON.parse(await readFile(path.join(dataDirectory, 'state.json'), 'utf8')).settings.thingtimeClientId,
      ).toBe(COMMANDER_THINGTIME_CLIENT_ID);

      await store.setSettings({ ...store.snapshot().settings, thingtimeClientId: '   ' });
      expect(store.snapshot().settings.thingtimeClientId).toBe(COMMANDER_THINGTIME_CLIENT_ID);
      expect(
        JSON.parse(await readFile(path.join(dataDirectory, 'state.json'), 'utf8')).settings.thingtimeClientId,
      ).toBe(COMMANDER_THINGTIME_CLIENT_ID);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('preserves an explicit client ID override for another Thingtime deployment', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    vi.stubEnv('COMMANDER_DATA_DIR', path.join(temporary, 'data'));

    try {
      const store = new PersistentStore();
      await store.load();
      await store.setSettings({ ...store.snapshot().settings, thingtimeClientId: 'ttapp_custom' });
      expect(store.snapshot().settings.thingtimeClientId).toBe('ttapp_custom');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('migrates legacy state to local filesystem indexing defaults', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    const dataDirectory = path.join(temporary, 'data');
    await mkdir(dataDirectory);
    vi.stubEnv('COMMANDER_DATA_DIR', dataDirectory);
    const legacySettings = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacySettings.indexing;
    await writeFile(
      path.join(dataDirectory, 'state.json'),
      `${JSON.stringify({ version: 1, settings: legacySettings, accounts: [], extensions: [] })}\n`,
    );

    try {
      const store = new PersistentStore();
      await store.load();
      expect(store.snapshot().settings.indexing).toMatchObject({
        enabled: true,
        roots: ['~'],
        respectGitIgnore: true,
        customIgnores: expect.arrayContaining([{ kind: 'glob', pattern: '**/node_modules/**' }]),
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('normalizes persisted command shortcuts without accepting the reserved launcher identifier', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    const dataDirectory = path.join(temporary, 'data');
    await mkdir(dataDirectory);
    vi.stubEnv('COMMANDER_DATA_DIR', dataDirectory);
    await writeFile(
      path.join(dataDirectory, 'state.json'),
      `${JSON.stringify({
        version: 1,
        settings: {
          ...DEFAULT_SETTINGS,
          commandShortcuts: {
            'extension:builtin:emoji-symbols:search-emoji-symbols': ' Command+Option+E ',
            launcher: 'Command+Q',
            'extension:broken': 42,
          },
        },
        accounts: [],
        extensions: [],
      })}\n`,
    );

    try {
      const store = new PersistentStore();
      await store.load();
      expect(store.snapshot().settings.commandShortcuts).toEqual({
        'extension:builtin:emoji-symbols:search-emoji-symbols': 'Command+Option+E',
      });
      expect(
        JSON.parse(await readFile(path.join(dataDirectory, 'state.json'), 'utf8')).settings.commandShortcuts,
      ).toEqual({
        'extension:builtin:emoji-symbols:search-emoji-symbols': 'Command+Option+E',
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('persists deduplicated search sessions and their launched commands across daemon restarts', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    vi.stubEnv('COMMANDER_DATA_DIR', path.join(temporary, 'data'));

    try {
      const store = new PersistentStore();
      await store.load();
      for (let index = 0; index < RECENT_SEARCH_COMMAND_LIMIT + 2; index += 1) {
        await store.addRecentSearch(index ? 'SETTINGS' : ' settings ', {
          itemId: `builtin:settings:${index}`,
          actionId: 'open-settings',
          title: `Settings ${index}`,
          kind: 'builtin',
          actionTitle: 'Open Settings',
        });
      }
      await store.addRecentSearch('SETTINGS', {
        itemId: `builtin:settings:${RECENT_SEARCH_COMMAND_LIMIT + 1}`,
        actionId: 'open-settings',
        title: 'Settings newest',
        kind: 'builtin',
      });

      expect(store.snapshot().recentSearches).toEqual([
        {
          query: 'SETTINGS',
          commands: expect.arrayContaining([
            expect.objectContaining({
              itemId: `builtin:settings:${RECENT_SEARCH_COMMAND_LIMIT + 1}`,
              title: 'Settings newest',
            }),
          ]),
        },
      ]);
      expect(store.snapshot().recentSearches[0]?.commands).toHaveLength(RECENT_SEARCH_COMMAND_LIMIT);
      expect(store.snapshot().recentSearches[0]?.commands[0]?.title).toBe('Settings newest');

      const reloaded = new PersistentStore();
      await reloaded.load();
      expect(reloaded.snapshot().recentSearches).toEqual(store.snapshot().recentSearches);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('migrates legacy string history and retains more sessions than the eight-row preview', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    const dataDirectory = path.join(temporary, 'data');
    await mkdir(dataDirectory);
    vi.stubEnv('COMMANDER_DATA_DIR', dataDirectory);
    await writeFile(
      path.join(dataDirectory, 'state.json'),
      `${JSON.stringify({
        version: 1,
        settings: DEFAULT_SETTINGS,
        accounts: [],
        extensions: [],
        recentSearches: [' settings ', 'SETTINGS', 'notes'],
      })}\n`,
    );

    try {
      const store = new PersistentStore();
      await store.load();
      expect(store.snapshot().recentSearches).toEqual([
        { query: 'settings', commands: [] },
        { query: 'notes', commands: [] },
      ]);

      for (let index = 0; index < RECENT_SEARCH_STORAGE_LIMIT + 5; index += 1)
        await store.addRecentSearch(`search ${index}`);

      expect(store.snapshot().recentSearches).toHaveLength(RECENT_SEARCH_STORAGE_LIMIT);
      expect(store.snapshot().recentSearches[0]?.query).toBe(`search ${RECENT_SEARCH_STORAGE_LIMIT + 4}`);
      expect(store.snapshot().recentSearches.at(-1)?.query).toBe('search 5');

      const diskState = JSON.parse(await readFile(path.join(dataDirectory, 'state.json'), 'utf8'));
      expect(diskState.recentSearches[0]).toEqual({
        query: `search ${RECENT_SEARCH_STORAGE_LIMIT + 4}`,
        commands: [],
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
