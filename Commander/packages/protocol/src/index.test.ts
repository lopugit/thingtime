import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INDEXING_RESOURCE_LIMITS,
  DEFAULT_INDEXING_SETTINGS,
  fuzzyTextScore,
  INDEXING_SETTINGS_VERSION,
  isSettingsTab,
  normalizeActivitySettings,
  normalizeCalculatorSettings,
  normalizeCommanderThingtimeCustomEnvironments,
  normalizeIndexingSettings,
  normalizeSearchCacheSettings,
  normalizeSearchCategoryOrder,
  normalizeSearchPreferences,
  normalizeWindowPinningSettings,
  recordSearchPreference,
} from './index.js';

describe('Commander presentation settings', () => {
  it('recognizes the locally sampled Activity settings tab', () => {
    expect(isSettingsTab('activity')).toBe(true);
    expect(isSettingsTab('metrics')).toBe(false);
  });

  it('normalizes category ordering without duplicates and restores missing categories', () => {
    expect(normalizeSearchCategoryOrder(['files', 'files', 'commands'])).toEqual([
      'files',
      'commands',
      'applications',
    ]);
  });

  it('bounds cache and window pinning preferences while preserving valid overrides', () => {
    expect(
      normalizeSearchCacheSettings({
        enabled: false,
        directory: ' ~/Commander Cache ',
        maxSizeBytes: Number.MAX_SAFE_INTEGER,
        ttlMinutes: 1,
      }),
    ).toMatchObject({
      enabled: false,
      directory: '~/Commander Cache',
      maxSizeBytes: 2 * 1024 * 1024 * 1024,
      ttlMinutes: 5,
    });
    expect(
      normalizeWindowPinningSettings({
        enabled: true,
        defaultPinned: true,
        focusRecentOnCurrentDisplay: false,
        shortcut: ' Command+Shift+P ',
      }),
    ).toEqual({
      enabled: true,
      defaultPinned: true,
      focusRecentOnCurrentDisplay: false,
      shortcut: 'Command+Shift+P',
    });
  });

  it('normalizes automatic calculator preferences and bounds displayed precision', () => {
    expect(normalizeCalculatorSettings(undefined)).toEqual({ enabled: true, maxDecimalPlaces: 10 });
    expect(normalizeCalculatorSettings({ enabled: false, maxDecimalPlaces: 99 })).toEqual({
      enabled: false,
      maxDecimalPlaces: 14,
    });
    expect(normalizeCalculatorSettings({ enabled: true, maxDecimalPlaces: -4 })).toEqual({
      enabled: true,
      maxDecimalPlaces: 0,
    });
  });

  it('keeps costly automatic network speed testing opt-in and bounds its interval', () => {
    expect(normalizeActivitySettings(undefined)).toEqual({
      periodicSpeedTestEnabled: false,
      periodicSpeedTestIntervalMinutes: 15,
    });
    expect(
      normalizeActivitySettings({ periodicSpeedTestEnabled: true, periodicSpeedTestIntervalMinutes: 1 }),
    ).toEqual({ periodicSpeedTestEnabled: true, periodicSpeedTestIntervalMinutes: 5 });
    expect(
      normalizeActivitySettings({ periodicSpeedTestEnabled: true, periodicSpeedTestIntervalMinutes: 99_999 }),
    ).toEqual({ periodicSpeedTestEnabled: true, periodicSpeedTestIntervalMinutes: 1440 });
  });

  it('keeps valid custom Thingtime environments while rejecting malformed and duplicate entries', () => {
    expect(
      normalizeCommanderThingtimeCustomEnvironments([
        {
          id: 'staging',
          name: ' Staging ',
          baseUrl: 'https://staging.thingtime.com/',
          clientId: ' ttapp_staging ',
        },
        {
          id: 'staging',
          name: 'Duplicate',
          baseUrl: 'https://duplicate.example',
          clientId: 'ttapp_duplicate',
        },
        { id: 'bad', name: 'Bad', baseUrl: 'javascript:alert(1)', clientId: 'ttapp_bad' },
      ]),
    ).toEqual([
      {
        id: 'staging',
        name: 'Staging',
        baseUrl: 'https://staging.thingtime.com',
        clientId: 'ttapp_staging',
      },
    ]);
  });
});

