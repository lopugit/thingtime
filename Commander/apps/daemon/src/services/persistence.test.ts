import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMMANDER_THINGTIME_CLIENT_ID,
  COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID,
  DEFAULT_SETTINGS,
  LEGACY_COMMANDER_THINGTIME_CLIENT_IDS,
  RECENT_SEARCH_COMMAND_LIMIT,
  RECENT_SEARCH_STORAGE_LIMIT,
} from '@commander/protocol';
import { PersistentStore } from './persistence.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PersistentStore Thingtime defaults', () => {
  it('migrates blank or invalid bundled client IDs and refuses to persist a blank override', async () => {
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

  it('migrates the previously shipped built-in client ID without changing a genuine override', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    const dataDirectory = path.join(temporary, 'data');
    await mkdir(dataDirectory);
    vi.stubEnv('COMMANDER_DATA_DIR', dataDirectory);
    await writeFile(
      path.join(dataDirectory, 'state.json'),
      `${JSON.stringify({
        version: 1,
        settings: { ...DEFAULT_SETTINGS, thingtimeClientId: LEGACY_COMMANDER_THINGTIME_CLIENT_IDS[0] },
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

  it('selects the bundled development client for the stable development origin and keeps custom IDs', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    vi.stubEnv('COMMANDER_DATA_DIR', path.join(temporary, 'data'));

    try {
      const store = new PersistentStore();
      await store.load();
      await store.setSettings({
        ...store.snapshot().settings,
        thingtimeBaseUrl: 'https://dev.thingtime.com',
      });
      expect(store.snapshot().settings.thingtimeClientId).toBe(COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID);

      await store.setSettings({
        ...store.snapshot().settings,
        thingtimeClientId: 'ttapp_custom',
      });
      expect(store.snapshot().settings.thingtimeClientId).toBe('ttapp_custom');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('persists valid custom Thingtime environment profiles', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    vi.stubEnv('COMMANDER_DATA_DIR', path.join(temporary, 'data'));

    try {
      const store = new PersistentStore();
      await store.load();
      await store.setSettings({
        ...store.snapshot().settings,
        thingtimeBaseUrl: 'https://staging.thingtime.com',
        thingtimeClientId: 'ttapp_staging',
        thingtimeCustomEnvironments: [
          {
            id: 'staging',
            name: 'Staging',
            baseUrl: 'https://staging.thingtime.com/',
            clientId: 'ttapp_staging',
          },
        ],
      });
      expect(store.snapshot().settings.thingtimeCustomEnvironments).toEqual([
        {
          id: 'staging',
          name: 'Staging',
          baseUrl: 'https://staging.thingtime.com',
          clientId: 'ttapp_staging',
        },
      ]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('reconciles a legacy account to its one exact Keychain environment without guessing ambiguity', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    vi.stubEnv('COMMANDER_DATA_DIR', path.join(temporary, 'data'));
    try {
      const store = new PersistentStore();
      await store.load();
      await store.upsertAccount({
        id: 'production-user',
        username: 'lopu',
        scopes: [],
        expiresAt: '2030-01-01T00:00:00.000Z',
      });
      await store.upsertAccount({
        id: 'ambiguous-user',
        username: 'lopu-dev',
        scopes: [],
        expiresAt: '2030-01-01T00:00:00.000Z',
      });

      const accounts = await store.reconcileAccountEnvironments([
        {
          accountId: 'production-user',
          baseUrl: 'https://thingtime.com/',
          clientId: 'ttapp_production',
        },
        {
          accountId: 'ambiguous-user',
          baseUrl: 'https://thingtime.com',
          clientId: 'ttapp_production',
        },
        {
          accountId: 'ambiguous-user',
          baseUrl: 'https://dev.thingtime.com',
          clientId: 'ttapp_development',
        },
      ]);
      expect(accounts.find((account) => account.id === 'production-user')?.environment).toEqual({
        baseUrl: 'https://thingtime.com',
        clientId: 'ttapp_production',
      });
      expect(accounts.find((account) => account.id === 'ambiguous-user')?.environment).toBeUndefined();
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
        version: 5,
        enabled: true,
        roots: ['/'],
        respectGitIgnore: true,
        includeHidden: true,
        maxEntries: null,
        customTimeoutMs: null,
        customIgnores: expect.arrayContaining([{ kind: 'glob', pattern: '**/node_modules/**' }]),
        resourceLimits: {
          maxThreads: 2,
          maxParallelism: 2,
          maxOpenDirectories: 16,
          maxCpuPercent: 60,
          maxMemoryMiB: 512,
        },
      });
      expect(store.consumeIndexingMigration()).toBe(true);
      expect(store.consumeIndexingMigration()).toBe(false);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('migrates missing calculator preferences and bounds later overrides', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    const dataDirectory = path.join(temporary, 'data');
    await mkdir(dataDirectory);
    vi.stubEnv('COMMANDER_DATA_DIR', dataDirectory);
    const legacySettings = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacySettings.calculator;
    await writeFile(
      path.join(dataDirectory, 'state.json'),
      `${JSON.stringify({ version: 1, settings: legacySettings, accounts: [], extensions: [] })}\n`,
    );

    try {
      const store = new PersistentStore();
      await store.load();
      expect(store.snapshot().settings.calculator).toEqual({ enabled: true, maxDecimalPlaces: 10 });
      await store.setSettings({
        ...store.snapshot().settings,
        calculator: { enabled: false, maxDecimalPlaces: 200 },
      });
      expect(store.snapshot().settings.calculator).toEqual({ enabled: false, maxDecimalPlaces: 14 });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('migrates and persists the custom macOS window resize preference', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    const dataDirectory = path.join(temporary, 'data');
    await mkdir(dataDirectory);
    vi.stubEnv('COMMANDER_DATA_DIR', dataDirectory);
    const legacySettings = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacySettings.useCustomWindowResizeHandling;
    await writeFile(
      path.join(dataDirectory, 'state.json'),
      `${JSON.stringify({ version: 1, settings: legacySettings, accounts: [], extensions: [] })}\n`,
    );

    try {
      const store = new PersistentStore();
      await store.load();
      expect(store.snapshot().settings.useCustomWindowResizeHandling).toBe(true);
      await store.setSettings({ ...store.snapshot().settings, useCustomWindowResizeHandling: false });
      expect(store.snapshot().settings.useCustomWindowResizeHandling).toBe(false);
      expect(
        JSON.parse(await readFile(path.join(dataDirectory, 'state.json'), 'utf8')).settings
          .useCustomWindowResizeHandling,
      ).toBe(false);
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

  it('persists adaptive search choices and boosts the matching query more than global usage', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    vi.stubEnv('COMMANDER_DATA_DIR', path.join(temporary, 'data'));

    try {
      const store = new PersistentStore();
      await store.load();
      await store.recordSearchSelection(' RayCast Start ', 'index:file:raycast-start', 'open', 1_000);
      await store.recordSearchSelection('raycast start', 'index:file:raycast-start', 'open', 2_000);
      await store.recordSearchSelection('other', 'index:file:other', 'open', 3_000);

      const exact = store.preferenceScores('RAYCAST START', 3_000);
      const unrelated = store.preferenceScores('something else', 3_000);
      expect(exact['index:file:raycast-start']).toBeGreaterThan(unrelated['index:file:raycast-start']!);
      expect(exact['index:file:raycast-start']).toBeGreaterThan(exact['index:file:other']!);
      expect(store.snapshot()).not.toHaveProperty('searchPreferences');

      const reloaded = new PersistentStore();
      await reloaded.load();
      expect(reloaded.preferenceScores('raycast start', 3_000)).toEqual(exact);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