describe('normalizeIndexingSettings', () => {
  it('migrates legacy settings to safe local indexing defaults', () => {
    expect(normalizeIndexingSettings(undefined)).toEqual(DEFAULT_INDEXING_SETTINGS);
  });

  it('upgrades the former singleton home-directory default to whole-volume indexing', () => {
    expect(normalizeIndexingSettings({ version: 4, roots: ['~'] }).roots).toEqual(['/']);
    expect(normalizeIndexingSettings({ version: 4, roots: ['~/Projects'] }).roots).toEqual(['~/Projects']);
  });

  it('preserves valid roots and wildcard/regex rules while enforcing resource bounds', () => {
    expect(
      normalizeIndexingSettings({
        enabled: false,
        roots: [' ~/Documents ', '~/Documents', '/Volumes/Work'],
        respectGitIgnore: false,
        includeHidden: true,
        customIgnores: [
          { kind: 'glob', pattern: ' **/build/** ' },
          { kind: 'regex', pattern: '(^|/)scratch-[0-9]+' },
          { kind: 'unknown', pattern: 'discarded' },
        ],
        refreshIntervalMinutes: 1,
        maxEntries: 99_000_000,
        resourceLimits: {
          maxThreads: 99,
          maxParallelism: 0,
          maxOpenDirectories: 999,
          maxCpuPercent: 1,
          maxMemoryMiB: 999_999,
        },
      }),
    ).toEqual({
      version: INDEXING_SETTINGS_VERSION,
      enabled: false,
      roots: ['~/Documents', '/Volumes/Work'],
      respectGitIgnore: false,
      includeHidden: true,
      customIgnores: [
        { kind: 'glob', pattern: '**/build/**' },
        { kind: 'regex', pattern: '(^|/)scratch-[0-9]+' },
      ],
      refreshIntervalMinutes: 5,
      maxEntries: 99_000_000,
      customTimeoutMs: null,
      resourceLimits: {
        maxThreads: 64,
        maxParallelism: 1,
        maxOpenDirectories: 256,
        maxCpuPercent: 5,
        maxMemoryMiB: 131_072,
      },
    });
  });

  it('allows an intentionally empty custom ignore list', () => {
    expect(normalizeIndexingSettings({ customIgnores: [] }).customIgnores).toEqual([]);
  });

  it('migrates missing machine resource limits without changing valid custom values', () => {
    expect(normalizeIndexingSettings({}).resourceLimits).toEqual(DEFAULT_INDEXING_RESOURCE_LIMITS);
    expect(
      normalizeIndexingSettings({
        resourceLimits: {
          maxThreads: 7,
          maxParallelism: 3,
          maxOpenDirectories: 11,
          maxCpuPercent: 42,
          maxMemoryMiB: 768,
        },
      }).resourceLimits,
    ).toEqual({
      maxThreads: 7,
      maxParallelism: 3,
      maxOpenDirectories: 11,
      maxCpuPercent: 42,
      maxMemoryMiB: 768,
    });
  });

  it('keeps a positive custom timeout without imposing a product cap', () => {
    expect(normalizeIndexingSettings({ customTimeoutMs: Number.MAX_SAFE_INTEGER }).customTimeoutMs).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(normalizeIndexingSettings({ customTimeoutMs: 900_000 }).customTimeoutMs).toBe(900_000);
    expect(normalizeIndexingSettings({ customTimeoutMs: 0 }).customTimeoutMs).toBeNull();
    expect(normalizeIndexingSettings({ customTimeoutMs: 2.5 }).customTimeoutMs).toBeNull();
  });

  it('adds the noindex default to the previous built-in ignore set', () => {
    const migrated = normalizeIndexingSettings({
      customIgnores: DEFAULT_INDEXING_SETTINGS.customIgnores.slice(0, -1),
      refreshIntervalMinutes: 30,
      maxEntries: 2_000_000,
    });
    expect(migrated.customIgnores).toEqual(DEFAULT_INDEXING_SETTINGS.customIgnores);
    expect(migrated.refreshIntervalMinutes).toBe(360);
    expect(migrated.maxEntries).toBeNull();
    expect(migrated.includeHidden).toBe(true);
    expect(migrated.version).toBe(INDEXING_SETTINGS_VERSION);
  });

  it('migrates former built-in caps and hidden-file defaults while preserving current choices', () => {
    const legacy = normalizeIndexingSettings({
      includeHidden: false,
      maxEntries: 500_000,
      customIgnores: DEFAULT_INDEXING_SETTINGS.customIgnores,
    });
    expect(legacy).toMatchObject({ includeHidden: true, maxEntries: null });

    const versionTwo = normalizeIndexingSettings({
      version: 2,
      includeHidden: false,
      maxEntries: 500_000,
      customIgnores: [{ kind: 'regex', pattern: '^custom/' }],
    });
    expect(versionTwo).toMatchObject({ includeHidden: true, maxEntries: null });

    const explicit = normalizeIndexingSettings({
      version: INDEXING_SETTINGS_VERSION,
      includeHidden: false,
      maxEntries: 250_000,
      customIgnores: DEFAULT_INDEXING_SETTINGS.customIgnores,
    });
    expect(explicit).toMatchObject({ includeHidden: false, maxEntries: 250_000 });
  });
});

describe('search preference learning', () => {
  it('normalizes query casing and increments only the selected query/item/action tuple', () => {
    const first = recordSearchPreference([], ' RayCast Start ', 'index:file:raycast', 'open', 100);
    const second = recordSearchPreference(first, 'raycast start', 'index:file:raycast', 'open', 200);
    const third = recordSearchPreference(second, 'raycast start', 'index:file:other', 'open', 300);

    expect(third).toEqual([
      {
        query: 'raycast start',
        itemId: 'index:file:other',
        actionId: 'open',
        count: 1,
        lastSelectedAtMs: 300,
      },
      {
        query: 'raycast start',
        itemId: 'index:file:raycast',
        actionId: 'open',
        count: 2,
        lastSelectedAtMs: 200,
      },
    ]);
  });

  it('drops malformed preference rows and merges duplicate persisted rows', () => {
    expect(
      normalizeSearchPreferences([
        { query: 'SET', itemId: 'settings', actionId: 'open', count: 2, lastSelectedAtMs: 10 },
        { query: 'set', itemId: 'settings', actionId: 'open', count: 3, lastSelectedAtMs: 20 },
        { query: 'set', itemId: '', actionId: 'open', count: 999, lastSelectedAtMs: 30 },
      ]),
    ).toEqual([
      {
        query: 'set',
        itemId: 'settings',
        actionId: 'open',
        count: 5,
        lastSelectedAtMs: 20,
      },
    ]);
  });
});

describe('fuzzyTextScore', () => {
  it('matches omissions, substitutions, and transpositions but rejects unrelated text', () => {
    expect(fuzzyTextScore('settngs', 'Commander Settings')).toBeGreaterThanOrEqual(0);
    expect(fuzzyTextScore('nite', 'note')).toBeGreaterThanOrEqual(0);
    expect(fuzzyTextScore('raycsat', 'raycast-start')).toBeGreaterThanOrEqual(0);
    expect(fuzzyTextScore('raycsat', 'unrelated')).toBe(-1);
  });

  it('treats a space-separated query as an exact filename title', () => {
    expect(fuzzyTextScore('raycast stop', 'raycast-stop')).toBe(100_000);
    expect(fuzzyTextScore('raycast stop', 'raycast-stop')).toBeGreaterThan(
      fuzzyTextScore('raycast stop', 'raycast-start'),
    );
  });
});
